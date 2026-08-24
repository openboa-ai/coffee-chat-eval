import { stableDigest } from "./identity.ts";
import {
  parseProductCandidateBoundary,
  type ProductCandidateBoundary,
  type RunPlan,
} from "./eval-core.ts";
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
  readonly rightsRiskAcceptanceDigest?: Sha256Digest;
  readonly licenseCleared?: false;
  readonly rightsExecutionScope?: "private-internal-smoke-only";
  readonly privateEvidence: PrivateEvidence;
  readonly candidateMode?: ProductCandidateBoundary["candidateMode"];
  readonly capabilitiesUsed?: ProductCandidateBoundary["capabilitiesUsed"];
  readonly productBehaviorExercised?: ProductCandidateBoundary["productBehaviorExercised"];
  readonly referenceHost?: ProductCandidateBoundary["referenceHost"];
  readonly productIdentity?: ProductCandidateBoundary["productIdentity"];
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
  readonly rightsRiskAcceptanceDigest?: Sha256Digest;
  readonly licenseCleared?: false;
  readonly rightsExecutionScope?: "private-internal-smoke-only";
  readonly candidateMode?: ProductCandidateBoundary["candidateMode"];
  readonly capabilitiesUsed?: ProductCandidateBoundary["capabilitiesUsed"];
  readonly productBehaviorExercised?: ProductCandidateBoundary["productBehaviorExercised"];
  readonly referenceHost?: ProductCandidateBoundary["referenceHost"];
  readonly productIdentity?: ProductCandidateBoundary["productIdentity"];
}

const PRODUCT_BOUNDARY_KEYS = Object.freeze([
  "candidateMode",
  "capabilitiesUsed",
  "productBehaviorExercised",
  "referenceHost",
  "productIdentity",
] as const);
const RIGHTS_RISK_PROVENANCE_KEYS = Object.freeze([
  "rightsRiskAcceptanceDigest",
  "licenseCleared",
  "rightsExecutionScope",
] as const);

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
  readonly productBoundary?: ProductCandidateBoundary;
  readonly rightsRiskAcceptanceValidated?: boolean;
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
  const productBoundary =
    input.productBoundary === undefined
      ? undefined
      : parseProductCandidateBoundary(input.productBoundary);
  let rightsRiskAcceptanceDigest: Sha256Digest | undefined;
  if (input.rightsRiskAcceptanceValidated === true) {
    const acceptanceDigest = input.plan.runSpec?.rightsRiskAcceptanceDigest;
    if (
      acceptanceDigest === undefined ||
      !DIGEST.test(acceptanceDigest) ||
      input.plan.trackId !== "ifeval" ||
      input.plan.profile !== "smoke" ||
      input.plan.runSpec?.candidateType !== "coffee_chat_product" ||
      productBoundary === undefined
    ) {
      throw new TypeError(
        "IFEval rights risk provenance requires the exact Product candidate boundary",
      );
    }
    rightsRiskAcceptanceDigest = acceptanceDigest;
  }
  const idMaterial = {
    runId: input.plan.id,
    executionStatus: input.executionStatus,
    ...(failureOwner === undefined ? {} : { failureOwner }),
    ...(rightsRiskAcceptanceDigest === undefined
      ? {}
      : {
          rightsRiskAcceptanceDigest,
          licenseCleared: false as const,
          rightsExecutionScope: "private-internal-smoke-only" as const,
        }),
    ...(productBoundary === undefined ? {} : productBoundary),
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
    ...(rightsRiskAcceptanceDigest === undefined
      ? {}
      : {
          rightsRiskAcceptanceDigest,
          licenseCleared: false as const,
          rightsExecutionScope: "private-internal-smoke-only" as const,
        }),
    privateEvidence: Object.freeze({ ...input.privateEvidence }),
    ...(productBoundary === undefined ? {} : productBoundary),
  });
}

export function redactEvidenceReceipt(receipt: EvidenceReceipt): PublicEvidenceReceipt {
  const receiptRecord = receipt as unknown as Record<string, unknown>;
  const failureOwner = receipt.failureOwner;
  const hasProductBoundary = PRODUCT_BOUNDARY_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(receiptRecord, key),
  );
  const productBoundary = hasProductBoundary
    ? parseProductCandidateBoundary(
        Object.fromEntries(
          PRODUCT_BOUNDARY_KEYS.map((key) => [key, receiptRecord[key]]),
        ),
        "evidence receipt product boundary",
      )
    : undefined;
  const hasRightsRiskAcceptance = RIGHTS_RISK_PROVENANCE_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(receiptRecord, key),
  );
  let rightsRiskAcceptanceDigest: Sha256Digest | undefined;
  if (hasRightsRiskAcceptance) {
    if (
      typeof receipt.rightsRiskAcceptanceDigest !== "string" ||
      !DIGEST.test(receipt.rightsRiskAcceptanceDigest) ||
      receipt.licenseCleared !== false ||
      receipt.rightsExecutionScope !== "private-internal-smoke-only" ||
      receipt.trackId !== "ifeval" ||
      receipt.profile !== "smoke" ||
      productBoundary === undefined
    ) {
      throw new TypeError(
        "evidence receipt rights risk provenance requires the exact Product candidate boundary",
      );
    }
    rightsRiskAcceptanceDigest = receipt.rightsRiskAcceptanceDigest as Sha256Digest;
  }
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
    ...(rightsRiskAcceptanceDigest === undefined
      ? {}
      : {
          rightsRiskAcceptanceDigest,
          licenseCleared: false as const,
          rightsExecutionScope: "private-internal-smoke-only" as const,
        }),
    ...(productBoundary === undefined ? {} : productBoundary),
  });
}

export function parsePublicEvidenceReceipt(value: unknown): PublicEvidenceReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("public receipt must be an object");
  }
  const receipt = value as Record<string, unknown>;
  const hasProductBoundary = PRODUCT_BOUNDARY_KEYS.some((key) => key in receipt);
  const hasRightsRiskAcceptance =
    "rightsRiskAcceptanceDigest" in receipt ||
    "licenseCleared" in receipt ||
    "rightsExecutionScope" in receipt;
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
    ...(hasRightsRiskAcceptance
      ? ["rightsRiskAcceptanceDigest", "licenseCleared", "rightsExecutionScope"]
      : []),
    ...(hasProductBoundary ? PRODUCT_BOUNDARY_KEYS : []),
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
  const productBoundary = hasProductBoundary
    ? parseProductCandidateBoundary(
        Object.fromEntries(PRODUCT_BOUNDARY_KEYS.map((key) => [key, receipt[key]])),
        "public receipt product boundary",
      )
    : undefined;
  let rightsRiskAcceptanceDigest: Sha256Digest | undefined;
  if (hasRightsRiskAcceptance) {
    if (
      typeof receipt.rightsRiskAcceptanceDigest !== "string" ||
      !DIGEST.test(receipt.rightsRiskAcceptanceDigest) ||
      receipt.licenseCleared !== false ||
      receipt.rightsExecutionScope !== "private-internal-smoke-only" ||
      receipt.trackId !== "ifeval" ||
      receipt.profile !== "smoke" ||
      productBoundary === undefined
    ) {
      throw new TypeError("public receipt rights risk provenance is invalid");
    }
    rightsRiskAcceptanceDigest = receipt.rightsRiskAcceptanceDigest as Sha256Digest;
  }
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
    ...(rightsRiskAcceptanceDigest === undefined
      ? {}
      : {
          rightsRiskAcceptanceDigest,
          licenseCleared: false as const,
          rightsExecutionScope: "private-internal-smoke-only" as const,
        }),
    ...(productBoundary === undefined ? {} : productBoundary),
  });
}
