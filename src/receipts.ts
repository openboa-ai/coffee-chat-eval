import { stableDigest } from "./identity.ts";
import type { RunPlan } from "./eval-core.ts";
import { getEvaluationTrack } from "./track-registry.ts";
import type { ExecutionStatus, FailureOwner, Sha256Digest } from "./types.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

export interface PrivateEvidence {
  readonly task: string;
  readonly candidate: string;
  readonly judge: string;
  readonly secret: string;
}

export interface EvidenceReceipt {
  readonly id: string;
  readonly runId: string;
  readonly trackId: RunPlan["trackId"];
  readonly profile: RunPlan["profile"];
  readonly sourceManifestDigest: Sha256Digest;
  readonly runSpecDigest: Sha256Digest;
  readonly executionStatus: ExecutionStatus;
  readonly claimStatus: RunPlan["claimStatus"];
  readonly failureOwner?: FailureOwner;
  readonly privateEvidence: PrivateEvidence;
}

export interface PublicEvidenceReceipt {
  readonly id: string;
  readonly runId: string;
  readonly trackId: RunPlan["trackId"];
  readonly profile: RunPlan["profile"];
  readonly sourceManifestDigest: Sha256Digest;
  readonly runSpecDigest: Sha256Digest;
  readonly executionStatus: ExecutionStatus;
  readonly claimStatus: RunPlan["claimStatus"];
  readonly failureOwner?: FailureOwner;
}

const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  "measured",
  "unmeasured",
  "skipped",
  "unavailable",
  "invalid",
  "failed",
  "missing",
  "not_implemented",
  "rights_hold",
];
const CLAIM_STATUSES: readonly RunPlan["claimStatus"][] = [
  "calibration",
  "pilot",
  "provisional_internal",
  "reportable",
  "not_active",
];
const FAILURE_OWNERS: readonly FailureOwner[] = [
  "source",
  "rights",
  "host",
  "candidate",
  "adapter",
  "judge",
  "verifier",
  "artifact",
  "cleanup",
];

function requiresFailureOwner(status: ExecutionStatus): boolean {
  return (
    status === "unavailable" ||
    status === "failed" ||
    status === "invalid" ||
    status === "rights_hold"
  );
}

function validateFailureOwner(
  status: ExecutionStatus,
  failureOwner: FailureOwner | undefined,
): void {
  if (requiresFailureOwner(status) && failureOwner === undefined) {
    throw new TypeError(`${status} receipt requires a failure owner`);
  }
  if (status === "rights_hold" && failureOwner !== "rights") {
    throw new TypeError("rights_hold receipt requires rights as the failure owner");
  }
}

export function createEvidenceReceipt(input: {
  readonly plan: RunPlan;
  readonly executionStatus: ExecutionStatus;
  readonly failureOwner?: FailureOwner;
  readonly privateEvidence: PrivateEvidence;
}): EvidenceReceipt {
  validateFailureOwner(input.executionStatus, input.failureOwner);
  const expectedClaim =
    input.plan.profile === "fixture" || input.plan.profile === "smoke"
      ? "calibration"
      : input.plan.profile === "pilot"
        ? "pilot"
        : "provisional_internal";
  if (input.plan.claimStatus !== expectedClaim) {
    throw new TypeError("run plan claim status does not match profile");
  }
  const failureOwner = input.failureOwner;
  const idMaterial = {
    runId: input.plan.id,
    executionStatus: input.executionStatus,
    ...(failureOwner === undefined ? {} : { failureOwner }),
  };
  return Object.freeze({
    id: `receipt-${stableDigest(idMaterial).slice("sha256:".length)}`,
    runId: input.plan.id,
    trackId: input.plan.trackId,
    profile: input.plan.profile,
    sourceManifestDigest: input.plan.sourceManifestDigest,
    runSpecDigest: input.plan.runSpecDigest,
    executionStatus: input.executionStatus,
    claimStatus: input.plan.claimStatus,
    ...(failureOwner === undefined ? {} : { failureOwner }),
    privateEvidence: Object.freeze({ ...input.privateEvidence }),
  });
}

export function redactEvidenceReceipt(receipt: EvidenceReceipt): PublicEvidenceReceipt {
  const failureOwner = receipt.failureOwner;
  return Object.freeze({
    id: receipt.id,
    runId: receipt.runId,
    trackId: receipt.trackId,
    profile: receipt.profile,
    sourceManifestDigest: receipt.sourceManifestDigest,
    runSpecDigest: receipt.runSpecDigest,
    executionStatus: receipt.executionStatus,
    claimStatus: receipt.claimStatus,
    ...(failureOwner === undefined ? {} : { failureOwner }),
  });
}

export function parsePublicEvidenceReceipt(value: unknown): PublicEvidenceReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("public receipt must be an object");
  }
  const receipt = value as Record<string, unknown>;
  const expected = [
    "id",
    "runId",
    "trackId",
    "profile",
    "sourceManifestDigest",
    "runSpecDigest",
    "executionStatus",
    "claimStatus",
    ...(receipt.failureOwner === undefined ? [] : ["failureOwner"]),
  ].sort();
  if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(expected)) {
    throw new TypeError("public receipt has unexpected fields");
  }
  if (
    typeof receipt.id !== "string" ||
    typeof receipt.runId !== "string" ||
    typeof receipt.trackId !== "string" ||
    typeof receipt.profile !== "string" ||
    typeof receipt.sourceManifestDigest !== "string" ||
    typeof receipt.runSpecDigest !== "string" ||
    !DIGEST.test(receipt.sourceManifestDigest) ||
    !DIGEST.test(receipt.runSpecDigest) ||
    !EXECUTION_STATUSES.includes(receipt.executionStatus as ExecutionStatus) ||
    !CLAIM_STATUSES.includes(receipt.claimStatus as RunPlan["claimStatus"])
  ) {
    throw new TypeError("public receipt is invalid");
  }
  if (receipt.id.length === 0 || receipt.runId.length === 0) {
    throw new TypeError("public receipt ids must not be empty");
  }
  if (getEvaluationTrack(receipt.trackId) === undefined) {
    throw new TypeError("public receipt track is unsupported");
  }
  if (
    receipt.profile !== "fixture" &&
    receipt.profile !== "smoke" &&
    receipt.profile !== "pilot" &&
    receipt.profile !== "score"
  ) {
    throw new TypeError("public receipt profile is invalid");
  }
  const expectedClaim =
    receipt.profile === "fixture" || receipt.profile === "smoke"
      ? "calibration"
      : receipt.profile === "pilot"
        ? "pilot"
        : "provisional_internal";
  if (receipt.claimStatus !== expectedClaim) {
    throw new TypeError("public receipt claim status does not match profile");
  }
  if (
    receipt.failureOwner !== undefined &&
    (!FAILURE_OWNERS.includes(receipt.failureOwner as FailureOwner) ||
      typeof receipt.failureOwner !== "string")
  ) {
    throw new TypeError("public receipt failure owner is invalid");
  }
  validateFailureOwner(
    receipt.executionStatus as ExecutionStatus,
    receipt.failureOwner as FailureOwner | undefined,
  );
  return Object.freeze({
    id: receipt.id,
    runId: receipt.runId,
    trackId: receipt.trackId as RunPlan["trackId"],
    profile: receipt.profile as RunPlan["profile"],
    sourceManifestDigest: receipt.sourceManifestDigest as Sha256Digest,
    runSpecDigest: receipt.runSpecDigest as Sha256Digest,
    executionStatus: receipt.executionStatus as ExecutionStatus,
    claimStatus: receipt.claimStatus as RunPlan["claimStatus"],
    ...(receipt.failureOwner === undefined
      ? {}
      : { failureOwner: receipt.failureOwner as FailureOwner }),
  });
}
