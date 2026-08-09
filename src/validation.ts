import { stableDigest } from "./identity.ts";
import type {
  Artifact,
  ArtifactReceipt,
  EvaluatorRef,
  IsolationClass,
  ReceiptError,
  ReceiptErrorCode,
  ReceiptEvidence,
  TrialReceipt,
  TrialSpec,
  Verification,
} from "./types.ts";

const sha256Digest = /^sha256:[0-9a-f]{64}$/u;
const immutablePathSegment = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const officialEvaluatorRepository = "https://github.com/openboa-ai/coffee-chat-eval";

function isSha256Digest(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && sha256Digest.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(record).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isValidEvidenceReference(
  reference: string,
  isolationClass: IsolationClass,
): boolean {
  try {
    const url = new URL(reference);
    if (
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return false;
    }
    const protocol = url.protocol;
    if (isolationClass === "isolated") {
      return (
        protocol === "https:" &&
        url.pathname.split("/").some((segment) => immutablePathSegment.test(segment))
      );
    }
    if (isolationClass === "fixture") {
      return protocol === "fixture:" || protocol === "https:";
    }
    return protocol === "file:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function isSafeHttpsRepositoryUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCalVer(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})\.([1-9]|1[0-2])\.([1-9]|[12]\d|3[01])$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = daysInMonth[month - 1];
  return maximumDay !== undefined && day <= maximumDay;
}

export function canonicalEvaluatorRef(value: unknown): EvaluatorRef | undefined {
  if (!isPlainRecord(value)) return undefined;
  const repository = value.repository;
  const commit = value.commit;
  const calver = value.calver;
  const configurationDigest = value.configurationDigest;
  if (
    repository !== officialEvaluatorRepository ||
    typeof commit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(commit) ||
    !isCalVer(calver) ||
    !isSha256Digest(configurationDigest)
  ) {
    return undefined;
  }
  return snapshotAndFreeze({
    repository,
    commit,
    calver,
    configurationDigest,
  });
}

export function validateTrialProvenance(trial: TrialSpec): boolean {
  try {
    return (
      canonicalEvaluatorRef(trial.evaluator) !== undefined &&
      isSafeHttpsRepositoryUrl(trial.candidate.repository) &&
      /^[0-9a-f]{40}$/u.test(trial.candidate.commit) &&
      isCalVer(trial.candidate.calver) &&
      isNonEmptyString(trial.candidate.adapter) &&
      isNonEmptyString(trial.task.id) &&
      isSha256Digest(trial.task.digest) &&
      isNonEmptyString(trial.harness.id) &&
      isSha256Digest(trial.harness.digest) &&
      isNonEmptyString(trial.model.id) &&
      isSha256Digest(trial.model.digest) &&
      isNonEmptyString(trial.host.id) &&
      ["isolated", "fixture", "process"].includes(trial.host.isolationClass) &&
      isSha256Digest(trial.host.configurationDigest) &&
      isValidEvidenceReference(
        trial.host.isolationReference,
        trial.host.isolationClass,
      ) &&
      Number.isInteger(trial.repetition) &&
      trial.repetition >= 0
    );
  } catch {
    return false;
  }
}

export function validateArtifact(artifact: unknown): Artifact | undefined {
  if (
    !isPlainRecord(artifact) ||
    !hasExactKeys(artifact, ["digest", "id", "value"]) ||
    typeof artifact.id !== "string" ||
    artifact.id.trim().length === 0 ||
    typeof artifact.value !== "string" ||
    !isSha256Digest(artifact.digest) ||
    artifact.digest !== stableDigest(artifact.value)
  ) {
    return undefined;
  }
  return artifact as unknown as Artifact;
}

export function validateArtifactLocator(
  value: unknown,
  isolationClass: IsolationClass,
): string | undefined {
  return typeof value === "string" && isValidEvidenceReference(value, isolationClass)
    ? value
    : undefined;
}

export function artifactReceipt(artifact: Artifact, locator: string): ArtifactReceipt {
  return Object.freeze({
    locator,
    digest: artifact.digest,
    byteSize: Buffer.byteLength(artifact.value, "utf8"),
  });
}

export function validateHostEvidence(
  evidence: unknown,
  isolationClass: IsolationClass,
  expected: {
    readonly trialId: string;
    readonly artifactDigest: `sha256:${string}`;
    readonly artifactLocator: string;
  },
): ReceiptEvidence | undefined {
  if (
    !isPlainRecord(evidence) ||
    !hasExactKeys(evidence, [
      "artifactDigest",
      "artifactLocator",
      "detail",
      "digest",
      "reference",
      "trialId",
    ]) ||
    typeof evidence.reference !== "string" ||
    !isValidEvidenceReference(evidence.reference, isolationClass) ||
    !isSha256Digest(evidence.digest) ||
    typeof evidence.detail !== "string" ||
    evidence.detail.trim().length === 0 ||
    evidence.trialId !== expected.trialId ||
    evidence.artifactDigest !== expected.artifactDigest ||
    evidence.artifactLocator !== expected.artifactLocator ||
    evidence.digest !==
      stableDigest({
        reference: evidence.reference,
        detail: evidence.detail,
        trialId: evidence.trialId,
        artifactDigest: evidence.artifactDigest,
        artifactLocator: evidence.artifactLocator,
      })
  ) {
    return undefined;
  }
  return Object.freeze({
    locator: evidence.reference,
    digest: evidence.digest,
    trialId: evidence.trialId,
    artifactDigest: evidence.artifactDigest,
    artifactLocator: evidence.artifactLocator,
  });
}

export function validateMetrics(
  metrics: unknown,
): Readonly<Record<string, number>> | undefined {
  if (!isPlainRecord(metrics)) return undefined;
  const entries = Object.entries(metrics);
  if (entries.length === 0) return undefined;
  for (const [name, value] of entries) {
    if (
      name.trim().length === 0 ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      return undefined;
    }
  }
  return snapshotAndFreeze(Object.fromEntries(entries) as Record<string, number>);
}

export function validateVerification(value: unknown):
  | { readonly kind: "valid"; readonly verification: Verification }
  | {
      readonly kind: "invalid";
      readonly error: "verification_metrics_invalid" | "verification_result_invalid";
    } {
  if (!isPlainRecord(value) || typeof value.status !== "string") {
    return { kind: "invalid", error: "verification_result_invalid" };
  }
  if (value.status === "valid") {
    if (!hasExactKeys(value, ["metrics", "status"])) {
      return { kind: "invalid", error: "verification_result_invalid" };
    }
    const metrics = validateMetrics(value.metrics);
    if (!metrics) {
      return { kind: "invalid", error: "verification_metrics_invalid" };
    }
    return {
      kind: "valid",
      verification: snapshotAndFreeze({ status: "valid", metrics }),
    };
  }
  if (
    value.status === "skipped" ||
    value.status === "unavailable" ||
    value.status === "unmeasured"
  ) {
    if (!hasExactKeys(value, ["reason", "status"]) || !isNonEmptyString(value.reason)) {
      return { kind: "invalid", error: "verification_result_invalid" };
    }
    return {
      kind: "valid",
      verification: snapshotAndFreeze({
        status: value.status,
        reason: value.reason,
      }),
    };
  }
  return { kind: "invalid", error: "verification_result_invalid" };
}

export function receiptError(code: ReceiptErrorCode): ReceiptError {
  return Object.freeze({ code });
}

export function snapshotAndFreeze<T>(value: T): T {
  return freezeRecursively(structuredClone(value));
}

function freezeRecursively<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const nested of Object.values(value)) freezeRecursively(nested);
  return Object.freeze(value);
}

export function receiptDigest(receipt: unknown): `sha256:${string}` {
  return stableDigest(receipt);
}

export function immutableReceipt(
  receipt: Omit<TrialReceipt, "receiptDigest">,
): TrialReceipt {
  const snapshot = snapshotAndFreeze(receipt);
  const digest = receiptDigest(snapshot);
  return freezeRecursively({ ...snapshot, receiptDigest: digest });
}
