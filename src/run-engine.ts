import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  createTrackReport,
  type CandidateTransport,
  type JudgeTransport,
  type PrivateArtifactRef,
  type RunPlan,
  type SourceManifest,
  type TrackExecutionResult,
  type TrackReport,
  type TrialReceipt,
} from "./eval-core.ts";
import { stableDigest } from "./identity.ts";
import { createEvidenceReceipt, redactEvidenceReceipt } from "./receipts.ts";
import { putEvidence } from "./evidence.ts";
import { verifyMaterializedSource, type MaterializedSourceVerification } from "./source-cache.ts";
import { verifySourceManifestPins } from "./source-manifests.ts";
import type { ExecutionStatus, FailureOwner, Sha256Digest } from "./types.ts";
import type { RuntimeBundleConfig } from "./runtime-config.ts";

export interface EvidenceWriterInput {
  readonly value: unknown;
  readonly mediaType: string;
}

export interface TrackExecutorContext {
  readonly plan: RunPlan;
  readonly manifest: SourceManifest;
  readonly source: MaterializedSourceVerification;
  readonly candidate: CandidateTransport;
  readonly judge: JudgeTransport | undefined;
  /** Ephemeral broker capabilities supplied by `run`; never part of RunSpec identity. */
  readonly runtime?: RuntimeBundleConfig | undefined;
  readonly evidence: (input: EvidenceWriterInput) => PrivateArtifactRef;
}

export type TrackExecutor = (
  context: TrackExecutorContext,
) => Promise<TrackExecutionResult>;

export interface ImmutableRunResult {
  readonly plan: RunPlan;
  readonly trackReport: TrackReport;
  readonly nativeEvidence: PrivateArtifactRef;
  readonly publicReceiptPath: string;
  readonly trackReportPath: string;
  readonly trialReceiptsPath: string;
  readonly publicReceipt: ReturnType<typeof redactEvidenceReceipt>;
}

function digestBytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function privateArtifact(root: string, value: unknown, mediaType: string): PrivateArtifactRef {
  const serialized = typeof value === "string" ? value : `${JSON.stringify(value)}\n`;
  const record = putEvidence(root, serialized, "private");
  return Object.freeze({
    path: record.path,
    digest: record.digest,
    mediaType,
    bytes: Buffer.byteLength(serialized, "utf8"),
  });
}

function assertArtifact(root: string, artifact: PrivateArtifactRef): void {
  if (!artifact.path.startsWith("/")) throw new TypeError("native evidence path must be absolute");
  const relativePath = relative(resolve(root), resolve(artifact.path));
  if (relativePath.startsWith("..") || relativePath.includes("..")) {
    throw new TypeError("native evidence must be below EVIDENCE_ROOT");
  }
  if (!existsSync(artifact.path)) throw new TypeError("native evidence file is missing");
  const bytes = readFileSync(artifact.path);
  if (bytes.byteLength !== artifact.bytes) throw new TypeError("native evidence byte count drifted");
  if (digestBytes(bytes) !== artifact.digest) throw new TypeError("native evidence digest drifted");
}

function writeAppendOnly(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    writeFileSync(path, serialized, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    if (readFileSync(path, "utf8") !== serialized) throw new TypeError("append-only artifact already contains different bytes");
  }
}

function failureStatus(owner: FailureOwner): ExecutionStatus {
  switch (owner) {
    case "rights": return "rights_hold";
    case "candidate": return "failed";
    case "adapter":
    case "artifact":
    case "verifier":
    case "cleanup":
      return "invalid";
    case "source":
    case "host":
    case "judge":
      return "unavailable";
  }
}

function emptyMetrics(): TrackReport["metrics"] {
  return Object.freeze({
    execution: Object.freeze({ numerator: null, denominator: null, value: null }),
  });
}

function failureExecution(input: {
  readonly owner: FailureOwner;
  readonly reason: string;
  readonly evidence: (value: unknown, mediaType: string) => PrivateArtifactRef;
}): TrackExecutionResult {
  return Object.freeze({
    executionStatus: failureStatus(input.owner),
    failureOwner: input.owner,
    trialReceipts: Object.freeze([]),
    metrics: emptyMetrics(),
    nativeEvidence: input.evidence({ reason: input.reason, owner: input.owner }, "application/json"),
    cleanupStatus: "complete" as const,
  });
}

function materializedSourceResult(input: {
  readonly plan: RunPlan;
  readonly manifest: SourceManifest;
  readonly candidate: CandidateTransport;
  readonly judge: JudgeTransport | undefined;
  readonly runtime?: RuntimeBundleConfig | undefined;
  readonly source: MaterializedSourceVerification;
  readonly executor: TrackExecutor;
}): Promise<TrackExecutionResult> {
  return input.executor({
    plan: input.plan,
    manifest: input.manifest,
    source: input.source,
    candidate: input.candidate,
    judge: input.judge,
    runtime: input.runtime,
    evidence: ({ value, mediaType }) => privateArtifact(input.plan.evidenceRoot, value, mediaType),
  });
}

export async function executeImmutableRun(input: {
  readonly plan: RunPlan;
  readonly manifest: SourceManifest;
  readonly candidate: CandidateTransport;
  readonly judge: JudgeTransport | undefined;
  readonly runtime?: RuntimeBundleConfig | undefined;
  readonly executor: TrackExecutor;
}): Promise<ImmutableRunResult> {
  const plan = input.plan;
  const runRoot = resolve(plan.evidenceRoot, plan.id);
  mkdirSync(runRoot, { recursive: true });
  const evidence = (value: unknown, mediaType: string) => privateArtifact(plan.evidenceRoot, value, mediaType);
  if (plan.runSpec === undefined) {
    const execution = failureExecution({ owner: "verifier", reason: "run plan is missing immutable runSpec", evidence });
    return finalizeRun({ input, execution, source: undefined, runRoot });
  }
  const runSpec = plan.runSpec;
  let execution: TrackExecutionResult;
  let source: MaterializedSourceVerification | undefined;
  try {
    if (runSpec.candidateType !== "fixture") {
      const manifestDigest = verifySourceManifestPins(input.manifest);
      if (manifestDigest !== plan.sourceManifestDigest) throw new TypeError("source manifest digest does not match run plan");
    } else if (stableDigest(input.manifest) !== plan.sourceManifestDigest) {
      throw new TypeError("source manifest digest does not match run plan");
    }
  } catch (error) {
    execution = failureExecution({ owner: "source", reason: error instanceof Error ? error.message : "source pin verification failed", evidence });
    return finalizeRun({ input, execution, source, runRoot });
  }
  if (
    input.manifest.providerTermsPolicy === "receipt-required" &&
    runSpec.candidateType !== "fixture" &&
    runSpec.providerTermsReceiptDigest === undefined
  ) {
    execution = failureExecution({ owner: "rights", reason: "provider-terms receipt is required", evidence });
    return finalizeRun({ input, execution, source, runRoot });
  }
  if (runSpec.candidateType === "coffee_chat_product") {
    execution = Object.freeze({
      executionStatus: "not_implemented" as const,
      trialReceipts: Object.freeze([]),
      metrics: emptyMetrics(),
      nativeEvidence: evidence({ reason: "coffee_chat_product is not implemented" }, "application/json"),
      cleanupStatus: "complete" as const,
    });
    return finalizeRun({ input, execution, source, runRoot });
  }
  if (runSpec.candidateType !== "fixture" && runSpec.isolationEvidenceDigest === undefined) {
    execution = failureExecution({ owner: "host", reason: "isolation evidence is required", evidence });
    return finalizeRun({ input, execution, source, runRoot });
  }
  try {
    source = verifyMaterializedSource({ manifest: input.manifest, cacheRoot: plan.cacheRoot });
  } catch (error) {
    execution = failureExecution({ owner: "source", reason: error instanceof Error ? error.message : "materialized source unavailable", evidence });
    return finalizeRun({ input, execution, source, runRoot });
  }
  try {
    execution = await materializedSourceResult({ ...input, source });
  } catch (error) {
    execution = failureExecution({ owner: "adapter", reason: error instanceof Error ? error.message : "track executor failed", evidence });
  }
  if (execution.cleanupStatus !== "complete") {
    execution = Object.freeze({ ...execution, executionStatus: "invalid" as const, failureOwner: "cleanup" as const });
  }
  return finalizeRun({ input, execution, source, runRoot });
}

async function finalizeRun(input: {
  readonly input: {
    readonly plan: RunPlan;
    readonly manifest: SourceManifest;
  };
  readonly execution: TrackExecutionResult;
  readonly source: MaterializedSourceVerification | undefined;
  readonly runRoot: string;
}): Promise<ImmutableRunResult> {
  const { plan, manifest } = input.input;
  assertArtifact(plan.evidenceRoot, input.execution.nativeEvidence);
  const nativeMetricIds = Object.keys(input.execution.metrics);
  const report = createTrackReport({
    trackId: plan.trackId,
    claimStatus: plan.claimStatus,
    executionStatus: input.execution.executionStatus,
    nativeMetricIds: nativeMetricIds.length === 0 ? ["execution"] : nativeMetricIds,
    metrics: nativeMetricIds.length === 0 ? emptyMetrics() : input.execution.metrics,
    provenance: {
      sourceManifestDigest: plan.sourceManifestDigest,
      runId: plan.id,
      nativeEvidenceDigest: input.execution.nativeEvidence.digest,
    },
  });
  const trackReportPath = join(input.runRoot, "track-report.json");
  const trialReceiptsPath = join(input.runRoot, "trial-receipts.json");
  writeAppendOnly(trackReportPath, report);
  writeAppendOnly(trialReceiptsPath, input.execution.trialReceipts);
  const executionStatus = input.execution.executionStatus;
  const receipt = createEvidenceReceipt({
    plan,
    executionStatus,
    ...(input.execution.failureOwner === undefined ? {} : { failureOwner: input.execution.failureOwner }),
    privateEvidence: {
      task: plan.runSpecDigest,
      candidate: plan.runSpec!.candidateDigest,
      judge: plan.runSpec!.judgeDigest,
      secret: input.execution.nativeEvidence.digest,
    },
  });
  const publicReceipt = redactEvidenceReceipt(receipt);
  const publicReceiptPath = join(input.runRoot, "public-receipt.json");
  writeAppendOnly(publicReceiptPath, publicReceipt);
  return Object.freeze({
    plan,
    trackReport: report,
    nativeEvidence: input.execution.nativeEvidence,
    publicReceiptPath,
    trackReportPath,
    trialReceiptsPath,
    publicReceipt,
  });
}
