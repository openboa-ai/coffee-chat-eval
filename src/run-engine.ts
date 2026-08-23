import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import {
  verifyMaterializedSource,
  type MaterializedSourceVerification,
} from "./source-cache.ts";
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
  readonly cleanupStatus: TrackExecutionResult["cleanupStatus"];
  readonly publicReceiptPath: string;
  readonly trackReportPath: string;
  readonly trialReceiptsPath: string;
  readonly publicReceipt: ReturnType<typeof redactEvidenceReceipt>;
}

const SMOKE_CANDIDATE_CAPS: Readonly<Record<string, number>> = Object.freeze({
  "coffee-chat-taste": 3,
  "beam-record-core": 6,
  ifeval: 9,
  "agentdojo-security": 45,
});

const SMOKE_JUDGE_CAPS: Readonly<Record<string, number>> = Object.freeze({
  "coffee-chat-taste": 21,
  "beam-record-core": 11,
});

/**
 * Validate ephemeral broker capabilities against the immutable run identity.
 * Identity/model matching is performed by the CLI when it has the separate
 * candidate/Judge identity files; this common check owns scope, expiry, and
 * the least-privilege smoke budgets used by every entry point.
 */
export function validateRuntimeForRun(input: {
  readonly plan: RunPlan;
  readonly runtime?: RuntimeBundleConfig | undefined;
}): { readonly failureOwner: "host"; readonly reason: string } | undefined {
  const spec = input.plan.runSpec;
  if (spec === undefined || spec.candidateType === "fixture") return undefined;
  const runtime = input.runtime;
  if (runtime === undefined) {
    return Object.freeze({
      failureOwner: "host" as const,
      reason: "live candidate runtime capability is missing",
    });
  }
  const now = Date.now();
  const candidate = runtime.candidate;
  if (candidate.scope !== "candidate") {
    return Object.freeze({
      failureOwner: "host" as const,
      reason: "candidate runtime scope is invalid",
    });
  }
  if (Date.parse(candidate.expiresAt) <= now) {
    return Object.freeze({
      failureOwner: "host" as const,
      reason: "candidate runtime capability is expired",
    });
  }
  if (spec.profile === "smoke") {
    const expected = SMOKE_CANDIDATE_CAPS[spec.trackId];
    if (expected !== undefined && candidate.maxRequests !== expected) {
      return Object.freeze({
        failureOwner: "host" as const,
        reason: `candidate smoke capability budget must be ${expected}`,
      });
    }
  }
  const judgeRequired =
    spec.trackId === "coffee-chat-taste" || spec.trackId === "beam-record-core";
  const judge = runtime.judge;
  if (judgeRequired && judge === undefined) {
    return Object.freeze({
      failureOwner: "host" as const,
      reason: "native Judge runtime capability is missing",
    });
  }
  if (!judgeRequired && judge !== undefined) {
    return Object.freeze({
      failureOwner: "host" as const,
      reason: "this track must not receive a Judge capability",
    });
  }
  if (judge !== undefined) {
    if (judge.scope !== "judge") {
      return Object.freeze({
        failureOwner: "host" as const,
        reason: "Judge runtime scope is invalid",
      });
    }
    if (Date.parse(judge.expiresAt) <= now) {
      return Object.freeze({
        failureOwner: "host" as const,
        reason: "Judge runtime capability is expired",
      });
    }
    if (spec.profile === "smoke") {
      const expected = SMOKE_JUDGE_CAPS[spec.trackId];
      if (expected !== undefined && judge.maxRequests !== expected) {
        return Object.freeze({
          failureOwner: "host" as const,
          reason: `Judge smoke capability budget must be ${expected}`,
        });
      }
    }
  }
  return undefined;
}

function digestBytes(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function privateArtifact(
  root: string,
  value: unknown,
  mediaType: string,
): PrivateArtifactRef {
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
  if (!artifact.path.startsWith("/"))
    throw new TypeError("native evidence path must be absolute");
  const relativePath = relative(resolve(root), resolve(artifact.path));
  if (relativePath.startsWith("..") || relativePath.includes("..")) {
    throw new TypeError("native evidence must be below EVIDENCE_ROOT");
  }
  if (!existsSync(artifact.path))
    throw new TypeError("native evidence file is missing");
  const bytes = readFileSync(artifact.path);
  if (bytes.byteLength !== artifact.bytes)
    throw new TypeError("native evidence byte count drifted");
  if (digestBytes(bytes) !== artifact.digest)
    throw new TypeError("native evidence digest drifted");
}

function writeAppendOnly(path: string, value: unknown): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  try {
    writeFileSync(path, serialized, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
      throw error;
    if (readFileSync(path, "utf8") !== serialized)
      throw new TypeError("append-only artifact already contains different bytes");
  }
}

function failureStatus(owner: FailureOwner): ExecutionStatus {
  switch (owner) {
    case "rights":
      return "rights_hold";
    case "candidate":
      return "failed";
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

function adapterFailureOwner(error: unknown): FailureOwner {
  if (error !== null && typeof error === "object") {
    const owner = (error as { failureOwner?: unknown }).failureOwner;
    if (
      owner === "source" ||
      owner === "rights" ||
      owner === "host" ||
      owner === "candidate" ||
      owner === "adapter" ||
      owner === "judge" ||
      owner === "verifier" ||
      owner === "artifact" ||
      owner === "cleanup"
    ) {
      return owner;
    }
  }
  return "adapter";
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
    nativeEvidence: input.evidence(
      { reason: input.reason, owner: input.owner },
      "application/json",
    ),
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
    evidence: ({ value, mediaType }) =>
      privateArtifact(input.plan.evidenceRoot, value, mediaType),
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
  const evidence = (value: unknown, mediaType: string) =>
    privateArtifact(plan.evidenceRoot, value, mediaType);
  if (plan.runSpec === undefined) {
    const execution = failureExecution({
      owner: "verifier",
      reason: "run plan is missing immutable runSpec",
      evidence,
    });
    return finalizeRun({ input, execution, source: undefined, runRoot });
  }
  const runSpec = plan.runSpec;
  let execution: TrackExecutionResult;
  let source: MaterializedSourceVerification | undefined;
  try {
    if (runSpec.candidateType !== "fixture") {
      const manifestDigest = verifySourceManifestPins(input.manifest);
      if (manifestDigest !== plan.sourceManifestDigest)
        throw new TypeError("source manifest digest does not match run plan");
    } else if (stableDigest(input.manifest) !== plan.sourceManifestDigest) {
      throw new TypeError("source manifest digest does not match run plan");
    }
  } catch (error) {
    execution = failureExecution({
      owner: "source",
      reason: error instanceof Error ? error.message : "source pin verification failed",
      evidence,
    });
    return finalizeRun({ input, execution, source, runRoot });
  }
  if (
    input.manifest.providerTermsPolicy === "receipt-required" &&
    runSpec.candidateType !== "fixture" &&
    runSpec.providerTermsReceiptDigest === undefined
  ) {
    execution = failureExecution({
      owner: "rights",
      reason: "provider-terms receipt is required",
      evidence,
    });
    return finalizeRun({ input, execution, source, runRoot });
  }
  if (runSpec.candidateType === "coffee_chat_product") {
    execution = Object.freeze({
      executionStatus: "not_implemented" as const,
      trialReceipts: Object.freeze([]),
      metrics: emptyMetrics(),
      nativeEvidence: evidence(
        { reason: "coffee_chat_product is not implemented" },
        "application/json",
      ),
      cleanupStatus: "complete" as const,
    });
    return finalizeRun({ input, execution, source, runRoot });
  }
  if (
    runSpec.candidateType !== "fixture" &&
    runSpec.isolationEvidenceDigest === undefined
  ) {
    execution = failureExecution({
      owner: "host",
      reason: "isolation evidence is required",
      evidence,
    });
    return finalizeRun({ input, execution, source, runRoot });
  }
  const runtimeFailure = validateRuntimeForRun({ plan, runtime: input.runtime });
  if (runtimeFailure !== undefined) {
    execution = failureExecution({
      owner: runtimeFailure.failureOwner,
      reason: runtimeFailure.reason,
      evidence,
    });
    return finalizeRun({ input, execution, source, runRoot });
  }
  try {
    source = verifyMaterializedSource({
      manifest: input.manifest,
      cacheRoot: plan.cacheRoot,
    });
  } catch (error) {
    execution = failureExecution({
      owner: "source",
      reason:
        error instanceof Error ? error.message : "materialized source unavailable",
      evidence,
    });
    return finalizeRun({ input, execution, source, runRoot });
  }
  try {
    execution = await materializedSourceResult({ ...input, source });
  } catch (error) {
    const owner = adapterFailureOwner(error);
    execution = failureExecution({
      owner,
      reason: error instanceof Error ? error.message : "track executor failed",
      evidence,
    });
  }
  if (execution.cleanupStatus !== "complete") {
    execution = Object.freeze({
      ...execution,
      executionStatus: "invalid" as const,
      failureOwner: "cleanup" as const,
    });
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
  let execution = input.execution;
  try {
    assertArtifact(plan.evidenceRoot, execution.nativeEvidence);
  } catch (error) {
    execution = failureExecution({
      owner: "artifact",
      reason: error instanceof Error ? error.message : "native evidence is invalid",
      evidence: (value, mediaType) =>
        privateArtifact(plan.evidenceRoot, value, mediaType),
    });
  }
  const nativeMetricIds = Object.keys(execution.metrics);
  const report = createTrackReport({
    trackId: plan.trackId,
    claimStatus: plan.claimStatus,
    executionStatus: execution.executionStatus,
    nativeMetricIds: nativeMetricIds.length === 0 ? ["execution"] : nativeMetricIds,
    metrics: nativeMetricIds.length === 0 ? emptyMetrics() : execution.metrics,
    provenance: {
      sourceManifestDigest: plan.sourceManifestDigest,
      runId: plan.id,
      nativeEvidenceDigest: execution.nativeEvidence.digest,
    },
  });
  const trackReportPath = join(input.runRoot, "track-report.json");
  const trialReceiptsPath = join(input.runRoot, "trial-receipts.json");
  writeAppendOnly(trackReportPath, report);
  writeAppendOnly(trialReceiptsPath, execution.trialReceipts);
  const executionStatus = execution.executionStatus;
  const receipt = createEvidenceReceipt({
    plan,
    executionStatus,
    ...(execution.failureOwner === undefined
      ? {}
      : { failureOwner: execution.failureOwner }),
    privateEvidence: {
      task: plan.runSpecDigest,
      candidate: plan.runSpec!.candidateDigest,
      judge: plan.runSpec!.judgeDigest,
      secret: execution.nativeEvidence.digest,
    },
  });
  const publicReceipt = redactEvidenceReceipt(receipt);
  const publicReceiptPath = join(input.runRoot, "public-receipt.json");
  writeAppendOnly(publicReceiptPath, publicReceipt);
  return Object.freeze({
    plan,
    trackReport: report,
    nativeEvidence: execution.nativeEvidence,
    cleanupStatus: execution.cleanupStatus,
    publicReceiptPath,
    trackReportPath,
    trialReceiptsPath,
    publicReceipt,
  });
}
