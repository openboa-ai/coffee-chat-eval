import assert from "node:assert/strict";
import test from "node:test";

import { stableDigest } from "../src/identity.ts";
import {
  SOURCE_MANIFESTS,
  getSourceManifest,
  verifySourceManifestPins,
} from "../src/source-manifests.ts";

test("source manifests pin all four tracks, rights layers, exclusions, and census", () => {
  assert.deepEqual(Object.keys(SOURCE_MANIFESTS), [
    "coffee-chat-taste",
    "beam-record-core",
    "ifeval",
    "agentdojo-security",
  ]);
  for (const manifest of Object.values(SOURCE_MANIFESTS)) {
    assert.match(manifest.source.commit, /^[0-9a-f]{40}$/u);
    assert.match(manifest.source.licenseDigest ?? "", /^sha256:[0-9a-f]{64}$/u);
    assert.equal(manifest.publicArtifactPolicy, "receipt-redacted");
    assert.deepEqual(manifest.retention, {
      source: "cache-only",
      evidence: "private-content-addressed",
      public: "aggregate-provenance-only",
    });
    assert.equal(manifest.providerTermsPolicy, "receipt-required");
    assert.match(manifest.providerTermsDigest ?? "", /^sha256:[0-9a-f]{64}$/u);
    assert.equal(
      manifest.allowlist.some((path) => manifest.excludedPaths.includes(path)),
      false,
    );
    assert.ok(manifest.notices && manifest.notices.length > 0);
  }
  assert.equal(getSourceManifest("ifeval").caseCensus?.prompts, 541);
  assert.equal(getSourceManifest("agentdojo-security").caseCensus?.episodes, 1081);
  const beam = getSourceManifest("beam-record-core");
  assert.ok(
    beam.allowlist.includes(
      "chats/100K/**/probing_questions/probing_questions.json",
    ),
    "BEAM native evaluator requires the pinned probing-question rubric",
  );
  assert.deepEqual(beam.data?.allowlist, [
    "README.md",
    "data/100K-00000-of-00001.parquet",
  ]);
});

test("source verification is fail-closed when a manifest or digest drifts", () => {
  const manifest = getSourceManifest("coffee-chat-taste");
  assert.equal(verifySourceManifestPins(manifest), stableDigest(manifest));
  assert.throws(
    () =>
      verifySourceManifestPins({
        ...manifest,
        source: { ...manifest.source, commit: "a".repeat(40) },
      }),
    /source manifest digest|source commit|pin/u,
  );
});
