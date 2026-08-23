import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stableDigest } from "../src/identity.ts";
import { createRunPlan, parseRunSpec, parseSourceManifest } from "../src/eval-core.ts";
import { materializeSource } from "../src/source-cache.ts";
import { createFixtureCandidateTransport } from "../src/transports.ts";
import { executeImmutableRun } from "../src/run-engine.ts";

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

test("run engine dispatches an executor and writes private evidence plus reports", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-run-engine-"));
  try {
    const sourceInput = join(root, "source-input");
    mkdirSync(sourceInput);
    writeFileSync(join(sourceInput, "LICENSE"), "license");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "c".repeat(40),
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
    const cacheRoot = join(root, "cache");
    materializeSource({
      manifest,
      cacheRoot,
      sourceRoot: sourceInput,
      runtimeLockDigest: stableDigest("lock"),
      licenseEvidence: [{ path: "LICENSE", digest: digest("license"), license: "Apache-2.0" }],
    });
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "smoke",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      candidateType: "fixture",
      caseCensus: { prompts: 1 },
    });
    const plan = createRunPlan({
      manifest,
      spec,
      evidenceRoot: join(root, "evidence"),
      cacheRoot,
    });
    const candidate = createFixtureCandidateTransport((input) => ({ input }));
    const judge = {
      kind: "sealed-judge" as const,
      evaluate: async () => ({
        state: "measured" as const,
        verdictDigest: stableDigest("verdict"),
      }),
    };
    const result = await executeImmutableRun({
      plan,
      manifest,
      candidate,
      judge,
      executor: async ({ evidence }) => {
        const nativeEvidence = evidence({ mediaType: "application/json", value: { native: true } });
        return {
          executionStatus: "measured" as const,
          trialReceipts: [],
          metrics: {
            strictPrompt: { numerator: 1, denominator: 1, value: 1 },
          },
          nativeEvidence,
          cleanupStatus: "complete" as const,
        };
      },
    });
    assert.equal(result.trackReport.executionStatus, "measured");
    assert.equal(result.trackReport.provenance.nativeEvidenceDigest, result.trackReport.provenance.nativeEvidenceDigest);
    assert.match(result.nativeEvidence.path, /evidence/u);
    assert.equal(readFileSync(result.publicReceiptPath, "utf8").includes("native"), false);
    assert.equal(readFileSync(result.trackReportPath, "utf8").includes("strictPrompt"), true);
    assert.equal(readFileSync(result.trialReceiptsPath, "utf8").startsWith("["), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
