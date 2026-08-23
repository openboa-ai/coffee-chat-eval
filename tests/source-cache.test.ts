import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stableDigest } from "../src/identity.ts";
import { parseSourceManifest } from "../src/eval-core.ts";
import {
  materializeSource,
  parseMaterializedSourceReceipt,
  verifyMaterializedSource,
} from "../src/source-cache.ts";

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("materialized source verification is pinned, allowlisted, and byte exact", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-cache-"));
  try {
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "coffee-chat-taste",
      source: {
        repository: "https://example.invalid/bench",
        commit: "a".repeat(40),
        license: "MIT",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "src/**"],
      excludedPaths: ["sealed/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      providerTermsPolicy: "receipt-required",
      providerTermsDigest: stableDigest("terms"),
      publicArtifactPolicy: "receipt-redacted",
    });
    const trackRoot = join(root, manifest.trackId);
    const sourceRoot = join(trackRoot, "source");
    mkdirSync(join(sourceRoot, "src"), { recursive: true });
    writeFileSync(join(sourceRoot, "LICENSE"), "license");
    writeFileSync(join(sourceRoot, "src", "entry.ts"), "export {}\n");
    const sourceFiles = [
      { path: "LICENSE", digest: digest("license") },
      { path: "src/entry.ts", digest: digest("export {}\n") },
    ];
    writeFileSync(
      join(trackRoot, "source-receipt.json"),
      JSON.stringify({
        schema: "materialized-source-v1",
        trackId: manifest.trackId,
        sourceManifestDigest: stableDigest(manifest),
        sourceRevision: manifest.source.commit,
        licenseEvidence: [
          { path: "LICENSE", digest: digest("license"), license: "MIT" },
        ],
        runtimeLockDigest: stableDigest("runtime-lock"),
        sourceRoot: "source",
        sourceFiles,
      }),
    );
    const verified = verifyMaterializedSource({ manifest, cacheRoot: root });
    assert.equal(verified.sourceFileCount, 2);
    assert.equal(verified.dataFileCount, undefined);
    writeFileSync(join(sourceRoot, "sealed.txt"), "must fail");
    assert.throws(
      () => verifyMaterializedSource({ manifest, cacheRoot: root }),
      /not admitted|file census/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("materializer copies only admitted bytes and records immutable revisions and rights evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-materializer-"));
  const input = mkdtempSync(join(tmpdir(), "coffee-chat-eval-source-"));
  try {
    const source = join(input, "source");
    mkdirSync(join(source, "src"), { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(join(source, "src", "entry.ts"), "export {}\n");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "coffee-chat-taste",
      source: {
        repository: "https://example.invalid/bench",
        commit: "b".repeat(40),
        license: "MIT",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "src/**"],
      excludedPaths: ["sealed/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      providerTermsPolicy: "receipt-required",
      providerTermsDigest: stableDigest("terms"),
      publicArtifactPolicy: "receipt-redacted",
    });
    const result = materializeSource({
      manifest,
      cacheRoot: root,
      sourceRoot: source,
      runtimeLockDigest: stableDigest("runtime-lock"),
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "MIT" },
      ],
    });
    assert.equal(result.sourceRevision, manifest.source.commit);
    assert.equal(result.runtimeLockDigest, stableDigest("runtime-lock"));
    assert.equal(result.sourceFileCount, 2);
    const receipt = parseMaterializedSourceReceipt(
      JSON.parse(readFileSync(result.receiptPath, "utf8")) as unknown,
    );
    assert.equal(receipt.sourceRevision, manifest.source.commit);
    assert.equal(receipt.licenseEvidence[0]?.digest, digest("license"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});
