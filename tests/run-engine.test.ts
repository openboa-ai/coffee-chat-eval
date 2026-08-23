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
import { executeImmutableRun, validateRuntimeForRun } from "../src/run-engine.ts";
import { parseRuntimeBundleConfig } from "../src/runtime-config.ts";
import { requireRuntimePython } from "../src/python-runtime.ts";

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
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
      ],
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
        const nativeEvidence = evidence({
          mediaType: "application/json",
          value: { native: true },
        });
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
    assert.equal(
      result.trackReport.provenance.nativeEvidenceDigest,
      result.trackReport.provenance.nativeEvidenceDigest,
    );
    assert.match(result.nativeEvidence.path, /evidence/u);
    assert.equal(
      readFileSync(result.publicReceiptPath, "utf8").includes("native"),
      false,
    );
    assert.equal(
      readFileSync(result.trackReportPath, "utf8").includes("strictPrompt"),
      true,
    );
    assert.equal(readFileSync(result.trialReceiptsPath, "utf8").startsWith("["), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live runs fail closed when a scoped runtime is missing or expired", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-runtime-gate-"));
  try {
    const sourceInput = join(root, "source-input");
    mkdirSync(sourceInput);
    writeFileSync(join(sourceInput, "LICENSE"), "license");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "d".repeat(40),
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
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
      ],
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
      candidateType: "agent_stack",
      caseCensus: { prompts: 9 },
      isolationEvidenceDigest: stableDigest("isolation"),
    });
    const plan = createRunPlan({
      manifest,
      spec,
      evidenceRoot: join(root, "evidence"),
      cacheRoot,
    });
    const missing = validateRuntimeForRun({ plan });
    assert.equal(missing?.failureOwner, "host");
    assert.match(missing?.reason ?? "", /missing/u);
    const runtime = parseRuntimeBundleConfig({
      schema: "runtime-bundle-v1",
      candidate: {
        schema: "runtime-capability-v1",
        scope: "candidate",
        endpoint: "http://127.0.0.1:4311",
        capabilityToken: "candidate-capability",
        model: "gpt-5.6-luna",
        expiresAt: "2020-01-01T00:00:00.000Z",
        maxRequests: 9,
      },
    });
    const expired = validateRuntimeForRun({ plan, runtime });
    assert.equal(expired?.failureOwner, "host");
    assert.match(expired?.reason ?? "", /expired/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing materialized Python runtime is host unavailability, not adapter success", () => {
  assert.throws(
    () => requireRuntimePython("/tmp/coffee-chat-eval-runtime-does-not-exist/source"),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Python runtime is missing") &&
      (error as Error & { failureOwner?: string }).failureOwner === "host",
  );
});
