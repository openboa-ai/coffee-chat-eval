import { stableDigest } from "./identity.ts";
import type {
  Artifact,
  ArtifactReceipt,
  HostEvidence,
  ReceiptError,
  ReceiptErrorCode,
  ReceiptEvidence,
  TrialReceipt,
} from "./types.ts";

export function validateArtifact(artifact: Artifact | undefined): Artifact | undefined {
  if (
    !artifact ||
    artifact.id.length === 0 ||
    !artifact.value ||
    artifact.digest !== stableDigest(artifact.value)
  ) {
    return undefined;
  }
  return artifact;
}

export function artifactReceipt(artifact: Artifact): ArtifactReceipt {
  return Object.freeze({
    locator: `artifact:${artifact.digest}`,
    digest: artifact.digest,
    byteSize: Buffer.byteLength(artifact.value, "utf8"),
  });
}

export function receiptEvidence(evidence: HostEvidence): ReceiptEvidence {
  return Object.freeze({
    locator: `evidence:${stableDigest(evidence)}`,
    digest: stableDigest(evidence),
  });
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
