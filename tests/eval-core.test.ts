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
    candidateType: "agent_stack",
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
    candidateType: "agent_stack",
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

test("rights risk acceptance identity is admitted only for IFEval smoke", () => {
  const rightsRiskAcceptanceDigest = stableDigest("ifeval-risk-acceptance");
  const base = {
    schema: "run-spec-v1",
    trackId: "ifeval",
    profile: "smoke",
    candidateType: "coffee_chat_product",
    sourceManifestDigest: stableDigest(sourceManifest()),
    ...DIGESTS,
  } as const;
  const spec = parseRunSpec({ ...base, rightsRiskAcceptanceDigest });
  assert.equal(spec.rightsRiskAcceptanceDigest, rightsRiskAcceptanceDigest);

  assert.throws(
    () =>
      parseRunSpec({
        ...base,
        candidateType: "agent_stack",
        rightsRiskAcceptanceDigest,
      }),
    /Product candidate/u,
  );

  assert.throws(
    () =>
      parseRunSpec({
        ...base,
        trackId: "coffee-chat-taste",
        rightsRiskAcceptanceDigest,
      }),
    /profile smoke|IFEval smoke/u,
  );
  assert.throws(
    () =>
      parseRunSpec({
        ...base,
        profile: "pilot",
        rightsRiskAcceptanceDigest,
      }),
    /profile smoke|IFEval smoke/u,
  );
});

test("run specs accept the product candidate type without embedding private host paths", () => {
  const manifest = parseSourceManifest(sourceManifest());
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId: "coffee-chat-taste",
    profile: "smoke",
    sourceManifestDigest: stableDigest(manifest),
    ...DIGESTS,
    candidateType: "coffee_chat_product",
  });

  assert.equal(spec.candidateType, "coffee_chat_product");
  assert.equal("productHost" in spec, false);
  assert.equal("packageRoot" in spec, false);
  assert.throws(
    () =>
      parseRunSpec({
        ...spec,
        productHost: {
          schema: "product-host-runtime-v1",
          host: "eval-skills-reference-host-v1",
          packageRoot: "/private/tmp/product",
        },
      }),
    /unexpected/u,
  );
});

test("run profile and candidate type form a closed compatibility contract", () => {
  const base = {
    schema: "run-spec-v1",
    trackId: "coffee-chat-taste",
    sourceManifestDigest: stableDigest(sourceManifest()),
    ...DIGESTS,
  } as const;

  for (const compatible of [
    { profile: "fixture", candidateType: "fixture" },
    { profile: "smoke", candidateType: "agent_stack" },
    { profile: "smoke", candidateType: "coffee_chat_product" },
    { profile: "pilot", candidateType: "reference_model" },
    { profile: "score", candidateType: "agent_stack" },
  ] as const) {
    assert.doesNotThrow(() => parseRunSpec({ ...base, ...compatible }));
  }

  for (const incompatible of [
    { profile: "fixture" },
    { profile: "smoke" },
    { profile: "fixture", candidateType: "agent_stack" },
    { profile: "smoke", candidateType: "fixture" },
    { profile: "pilot", candidateType: "fixture" },
    { profile: "score", candidateType: "fixture" },
    { profile: "fixture", candidateType: "coffee_chat_product" },
    { profile: "pilot", candidateType: "coffee_chat_product" },
    { profile: "score", candidateType: "coffee_chat_product" },
  ] as const) {
    assert.throws(
      () => parseRunSpec({ ...base, ...incompatible }),
      /candidateType|candidate type|coffee_chat_product/u,
    );
  }
});

test("fails closed when an evidence or cache root is not absolute", () => {
  const manifest = parseSourceManifest(sourceManifest());
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId: "coffee-chat-taste",
    profile: "fixture",
    candidateType: "fixture",
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
