import { stableDigest } from "./identity.ts";
import type {
  Artifact,
  ArtifactPersistenceAttestation,
  ArtifactReceipt,
  HostEvidence,
  HostRef,
  IsolationAttestation,
  EvaluatorRef,
  IsolationClass,
  ReceiptError,
  ReceiptErrorCode,
  TrialReceipt,
  TrialSpec,
  Verification,
} from "./types.ts";

type ClosedCandidateRun =
  | { readonly kind: "success"; readonly artifact?: Artifact }
  | { readonly kind: "failure"; readonly message: string };

type ClosedHostExecution =
  | { readonly kind: "host_failure"; readonly message: string }
  | {
      readonly kind: "completed";
      readonly evidence?: unknown;
      readonly candidate: ClosedCandidateRun;
    };

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

function canonicalClosedRecord(
  value: unknown,
  expectedShapes?: readonly (readonly string[])[],
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) return undefined;
    const stringKeys = ownKeys as string[];
    if (
      expectedShapes &&
      !expectedShapes.some(
        (expected) =>
          expected.length === stringKeys.length &&
          expected.every((key) => stringKeys.includes(key)),
      )
    ) {
      return undefined;
    }
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of stringKeys) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        return undefined;
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    return undefined;
  }
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

export function canonicalTrialInput(
  value: unknown,
  evaluator: EvaluatorRef,
): {
  readonly declaredEvaluator: EvaluatorRef | undefined;
  readonly trial: TrialSpec | undefined;
} {
  let declaredEvaluator: EvaluatorRef | undefined;
  try {
    if (!isPlainRecord(value)) {
      return { declaredEvaluator: undefined, trial: undefined };
    }
    declaredEvaluator = canonicalEvaluatorRef(value.evaluator);
    if (
      !isPlainRecord(value.candidate) ||
      !isPlainRecord(value.task) ||
      !isPlainRecord(value.harness) ||
      !isPlainRecord(value.model) ||
      !isPlainRecord(value.host)
    ) {
      return { declaredEvaluator, trial: undefined };
    }
    const projected = {
      ...(value.id === undefined ? {} : { id: value.id }),
      evaluator,
      candidate: {
        repository: value.candidate.repository,
        commit: value.candidate.commit,
        calver: value.candidate.calver,
        adapter: value.candidate.adapter,
      },
      task: { id: value.task.id, digest: value.task.digest },
      harness: { id: value.harness.id, digest: value.harness.digest },
      model: { id: value.model.id, digest: value.model.digest },
      host: {
        id: value.host.id,
        isolationClass: value.host.isolationClass,
        configurationDigest: value.host.configurationDigest,
        isolationReference: value.host.isolationReference,
      },
      repetition: value.repetition,
    } as unknown as TrialSpec;
    return validateTrialProvenance(projected)
      ? { declaredEvaluator, trial: snapshotAndFreeze(projected) }
      : { declaredEvaluator, trial: undefined };
  } catch {
    return { declaredEvaluator, trial: undefined };
  }
}

export function validateTrialProvenance(trial: TrialSpec): boolean {
  try {
    return (
      (trial.id === undefined || isNonEmptyString(trial.id)) &&
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
  const snapshot = canonicalClosedRecord(artifact, [["digest", "id", "value"]]);
  if (
    !snapshot ||
    typeof snapshot.id !== "string" ||
    snapshot.id.trim().length === 0 ||
    typeof snapshot.value !== "string" ||
    !isSha256Digest(snapshot.digest) ||
    snapshot.digest !== stableDigest(snapshot.value)
  ) {
    return undefined;
  }
  return Object.freeze({
    id: snapshot.id,
    digest: snapshot.digest,
    value: snapshot.value,
  });
}

export function validateCandidateRunEnvelope(
  value: unknown,
): ClosedCandidateRun | undefined {
  const snapshot = canonicalClosedRecord(value, [
    ["kind"],
    ["artifact", "kind"],
    ["kind", "message"],
  ]);
  if (!snapshot) return undefined;
  if (snapshot.kind === "failure") {
    return Object.hasOwn(snapshot, "message") && isNonEmptyString(snapshot.message)
      ? Object.freeze({ kind: "failure", message: snapshot.message })
      : undefined;
  }
  if (snapshot.kind !== "success" || Object.hasOwn(snapshot, "message")) {
    return undefined;
  }
  if (Object.hasOwn(snapshot, "artifact")) {
    const artifact = validateArtifact(snapshot.artifact);
    return artifact
      ? Object.freeze({ kind: "success", artifact })
      : Object.freeze({ kind: "success" });
  }
  return Object.freeze({ kind: "success" });
}

export function validateHostExecutionEnvelope(
  value: unknown,
): ClosedHostExecution | undefined {
  const snapshot = canonicalClosedRecord(value, [
    ["kind", "message"],
    ["candidate", "kind"],
    ["candidate", "evidence", "kind"],
  ]);
  if (!snapshot) return undefined;
  if (snapshot.kind === "host_failure") {
    return Object.hasOwn(snapshot, "message") && isNonEmptyString(snapshot.message)
      ? Object.freeze({ kind: "host_failure", message: snapshot.message })
      : undefined;
  }
  if (snapshot.kind !== "completed" || Object.hasOwn(snapshot, "message")) {
    return undefined;
  }
  const candidate = validateCandidateRunEnvelope(snapshot.candidate);
  if (!candidate) return undefined;
  return Object.hasOwn(snapshot, "evidence")
    ? Object.freeze({
        kind: "completed",
        evidence: snapshot.evidence,
        candidate,
      })
    : Object.freeze({ kind: "completed", candidate });
}

export function validateArtifactPersistenceAttestation(
  value: unknown,
  isolationClass: IsolationClass,
  expected: {
    readonly trialId: string;
    readonly artifactDigest: `sha256:${string}`;
  },
): ArtifactPersistenceAttestation | undefined {
  const snapshot = canonicalClosedRecord(value, [
    ["artifactDigest", "digest", "locator", "trialId"],
  ]);
  if (
    !snapshot ||
    typeof snapshot.locator !== "string" ||
    !isValidEvidenceReference(snapshot.locator, isolationClass) ||
    snapshot.trialId !== expected.trialId ||
    snapshot.artifactDigest !== expected.artifactDigest ||
    !isSha256Digest(snapshot.digest)
  ) {
    return undefined;
  }
  const binding = {
    locator: snapshot.locator,
    trialId: snapshot.trialId,
    artifactDigest: snapshot.artifactDigest,
  };
  return snapshot.digest === stableDigest(binding)
    ? Object.freeze({ ...binding, digest: snapshot.digest })
    : undefined;
}

export function artifactReceipt(
  artifact: Artifact,
  persistence: ArtifactPersistenceAttestation,
): ArtifactReceipt {
  return Object.freeze({
    locator: persistence.locator,
    digest: artifact.digest,
    byteSize: Buffer.byteLength(artifact.value, "utf8"),
    trialId: persistence.trialId,
    persistenceDigest: persistence.digest,
  });
}

export function validateHostEvidence(
  evidence: unknown,
  isolationClass: IsolationClass,
  expected: {
    readonly trialId: string;
    readonly artifactDigest: `sha256:${string}`;
  },
): HostEvidence | undefined {
  const snapshot = canonicalClosedRecord(evidence, [
    ["artifactDigest", "detail", "digest", "reference", "trialId"],
  ]);
  if (
    !snapshot ||
    typeof snapshot.reference !== "string" ||
    !isValidEvidenceReference(snapshot.reference, isolationClass) ||
    !isSha256Digest(snapshot.digest) ||
    typeof snapshot.detail !== "string" ||
    snapshot.detail.trim().length === 0 ||
    snapshot.trialId !== expected.trialId ||
    snapshot.artifactDigest !== expected.artifactDigest ||
    snapshot.digest !==
      stableDigest({
        reference: snapshot.reference,
        detail: snapshot.detail,
        trialId: snapshot.trialId,
        artifactDigest: snapshot.artifactDigest,
      })
  ) {
    return undefined;
  }
  return Object.freeze({
    reference: snapshot.reference,
    digest: snapshot.digest,
    detail: snapshot.detail,
    trialId: snapshot.trialId,
    artifactDigest: snapshot.artifactDigest,
  });
}

export function validateIsolationAttestation(
  value: unknown,
  evidence: HostEvidence,
  host: HostRef,
  expected: {
    readonly trialId: string;
    readonly artifactDigest: `sha256:${string}`;
  },
): IsolationAttestation | undefined {
  const snapshot = canonicalClosedRecord(value, [
    [
      "artifactDigest",
      "digest",
      "evidenceDigest",
      "hostConfigurationDigest",
      "hostId",
      "locator",
      "trialId",
    ],
  ]);
  if (
    !snapshot ||
    snapshot.locator !== evidence.reference ||
    snapshot.evidenceDigest !== evidence.digest ||
    snapshot.trialId !== expected.trialId ||
    snapshot.artifactDigest !== expected.artifactDigest ||
    snapshot.hostId !== host.id ||
    snapshot.hostConfigurationDigest !== host.configurationDigest ||
    !isSha256Digest(snapshot.digest)
  ) {
    return undefined;
  }
  const binding = {
    locator: snapshot.locator,
    evidenceDigest: snapshot.evidenceDigest,
    trialId: snapshot.trialId,
    artifactDigest: snapshot.artifactDigest,
    hostId: snapshot.hostId,
    hostConfigurationDigest: snapshot.hostConfigurationDigest,
  };
  return snapshot.digest === stableDigest(binding)
    ? Object.freeze({ ...binding, digest: snapshot.digest })
    : undefined;
}

export function validateMetrics(
  metrics: unknown,
): Readonly<Record<string, number>> | undefined {
  const snapshot = canonicalClosedRecord(metrics);
  if (!snapshot) return undefined;
  const entries = Object.entries(snapshot);
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
  return snapshot as Readonly<Record<string, number>>;
}

export function validateVerification(value: unknown):
  | { readonly kind: "valid"; readonly verification: Verification }
  | {
      readonly kind: "invalid";
      readonly error: "verification_metrics_invalid" | "verification_result_invalid";
    } {
  const snapshot = canonicalClosedRecord(value, [
    ["metrics", "status"],
    ["reason", "status"],
  ]);
  if (!snapshot || typeof snapshot.status !== "string") {
    return { kind: "invalid", error: "verification_result_invalid" };
  }
  if (snapshot.status === "valid") {
    if (!Object.hasOwn(snapshot, "metrics")) {
      return { kind: "invalid", error: "verification_result_invalid" };
    }
    const metrics = validateMetrics(snapshot.metrics);
    if (!metrics) {
      return { kind: "invalid", error: "verification_metrics_invalid" };
    }
    return {
      kind: "valid",
      verification: Object.freeze({ status: "valid", metrics }),
    };
  }
  if (
    snapshot.status === "skipped" ||
    snapshot.status === "unavailable" ||
    snapshot.status === "unmeasured"
  ) {
    if (!Object.hasOwn(snapshot, "reason") || !isNonEmptyString(snapshot.reason)) {
      return { kind: "invalid", error: "verification_result_invalid" };
    }
    return {
      kind: "valid",
      verification: Object.freeze({
        status: snapshot.status,
        reason: snapshot.reason,
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
