import assert from "node:assert/strict";
import test from "node:test";

import { stableDigest } from "../src/identity.ts";
import { createRunPlan, parseRunSpec, parseSourceManifest } from "../src/eval-core.ts";

const DIGESTS = {
  candidateDigest: stableDigest("candidate"),
  judgeDigest: stableDigest("judge"),
  attackDigest: stableDigest("attack"),
  defenseDigest: stableDigest("defense"),
  configurationDigest: stableDigest("configuration"),
};

function sourceManifest() {
  return {
    schema: "source-manifest-v1",
    trackId: "coffee-chat-taste",
    source: {
      repository: "https://github.com/openboa-ai/coffee-chat-bench",
      commit: "a".repeat(40),
      license: "CC-BY-4.0",
    },
    allowlist: ["projection-manifest.json", "tasks/**"],
    excludedPaths: ["sealed/**"],
    publicArtifactPolicy: "receipt-redacted",
  };
}

test("plans an immutable offline run from exact source and component digests", () => {
  const manifest = parseSourceManifest(sourceManifest());
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId: "coffee-chat-taste",
    profile: "pilot",
    sourceManifestDigest: stableDigest(manifest),
    ...DIGESTS,
  });
  const first = createRunPlan({
    manifest,
    spec,
    evidenceRoot: "/var/tmp/eval-evidence",
    cacheRoot: "/var/tmp/eval-cache",
  });
  const second = createRunPlan({
    spec,
    manifest,
    cacheRoot: "/var/tmp/eval-cache",
    evidenceRoot: "/var/tmp/eval-evidence",
  });

  assert.equal(first.id, second.id);
  assert.equal(first.claimStatus, "pilot");
  assert.equal(first.executionStatus, "unmeasured");
  assert.equal(first.sourceManifestDigest, stableDigest(manifest));
  assert.equal(Object.isFrozen(first), true);
});

test("smoke is a calibration profile accepted by the immutable run-spec parser", () => {
  const manifest = parseSourceManifest(sourceManifest());
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId: "coffee-chat-taste",
    profile: "smoke",
    sourceManifestDigest: stableDigest(manifest),
    ...DIGESTS,
  });
  const plan = createRunPlan({
    manifest,
    spec,
    evidenceRoot: "/var/tmp/eval-evidence",
    cacheRoot: "/var/tmp/eval-cache",
  });
  assert.equal(plan.profile, "smoke");
  assert.equal(plan.claimStatus, "calibration");
});

test("fails closed when an evidence or cache root is not absolute", () => {
  const manifest = parseSourceManifest(sourceManifest());
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId: "coffee-chat-taste",
    profile: "fixture",
    sourceManifestDigest: stableDigest(manifest),
    ...DIGESTS,
  });

  assert.throws(
    () =>
      createRunPlan({
        manifest,
        spec,
        evidenceRoot: "relative/evidence",
        cacheRoot: "/var/tmp/eval-cache",
      }),
    /evidenceRoot must be an absolute path/u,
  );
  assert.throws(
    () =>
      createRunPlan({
        manifest,
        spec,
        evidenceRoot: "/var/tmp/eval-evidence",
        cacheRoot: "relative/cache",
      }),
    /cacheRoot must be an absolute path/u,
  );
});

test("rejects a source manifest that admits an excluded or unpinned source", () => {
  assert.throws(
    () =>
      parseSourceManifest({
        ...sourceManifest(),
        allowlist: ["sealed/private.json"],
      }),
    /allowlist must not overlap excludedPaths/u,
  );
  assert.throws(
    () =>
      parseSourceManifest({
        ...sourceManifest(),
        source: { ...sourceManifest().source, commit: "main" },
      }),
    /source commit must be a full SHA/u,
  );
});
