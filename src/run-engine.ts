import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  createRunPlan,
  createTrialReceipt,
  createTrackReport,
  parseRunSpec,
  parseSourceManifest,
  parseProductCandidateBoundary,
  runProfileCandidateCompatibilityError,
  type CandidateTransport,
  type JudgeTransport,
  type PrivateArtifactRef,
  type RunPlan,
  type SourceManifest,
  type TrackExecutionResult,
  type TrackReport,
  type TrialReceipt,
  type ProductCandidateBoundary,
} from "./eval-core.ts";
import { stableDigest } from "./identity.ts";
import {
  IFEVAL_NATIVE_RUNTIME_RIGHTS_HOLD_REASON,
  type IfevalRightsRiskAcceptance,
  ifevalNativeRuntimeRequiresRightsHold,
  validateIfevalPrivateSmokeRiskAcceptance,
} from "./ifeval.ts";
import { createEvidenceReceipt, redactEvidenceReceipt } from "./receipts.ts";
import { putEvidence } from "./evidence.ts";
import {
  verifyMaterializedSource,
  type MaterializedSourceVerification,
} from "./source-cache.ts";
import { verifySourceManifestPins } from "./source-manifests.ts";
import type { ExecutionStatus, FailureOwner, Sha256Digest } from "./types.ts";
import {
  COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST,
  COFFEE_CHAT_PRODUCT_CALVER,
  COFFEE_CHAT_PRODUCT_COMMIT,
  COFFEE_CHAT_PRODUCT_MODEL,
  COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
  COFFEE_CHAT_PRODUCT_REPOSITORY,
  COFFEE_CHAT_PRODUCT_SEED,
  candidateIdentityDigest,
  judgeIdentityDigest,
  parseCandidateIdentityConfig,
  parseJudgeIdentityConfig,
  parseRuntimeBundleConfig,
  type CandidateIdentityConfig,
  type JudgeIdentityConfig,
  type RuntimeBundleConfig,
} from "./runtime-config.ts";
import { evalOwnedRuntimeLockForTrack } from "./python-runtime.ts";
import type { TrackExecutor } from "./track-executor.ts";
import { getNativeTrackExecutor } from "./native-executors.ts";
import {
  responsesCandidateTransportMatchesRuntime,
  responsesJudgeTransportMatchesRuntime,
} from "./transports.ts";
import {
  coffeeChatProductCandidateTransportMatchesRuntime,
  isUnavailableCoffeeChatProductCandidateTransport,
  verifyCoffeeChatProductPackage,
} from "./product-host.ts";

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

const REJECTED_PLAN_EXECUTOR: TrackExecutor = async () => {
  throw new TypeError("rejected run plan must not reach a native executor");
};

function runPlanClaimStatus(profile: RunPlan["profile"]): RunPlan["claimStatus"] {
  switch (profile) {
    case "fixture":
    case "smoke":
      return "calibration";
    case "pilot":
      return "pilot";
    case "score":
      return "provisional_internal";
  }
}

/**
 * Rebuild every RunPlan field that is derived from its immutable RunSpec.
 * This deliberately does not trust the supplied manifest yet, so a manifest
 * mismatch can still produce the established unavailable/source receipt from
 * a path-safe plan identity.
 */
function rebuildRunPlanEnvelope(plan: RunPlan): RunPlan {
  if (plan.runSpec === undefined) {
    throw new TypeError("run plan is missing immutable runSpec");
  }
  const runSpec = parseRunSpec(plan.runSpec);
  if (!isAbsolute(plan.evidenceRoot)) {
    throw new TypeError("run plan evidenceRoot must be an absolute path");
  }
  if (!isAbsolute(plan.cacheRoot)) {
    throw new TypeError("run plan cacheRoot must be an absolute path");
  }
  const sourceManifestDigest = runSpec.sourceManifestDigest;
  const runSpecDigest = stableDigest(runSpec);
  return Object.freeze({
    id: `run-${stableDigest({ sourceManifestDigest, runSpecDigest }).slice("sha256:".length)}`,
    trackId: runSpec.trackId,
    profile: runSpec.profile,
    sourceManifestDigest,
    runSpecDigest,
    claimStatus: runPlanClaimStatus(runSpec.profile),
    executionStatus: "unmeasured" as const,
    evidenceRoot: resolve(plan.evidenceRoot),
    cacheRoot: resolve(plan.cacheRoot),
    runSpec,
  });
}

/**
 * Validate ephemeral broker capabilities against the immutable run identity.
 * Non-Product identity/model matching is performed by the CLI when it has the
 * separate candidate/Judge identity files. This common check owns the exact
 * admitted Product model plus scope, expiry, and the least-privilege smoke
 * budgets used by every entry point.
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
  if (
    spec.candidateType === "coffee_chat_product" &&
    runtime.productHost === undefined
  ) {
    return Object.freeze({
      failureOwner: "host" as const,
      reason: "coffee_chat_product runtime requires the reference product host",
    });
  }
  if (
    spec.candidateType !== "coffee_chat_product" &&
    runtime.productHost !== undefined
  ) {
    return Object.freeze({
      failureOwner: "host" as const,
      reason: "productHost is only valid for coffee_chat_product",
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
  if (
    spec.candidateType === "coffee_chat_product" &&
    candidate.model !== COFFEE_CHAT_PRODUCT_MODEL
  ) {
    return Object.freeze({
      failureOwner: "host" as const,
      reason: "candidate runtime model does not match admitted Product identity",
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
  readonly ifevalRightsRiskAcceptance?: IfevalRightsRiskAcceptance | undefined;
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
    ifevalRightsRiskAcceptance: input.ifevalRightsRiskAcceptance,
    evidence: ({ value, mediaType }) =>
      privateArtifact(input.plan.evidenceRoot, value, mediaType),
  });
}

function productBoundaryForCandidate(
  candidate: CandidateTransport,
): ProductCandidateBoundary | undefined {
  return candidate.productBoundary === undefined
    ? undefined
    : parseProductCandidateBoundary(candidate.productBoundary);
}

function decorateTrialReceipts(
  receipts: readonly TrialReceipt[],
  productBoundary: ProductCandidateBoundary | undefined,
): readonly TrialReceipt[] {
  if (productBoundary === undefined) return receipts;
  return Object.freeze(
    receipts.map((receipt) =>
      createTrialReceipt({
        runId: receipt.runId,
        trackId: receipt.trackId,
        trialId: receipt.trialId,
        executionStatus: receipt.executionStatus,
        ...(receipt.failureOwner === undefined
          ? {}
          : { failureOwner: receipt.failureOwner }),
        host: receipt.host,
        artifacts: receipt.artifacts,
        metrics: receipt.metrics,
        ...(receipt.latencyMs === undefined ? {} : { latencyMs: receipt.latencyMs }),
        ...(receipt.tokenCount === undefined ? {} : { tokenCount: receipt.tokenCount }),
        ...(receipt.cost === undefined ? {} : { cost: receipt.cost }),
        ...(receipt.cleanupStatus === undefined
          ? {}
          : { cleanupStatus: receipt.cleanupStatus }),
        productBoundary,
      }),
    ),
  );
}

export interface ImmutableRunInput {
  readonly plan: RunPlan;
  readonly manifest: SourceManifest;
  readonly candidate: CandidateTransport;
  /** Normalized immutable identity required for standard live candidates. */
  readonly candidateIdentity?: CandidateIdentityConfig | undefined;
  readonly judge: JudgeTransport | undefined;
  /** Normalized immutable identity required for live native-Judge tracks. */
  readonly judgeIdentity?: JudgeIdentityConfig | undefined;
  readonly runtime?: RuntimeBundleConfig | undefined;
  readonly ifevalRightsRiskAcceptance?: IfevalRightsRiskAcceptance | undefined;
  /** Host-owned teardown that must finish before append-only run artifacts finalize. */
  readonly hostCleanup?: (() => Promise<"complete" | "failed">) | undefined;
}

function trialProductBoundary(
  receipt: TrialReceipt,
): ProductCandidateBoundary | undefined {
  if (receipt.candidateMode === undefined) return undefined;
  return parseProductCandidateBoundary({
    candidateMode: receipt.candidateMode,
    capabilitiesUsed: receipt.capabilitiesUsed,
    productBehaviorExercised: receipt.productBehaviorExercised,
    referenceHost: receipt.referenceHost,
    productIdentity: receipt.productIdentity,
  });
}

function cleanupFailureExecution(input: {
  readonly execution: TrackExecutionResult;
  readonly evidence: (value: unknown, mediaType: string) => PrivateArtifactRef;
}): TrackExecutionResult {
  return Object.freeze({
    executionStatus: "invalid" as const,
    failureOwner: "cleanup" as const,
    trialReceipts: Object.freeze(
      input.execution.trialReceipts.map((receipt) => {
        const productBoundary = trialProductBoundary(receipt);
        return createTrialReceipt({
          runId: receipt.runId,
          trackId: receipt.trackId,
          trialId: receipt.trialId,
          executionStatus: "invalid",
          failureOwner: "cleanup",
          host: receipt.host,
          artifacts: receipt.artifacts,
          metrics: null,
          ...(receipt.latencyMs === undefined ? {} : { latencyMs: receipt.latencyMs }),
          ...(receipt.tokenCount === undefined
            ? {}
            : { tokenCount: receipt.tokenCount }),
          ...(receipt.cost === undefined ? {} : { cost: receipt.cost }),
          cleanupStatus: "failed",
          ...(productBoundary === undefined ? {} : { productBoundary }),
        });
      }),
    ),
    metrics: emptyMetrics(),
    nativeEvidence: input.evidence(
      {
        reason: "host or track cleanup failed",
        owner: "cleanup",
        priorNativeEvidenceDigest: input.execution.nativeEvidence.digest,
      },
      "application/json",
    ),
    cleanupStatus: "failed" as const,
  });
}

export async function executeImmutableRun(
  input: ImmutableRunInput,
): Promise<ImmutableRunResult> {
  if ("executor" in input) {
    throw new TypeError("run executor override is not supported");
  }
  // Snapshot and rebuild the public plan contract before selecting a native
  // executor or creating any path derived from a caller-supplied plan ID.
  // Malformed inputs are rejected without filesystem effects because no safe
  // canonical receipt identity exists for them.
  const envelopePlan = rebuildRunPlanEnvelope(input.plan);
  const manifest = parseSourceManifest(input.manifest);
  if (stableDigest(manifest) !== envelopePlan.sourceManifestDigest) {
    return executeImmutableRunWithExecutor({
      ...input,
      plan: envelopePlan,
      manifest,
      executor: REJECTED_PLAN_EXECUTOR,
      planPreflightFailure: Object.freeze({
        owner: "source" as const,
        reason: "source manifest digest does not match run plan",
      }),
    });
  }
  let canonicalPlan: RunPlan;
  try {
    canonicalPlan = createRunPlan({
      manifest,
      spec: envelopePlan.runSpec!,
      evidenceRoot: envelopePlan.evidenceRoot,
      cacheRoot: envelopePlan.cacheRoot,
    });
  } catch (error) {
    return executeImmutableRunWithExecutor({
      ...input,
      plan: envelopePlan,
      manifest,
      executor: REJECTED_PLAN_EXECUTOR,
      planPreflightFailure: Object.freeze({
        owner: "source" as const,
        reason: error instanceof Error ? error.message : "source manifest is invalid",
      }),
    });
  }
  let planMatches = false;
  try {
    planMatches = stableDigest(input.plan) === stableDigest(canonicalPlan);
  } catch {
    planMatches = false;
  }
  if (!planMatches) {
    return executeImmutableRunWithExecutor({
      ...input,
      plan: canonicalPlan,
      manifest,
      executor: REJECTED_PLAN_EXECUTOR,
      planPreflightFailure: Object.freeze({
        owner: "verifier" as const,
        reason: "run plan does not match its canonical manifest and runSpec",
      }),
    });
  }
  return executeImmutableRunWithExecutor({
    ...input,
    plan: canonicalPlan,
    manifest,
    executor: getNativeTrackExecutor(canonicalPlan.trackId),
  });
}

async function executeImmutableRunWithExecutor(
  input: ImmutableRunInput & {
    readonly executor: TrackExecutor;
    readonly planPreflightFailure?:
      | {
          readonly owner: "source" | "verifier";
          readonly reason: string;
        }
      | undefined;
  },
): Promise<ImmutableRunResult> {
  const plan = input.plan;
  const runRoot = resolve(plan.evidenceRoot, plan.id);
  mkdirSync(runRoot, { recursive: true });
  const evidence = (value: unknown, mediaType: string) =>
    privateArtifact(plan.evidenceRoot, value, mediaType);
  let rightsRiskAcceptanceValidated = false;
  let verifiedProductBoundary: ProductCandidateBoundary | undefined;
  const finalize = async (
    execution: TrackExecutionResult,
    source: MaterializedSourceVerification | undefined,
  ) => {
    let hostCleanupStatus: "complete" | "failed" = "complete";
    if (input.hostCleanup !== undefined) {
      try {
        hostCleanupStatus = await input.hostCleanup();
      } catch {
        hostCleanupStatus = "failed";
      }
    }
    const finalizedExecution =
      hostCleanupStatus === "complete" && execution.cleanupStatus === "complete"
        ? execution
        : cleanupFailureExecution({ execution, evidence });
    return finalizeRun({
      input,
      execution: finalizedExecution,
      source,
      runRoot,
      rightsRiskAcceptanceValidated,
      verifiedProductBoundary,
    });
  };
  if (input.planPreflightFailure !== undefined) {
    const execution = failureExecution({
      owner: input.planPreflightFailure.owner,
      reason: input.planPreflightFailure.reason,
      evidence,
    });
    return finalize(execution, undefined);
  }
  if (plan.runSpec === undefined) {
    const execution = failureExecution({
      owner: "verifier",
      reason: "run plan is missing immutable runSpec",
      evidence,
    });
    return finalize(execution, undefined);
  }
  const runSpec = plan.runSpec;
  let execution: TrackExecutionResult;
  let source: MaterializedSourceVerification | undefined;
  const compatibilityError = runProfileCandidateCompatibilityError(
    runSpec.profile,
    runSpec.candidateType,
  );
  if (compatibilityError !== undefined) {
    execution = failureExecution({
      owner: "verifier",
      reason: compatibilityError,
      evidence,
    });
    return finalize(execution, source);
  }
  if (runSpec.candidateType !== input.candidate.kind) {
    execution = failureExecution({
      owner: "verifier",
      reason: "candidate transport kind does not match run candidateType identity",
      evidence,
    });
    return finalize(execution, source);
  }
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
    return finalize(execution, source);
  }
  if (
    runSpec.candidateType === "coffee_chat_product" &&
    runSpec.candidateDigest !== COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST
  ) {
    execution = failureExecution({
      owner: "verifier",
      reason:
        "run candidate digest does not match the admitted Product candidate identity",
      evidence,
    });
    return finalize(execution, source);
  }
  if (
    runSpec.candidateType === "coffee_chat_product" &&
    runSpec.seed !== COFFEE_CHAT_PRODUCT_SEED
  ) {
    execution = failureExecution({
      owner: "verifier",
      reason: "run Product candidate seed does not match the admitted identity",
      evidence,
    });
    return finalize(execution, source);
  }
  let runtime: RuntimeBundleConfig | undefined = input.runtime;
  if (runSpec.candidateType === "coffee_chat_product") {
    try {
      runtime =
        input.runtime === undefined
          ? undefined
          : parseRuntimeBundleConfig(input.runtime);
    } catch (error) {
      execution = failureExecution({
        owner: "host",
        reason: error instanceof Error ? error.message : "runtime bundle is invalid",
        evidence,
      });
      return finalize(execution, source);
    }
  }
  if (
    runSpec.candidateType === "coffee_chat_product" &&
    runtime !== undefined &&
    runtime.candidate.model !== COFFEE_CHAT_PRODUCT_MODEL
  ) {
    execution = failureExecution({
      owner: "host",
      reason: "candidate runtime model does not match admitted Product identity",
      evidence,
    });
    return finalize(execution, source);
  }
  if (
    runSpec.candidateType === "coffee_chat_product" &&
    runtime === undefined &&
    !(runSpec.trackId === "ifeval" && input.ifevalRightsRiskAcceptance === undefined)
  ) {
    execution = failureExecution({
      owner: "host",
      reason: "live candidate runtime capability is missing",
      evidence,
    });
    return finalize(execution, source);
  }
  if (
    runSpec.candidateType === "coffee_chat_product" &&
    runtime !== undefined &&
    !coffeeChatProductCandidateTransportMatchesRuntime(
      input.candidate,
      runtime.candidate,
      plan.evidenceRoot,
    )
  ) {
    const unavailablePreparation = isUnavailableCoffeeChatProductCandidateTransport(
      input.candidate,
    );
    execution = failureExecution({
      owner: unavailablePreparation ? "host" : "verifier",
      reason: unavailablePreparation
        ? "coffee_chat_product candidate preparation is unavailable"
        : "coffee_chat_product transport is not bound to the normalized Responses candidate runtime",
      evidence,
    });
    return finalize(execution, source);
  }
  const declaredCandidateType = runSpec.candidateType ?? input.candidate.kind;
  if (
    runSpec.trackId === "ifeval" &&
    (ifevalNativeRuntimeRequiresRightsHold(declaredCandidateType) ||
      ifevalNativeRuntimeRequiresRightsHold(input.candidate.kind))
  ) {
    try {
      const acceptance = validateIfevalPrivateSmokeRiskAcceptance({
        profile: runSpec.profile,
        candidateType: input.candidate.kind,
        expectedDigest: runSpec.rightsRiskAcceptanceDigest,
        expectedCandidateDigest: runSpec.candidateDigest,
        receipt: input.ifevalRightsRiskAcceptance,
      });
      // Preserve the private receipt under EVIDENCE_ROOT without exposing its
      // body, operator, timestamp, or local source path in public provenance.
      evidence(acceptance, "application/json");
      rightsRiskAcceptanceValidated = true;
    } catch (error) {
      execution = failureExecution({
        owner: "rights",
        reason:
          error instanceof Error
            ? error.message
            : IFEVAL_NATIVE_RUNTIME_RIGHTS_HOLD_REASON,
        evidence,
      });
      return finalize(execution, source);
    }
  } else if (input.ifevalRightsRiskAcceptance !== undefined) {
    execution = failureExecution({
      owner: "verifier",
      reason: "IFEval rights risk acceptance is outside its admitted run scope",
      evidence,
    });
    return finalize(execution, source);
  }
  const declaredProductBoundary = productBoundaryForCandidate(input.candidate);
  if (runSpec.candidateType === "coffee_chat_product") {
    if (input.candidate.kind !== "coffee_chat_product") {
      execution = failureExecution({
        owner: "host",
        reason: "coffee_chat_product run requires a product candidate transport",
        evidence,
      });
      return finalize(execution, source);
    }
    if (declaredProductBoundary === undefined) {
      execution = failureExecution({
        owner: "host",
        reason: "coffee_chat_product transport is missing immutable product provenance",
        evidence,
      });
      return finalize(execution, source);
    }
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
    return finalize(execution, source);
  }
  if (
    runSpec.candidateType !== "coffee_chat_product" &&
    (input.candidate.kind === "coffee_chat_product" ||
      declaredProductBoundary !== undefined ||
      input.candidate.productHostPreflight !== undefined)
  ) {
    execution = failureExecution({
      owner: "host",
      reason: "product candidate transport does not match run identity",
      evidence,
    });
    return finalize(execution, source);
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
    return finalize(execution, source);
  }
  if (
    runSpec.candidateType !== "coffee_chat_product" &&
    runSpec.candidateType !== "fixture" &&
    runtime !== undefined
  ) {
    try {
      runtime = parseRuntimeBundleConfig(runtime);
    } catch (error) {
      execution = failureExecution({
        owner: "host",
        reason: error instanceof Error ? error.message : "runtime bundle is invalid",
        evidence,
      });
      return finalize(execution, source);
    }
  }
  const runtimeFailure = validateRuntimeForRun({ plan, runtime });
  if (runtimeFailure !== undefined) {
    execution = failureExecution({
      owner: runtimeFailure.failureOwner,
      reason: runtimeFailure.reason,
      evidence,
    });
    return finalize(execution, source);
  }
  let standardCandidateIdentity: CandidateIdentityConfig | undefined;
  if (
    runSpec.candidateType === "reference_model" ||
    runSpec.candidateType === "agent_stack"
  ) {
    try {
      if (input.candidateIdentity === undefined) {
        throw new TypeError("live standard candidate identity is missing");
      }
      standardCandidateIdentity = parseCandidateIdentityConfig(input.candidateIdentity);
      if (standardCandidateIdentity.candidateType !== runSpec.candidateType) {
        throw new TypeError("candidate identity type does not match run candidateType");
      }
      if (
        candidateIdentityDigest(standardCandidateIdentity) !== runSpec.candidateDigest
      ) {
        throw new TypeError("candidate identity digest does not match run plan");
      }
      if (standardCandidateIdentity.seed !== runSpec.seed) {
        throw new TypeError("candidate identity seed does not match run plan");
      }
      if (runtime?.candidate.model !== standardCandidateIdentity.model) {
        throw new TypeError("candidate runtime model does not match run identity");
      }
    } catch (error) {
      execution = failureExecution({
        owner: "verifier",
        reason:
          error instanceof Error ? error.message : "candidate identity is invalid",
        evidence,
      });
      return finalize(execution, source);
    }
  }
  if (
    (runSpec.candidateType === "reference_model" ||
      runSpec.candidateType === "agent_stack") &&
    (runtime === undefined ||
      !responsesCandidateTransportMatchesRuntime(
        input.candidate,
        runtime.candidate,
        plan.evidenceRoot,
        runSpec.candidateDigest,
      ))
  ) {
    execution = failureExecution({
      owner: "verifier",
      reason:
        "live candidate transport is not bound to the normalized Responses candidate runtime",
      evidence,
    });
    return finalize(execution, source);
  }
  const liveNativeJudgeRequired =
    declaredCandidateType !== "fixture" &&
    (runSpec.trackId === "coffee-chat-taste" || runSpec.trackId === "beam-record-core");
  let normalizedJudgeIdentity: JudgeIdentityConfig | undefined;
  if (liveNativeJudgeRequired) {
    try {
      if (input.judgeIdentity === undefined) {
        throw new TypeError("live native Judge identity is missing");
      }
      normalizedJudgeIdentity = parseJudgeIdentityConfig(input.judgeIdentity);
      if (judgeIdentityDigest(normalizedJudgeIdentity) !== runSpec.judgeDigest) {
        throw new TypeError("Judge identity digest does not match run plan");
      }
      if (runtime?.judge?.model !== normalizedJudgeIdentity.model) {
        throw new TypeError("Judge runtime model does not match run identity");
      }
    } catch (error) {
      execution = failureExecution({
        owner: "verifier",
        reason: error instanceof Error ? error.message : "Judge identity is invalid",
        evidence,
      });
      return finalize(execution, source);
    }
  }
  if (
    liveNativeJudgeRequired &&
    (input.judge === undefined ||
      runtime?.judge === undefined ||
      !responsesJudgeTransportMatchesRuntime(
        input.judge,
        runtime.judge,
        plan.evidenceRoot,
        runSpec.judgeDigest,
      ))
  ) {
    execution = failureExecution({
      owner: "verifier",
      reason:
        "live native Judge transport is not bound to the normalized Responses Judge runtime",
      evidence,
    });
    return finalize(execution, source);
  }
  if (runSpec.candidateType === "coffee_chat_product") {
    const productHost = runtime?.productHost;
    if (productHost === undefined) {
      execution = failureExecution({
        owner: "host",
        reason: "coffee_chat_product runtime requires the reference product host",
        evidence,
      });
      return finalize(execution, source);
    }
    const verification = await verifyCoffeeChatProductPackage({
      packageRoot: productHost.packageRoot,
      identity: {
        repository: COFFEE_CHAT_PRODUCT_REPOSITORY,
        commit: COFFEE_CHAT_PRODUCT_COMMIT,
        calver: COFFEE_CHAT_PRODUCT_CALVER,
        packageDigest: COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
        mode: "connectivity_only",
      },
    });
    if (verification.state !== "verified") {
      execution = failureExecution({
        owner: verification.failureOwner,
        reason: verification.reason,
        evidence,
      });
      return finalize(execution, source);
    }
    if (
      declaredProductBoundary === undefined ||
      stableDigest(declaredProductBoundary) !== stableDigest(verification.metadata)
    ) {
      execution = failureExecution({
        owner: "host",
        reason: "product transport provenance does not match verified package bytes",
        evidence,
      });
      return finalize(execution, source);
    }
    verifiedProductBoundary = verification.metadata;
  }
  const expectedRuntimeLockPath = evalOwnedRuntimeLockForTrack(input.manifest.trackId);
  try {
    source = verifyMaterializedSource({
      manifest: input.manifest,
      cacheRoot: plan.cacheRoot,
      ...(expectedRuntimeLockPath === undefined ? {} : { expectedRuntimeLockPath }),
    });
  } catch (error) {
    execution = failureExecution({
      owner: "source",
      reason:
        error instanceof Error ? error.message : "materialized source unavailable",
      evidence,
    });
    return finalize(execution, source);
  }
  // Source and Product verification can outlive a short-lived broker
  // capability. Recheck both candidate and Judge deadlines at the last
  // evaluator-owned boundary before native code can dispatch either one.
  const dispatchRuntimeFailure = validateRuntimeForRun({ plan, runtime });
  if (dispatchRuntimeFailure !== undefined) {
    execution = failureExecution({
      owner: dispatchRuntimeFailure.failureOwner,
      reason: dispatchRuntimeFailure.reason,
      evidence,
    });
    return finalize(execution, source);
  }
  try {
    execution = await materializedSourceResult({ ...input, runtime, source });
  } catch (error) {
    const owner = adapterFailureOwner(error);
    execution = failureExecution({
      owner,
      reason: error instanceof Error ? error.message : "track executor failed",
      evidence,
    });
  }
  execution = Object.freeze({
    ...execution,
    trialReceipts: decorateTrialReceipts(
      execution.trialReceipts,
      verifiedProductBoundary,
    ),
  });
  return finalize(execution, source);
}

async function finalizeRun(input: {
  readonly input: {
    readonly plan: RunPlan;
    readonly manifest: SourceManifest;
    readonly candidate: CandidateTransport;
  };
  readonly execution: TrackExecutionResult;
  readonly source: MaterializedSourceVerification | undefined;
  readonly runRoot: string;
  readonly rightsRiskAcceptanceValidated: boolean;
  readonly verifiedProductBoundary: ProductCandidateBoundary | undefined;
}): Promise<ImmutableRunResult> {
  const { plan } = input.input;
  const rightsRiskAcceptanceValidated = input.rightsRiskAcceptanceValidated;
  const productBoundary = input.verifiedProductBoundary;
  const rightsRiskProvenanceValidated =
    rightsRiskAcceptanceValidated && productBoundary !== undefined;
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
      ...(!rightsRiskProvenanceValidated ||
      plan.runSpec?.rightsRiskAcceptanceDigest === undefined
        ? {}
        : {
            rightsRiskAcceptanceDigest: plan.runSpec.rightsRiskAcceptanceDigest,
            licenseCleared: false as const,
            rightsExecutionScope: "private-internal-smoke-only" as const,
          }),
      ...(productBoundary === undefined ? {} : productBoundary),
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
    ...(productBoundary === undefined ? {} : { productBoundary }),
    rightsRiskAcceptanceValidated: rightsRiskProvenanceValidated,
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
