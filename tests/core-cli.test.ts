import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stableDigest } from "../src/identity.ts";

function invoke(...args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--experimental-strip-types", "src/cli.ts", ...args],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
}

test("core source verification, planning, run, and report commands are offline and deterministic", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-core-"));
  try {
    const manifest = {
      schema: "source-manifest-v1",
      trackId: "coffee-chat-taste",
      source: {
        repository: "https://github.com/openboa-ai/coffee-chat-bench",
        commit: "a".repeat(40),
        license: "CC-BY-4.0",
      },
      allowlist: ["projection-manifest.json"],
      excludedPaths: ["sealed/**"],
      publicArtifactPolicy: "receipt-redacted",
    };
    const spec = {
      schema: "run-spec-v1",
      trackId: "coffee-chat-taste",
      profile: "fixture",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
    };
    const manifestPath = join(root, "source-manifest.json");
    const specPath = join(root, "run-spec.json");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(specPath, JSON.stringify(spec));
    const common = [
      "--source-manifest",
      manifestPath,
      "--run-spec",
      specPath,
      "--evidence-root",
      join(root, "evidence"),
      "--cache-root",
      join(root, "cache"),
    ];

    const verified = invoke("source-verify", "--source-manifest", manifestPath);
    const firstPlan = invoke("plan", ...common);
    const secondPlan = invoke("plan", ...common);
    const run = invoke("run", ...common);
    const receiptPath = join(root, "receipt.json");
    writeFileSync(receiptPath, run);
    const report = invoke("report", "--receipt", receiptPath);

    assert.match(verified, /coffee-chat-taste/u);
    assert.equal(firstPlan, secondPlan);
    assert.match(run, /"executionStatus": "unmeasured"/u);
    assert.match(report, /Execution: unmeasured/u);
    assert.doesNotMatch(report, /score\s*[:=]\s*\d+/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
