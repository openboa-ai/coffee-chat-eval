import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import type {
  CandidateTransport,
  JudgeTransport,
  PrivateArtifactRef,
  RunPlan,
  SourceManifest,
  TrackExecutionResult,
} from "../../src/eval-core.ts";
import { putEvidence } from "../../src/evidence.ts";
import { stableDigest } from "../../src/identity.ts";
import { evalOwnedRuntimeLockForTrack } from "../../src/python-runtime.ts";
import type { RuntimeBundleConfig } from "../../src/runtime-config.ts";
import { verifyMaterializedSource } from "../../src/source-cache.ts";
import type { TrackExecutor } from "../../src/track-executor.ts";

export interface NonReportableReplayResult {
  readonly boundary: "test-only-non-reportable-replay-v1";
  readonly execution: TrackExecutionResult;
}

/**
 * Test-only raw adapter harness. It deliberately cannot create TrackReport,
 * public receipts, or official trial-receipt files. Production callers must
 * use executeImmutableRun, which owns canonical executor selection.
 */
export async function executeNonReportableReplay(input: {
  readonly plan: RunPlan;
  readonly manifest: SourceManifest;
  readonly candidate: CandidateTransport;
  readonly judge: JudgeTransport | undefined;
  readonly runtime?: RuntimeBundleConfig | undefined;
  readonly executor: TrackExecutor;
}): Promise<NonReportableReplayResult> {
  if (input.plan.profile !== "fixture" || input.candidate.kind !== "fixture") {
    throw new TypeError("non-reportable replay requires fixture identity");
  }
  if (
    input.plan.trackId !== input.manifest.trackId ||
    input.plan.runSpec?.trackId !== input.manifest.trackId ||
    input.plan.sourceManifestDigest !== stableDigest(input.manifest)
  ) {
    throw new TypeError("non-reportable replay identity is inconsistent");
  }
  const expectedRuntimeLockPath = evalOwnedRuntimeLockForTrack(input.manifest.trackId);
  const source = verifyMaterializedSource({
    manifest: input.manifest,
    cacheRoot: input.plan.cacheRoot,
    ...(expectedRuntimeLockPath === undefined ? {} : { expectedRuntimeLockPath }),
  });
  const execution = await input.executor({
    plan: input.plan,
    manifest: input.manifest,
    source,
    candidate: input.candidate,
    judge: input.judge,
    runtime: input.runtime,
    evidence: ({ value, mediaType }): PrivateArtifactRef => {
      const serialized =
        typeof value === "string" ? value : `${JSON.stringify(value)}\n`;
      const record = putEvidence(input.plan.evidenceRoot, serialized, "private");
      return Object.freeze({
        path: record.path,
        digest: record.digest,
        mediaType,
        bytes: Buffer.byteLength(serialized, "utf8"),
      });
    },
  });
  const artifactPath = resolve(execution.nativeEvidence.path);
  const evidenceRoot = resolve(input.plan.evidenceRoot);
  const artifactRelative = relative(evidenceRoot, artifactPath);
  if (
    !execution.nativeEvidence.path.startsWith("/") ||
    artifactRelative.startsWith("..") ||
    artifactRelative.includes("..")
  ) {
    throw new TypeError("non-reportable replay evidence escaped EVIDENCE_ROOT");
  }
  if (readFileSync(artifactPath).byteLength !== execution.nativeEvidence.bytes) {
    throw new TypeError("non-reportable replay evidence byte count drifted");
  }
  return Object.freeze({
    boundary: "test-only-non-reportable-replay-v1" as const,
    execution,
  });
}
