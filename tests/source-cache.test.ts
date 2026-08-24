import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
import { materializePinnedSource } from "../src/source-materializer.ts";

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
      licenseEvidence: [{ path: "LICENSE", digest: digest("license"), license: "MIT" }],
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

test("materializer supports recursive globs with a pinned path segment", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-glob-cache-"));
  const input = mkdtempSync(join(tmpdir(), "coffee-chat-eval-glob-source-"));
  try {
    const source = join(input, "source");
    const nested = join(source, "chats", "100K", "1", "probing_questions");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(join(nested, "probing_questions.json"), "{}\n");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "beam-record-core",
      source: {
        repository: "https://example.invalid/beam",
        commit: "c".repeat(40),
        license: "MIT",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "chats/100K/**/probing_questions/probing_questions.json"],
      excludedPaths: ["secrets/**"],
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
      licenseEvidence: [{ path: "LICENSE", digest: digest("license"), license: "MIT" }],
    });
    assert.equal(result.sourceFileCount, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});

test("source materializer projects a full checkout onto the allowlist", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-allowlist-cache-"));
  const input = mkdtempSync(join(tmpdir(), "coffee-chat-eval-allowlist-source-"));
  try {
    const source = join(input, "source");
    mkdirSync(join(source, "src"), { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(join(source, "src", "entry.ts"), "export {}\n");
    writeFileSync(join(source, "package.json"), "{}\n");
    writeFileSync(join(source, "historical-response.jsonl"), "must not copy\n");
    symlinkSync("src/entry.ts", join(source, "unadmitted-link"));
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "e".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "src/**"],
      excludedPaths: ["historical-response.jsonl", "secrets/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    const result = materializeSource({
      manifest,
      cacheRoot: root,
      sourceRoot: source,
      runtimeLockDigest: stableDigest("runtime-lock"),
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
      ],
    });
    assert.equal(result.sourceFileCount, 2);
    assert.equal(
      readFileSync(join(root, "ifeval", "source", "LICENSE"), "utf8"),
      "license",
    );
    assert.throws(
      () => readFileSync(join(root, "ifeval", "source", "historical-response.jsonl")),
      /ENOENT/u,
    );
    assert.throws(
      () => readFileSync(join(root, "ifeval", "source", "unadmitted-link")),
      /ENOENT/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});

test("BEAM data file digests are verified against the manifest, not only the receipt", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-data-cache-"));
  const input = mkdtempSync(join(tmpdir(), "coffee-chat-eval-data-source-"));
  try {
    const source = join(input, "source");
    const data = join(input, "data");
    mkdirSync(source, { recursive: true });
    mkdirSync(join(data, "data"), { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(join(data, "README.md"), "data license");
    writeFileSync(join(data, "data", "100K-00000-of-00001.parquet"), "parquet");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "beam-record-core",
      source: {
        repository: "https://example.invalid/beam",
        commit: "d".repeat(40),
        license: "MIT",
        licenseDigest: digest("license"),
      },
      data: {
        repository: "https://example.invalid/data",
        revision: "e".repeat(40),
        license: "CC BY-SA 4.0",
        licenseDigest: digest("data license"),
        allowlist: ["README.md", "data/100K-00000-of-00001.parquet"],
        licenseEvidencePath: "README.md",
        fileDigests: { "data/100K-00000-of-00001.parquet": digest("different") },
      },
      allowlist: ["LICENSE"],
      excludedPaths: ["secrets/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      providerTermsPolicy: "receipt-required",
      providerTermsDigest: stableDigest("terms"),
      publicArtifactPolicy: "receipt-redacted",
    });
    assert.throws(
      () =>
        materializeSource({
          manifest,
          cacheRoot: root,
          sourceRoot: source,
          dataRoot: data,
          runtimeLockDigest: stableDigest("runtime-lock"),
          licenseEvidence: [
            { path: "LICENSE", digest: digest("license"), license: "MIT" },
            {
              path: "data/README.md",
              digest: digest("data license"),
              license: "CC BY-SA 4.0",
            },
          ],
        }),
      /data file digest drifted/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});

test("source materializer binds an upstream uv.lock when the pinned checkout provides one", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-lock-cache-"));
  const input = mkdtempSync(join(tmpdir(), "coffee-chat-eval-lock-source-"));
  try {
    const source = join(input, "source");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(join(source, "uv.lock"), "lock bytes\n");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "agentdojo-security",
      source: {
        repository: "https://example.invalid/agentdojo",
        commit: "f".repeat(40),
        license: "MIT",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "uv.lock"],
      excludedPaths: ["secrets/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      providerTermsPolicy: "receipt-required",
      providerTermsDigest: stableDigest("terms"),
      publicArtifactPolicy: "receipt-redacted",
    });
    const result = materializePinnedSource({
      manifest,
      cacheRoot: root,
      sourceRoot: source,
    });
    assert.equal(result.runtimeLockDigest, digest("lock bytes\n"));
    assert.equal(result.runtimeLockOrigin, "source");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});

test("source materializer uses an Eval-owned lock identity when uv.lock is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-owned-lock-cache-"));
  const input = mkdtempSync(join(tmpdir(), "coffee-chat-eval-owned-lock-source-"));
  try {
    const source = join(input, "source");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "a".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE"],
      excludedPaths: ["responses/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    const result = materializePinnedSource({
      manifest,
      cacheRoot: root,
      sourceRoot: source,
    });
    assert.equal(
      result.runtimeLockDigest,
      stableDigest({
        schema: "eval-owned-runtime-lock-v1",
        trackId: "ifeval",
        sourceRevision: manifest.source.commit,
      }),
    );
    assert.equal(result.runtimeLockOrigin, "eval-owned");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});

test("materialized source verification rejects Eval-owned lock-byte drift", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-owned-lock-drift-cache-"));
  const input = mkdtempSync(
    join(tmpdir(), "coffee-chat-eval-owned-lock-drift-source-"),
  );
  try {
    const source = join(input, "source");
    const runtimeLockPath = join(input, "ifeval-runtime-lock.txt");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(runtimeLockPath, "pinned dependency bytes\n");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "1".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE"],
      excludedPaths: ["responses/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    materializePinnedSource({
      manifest,
      cacheRoot: root,
      sourceRoot: source,
      runtimeLockPath,
    });
    writeFileSync(runtimeLockPath, "drifted dependency bytes\n");
    assert.throws(
      () =>
        verifyMaterializedSource({
          manifest,
          cacheRoot: root,
          expectedRuntimeLockPath: runtimeLockPath,
        }),
      /runtime lock digest drifted/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});

test("source materialization verifies a supplied Eval-owned lock before succeeding", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-owned-lock-final-cache-"));
  const input = mkdtempSync(
    join(tmpdir(), "coffee-chat-eval-owned-lock-final-source-"),
  );
  try {
    const source = join(input, "source");
    const runtimeLockPath = join(input, "beam-runtime-lock.txt");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(runtimeLockPath, "current dependency bytes\n");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "beam-record-core",
      source: {
        repository: "https://example.invalid/beam",
        commit: "2".repeat(40),
        license: "MIT",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE"],
      excludedPaths: ["secrets/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    assert.throws(
      () =>
        materializePinnedSource({
          manifest,
          cacheRoot: root,
          sourceRoot: source,
          runtimeLockPath,
          runtimeLockDigest: stableDigest("stale runtime lock receipt"),
        }),
      /runtime lock digest drifted/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});

test("source materializer binds a pinned requirements.txt when uv.lock is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-requirements-cache-"));
  const input = mkdtempSync(join(tmpdir(), "coffee-chat-eval-requirements-source-"));
  try {
    const source = join(input, "source");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(join(source, "requirements.txt"), "absl-py==2.3.1\n");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "b".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "requirements.txt"],
      excludedPaths: ["responses/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    const result = materializePinnedSource({
      manifest,
      cacheRoot: root,
      sourceRoot: source,
    });
    assert.equal(result.runtimeLockDigest, digest("absl-py==2.3.1\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});

test("materialized source verification rejects lock-byte drift", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-lock-drift-cache-"));
  const input = mkdtempSync(join(tmpdir(), "coffee-chat-eval-lock-drift-source-"));
  try {
    const source = join(input, "source");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "LICENSE"), "license");
    writeFileSync(join(source, "uv.lock"), "pinned lock\n");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "agentdojo-security",
      source: {
        repository: "https://example.invalid/agentdojo",
        commit: "c".repeat(40),
        license: "MIT",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "uv.lock"],
      excludedPaths: ["secrets/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    materializePinnedSource({ manifest, cacheRoot: root, sourceRoot: source });
    writeFileSync(join(root, "agentdojo-security", "source", "uv.lock"), "drifted\n");
    assert.throws(
      () => verifyMaterializedSource({ manifest, cacheRoot: root }),
      /runtime lock digest drifted/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(input, { recursive: true, force: true });
  }
});
