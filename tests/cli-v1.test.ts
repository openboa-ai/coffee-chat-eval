import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function invoke(cwd: string, ...args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--experimental-strip-types", "src/cli.ts", ...args],
    { cwd, encoding: "utf8" },
  );
}

test("v1 CLI supports source verify/plan/run/report with track and profile flags", () => {
  const cwd = new URL("..", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-v1-cli-"));
  const workdir = cwd.pathname;
  try {
    const evidenceRoot = join(root, "evidence");
    const cacheRoot = join(root, "cache");
    const verified = JSON.parse(
      invoke(workdir, "source", "verify", "--track", "ifeval"),
    );
    assert.equal(verified.trackId, "ifeval");
    assert.equal(verified.caseCensus.prompts, 541);

    const configPath = join(root, "candidate.json");
    writeFileSync(configPath, JSON.stringify({ candidateType: "fixture", seed: 7 }));
    const plan = JSON.parse(
      invoke(
        workdir,
        "plan",
        "--track",
        "ifeval",
        "--profile",
        "pilot",
        "--candidate-config",
        configPath,
        "--evidence-root",
        evidenceRoot,
        "--cache-root",
        cacheRoot,
      ),
    );
    assert.equal(plan.trackId, "ifeval");
    assert.equal(plan.claimStatus, "pilot");
    assert.equal(plan.runSpec.trackId, "ifeval");
    assert.equal(plan.runSpec.samplingUnit, "prompt");
    assert.equal(plan.runSpec.caseCensus.prompts, 9);

    const planPath = join(root, "run-plan.json");
    writeFileSync(planPath, JSON.stringify(plan));
    const receipt = JSON.parse(
      invoke(workdir, "run", "--plan", planPath, "--evidence-root", evidenceRoot),
    );
    assert.equal(receipt.executionStatus, "unavailable");
    const receiptPath = join(root, "receipt.json");
    writeFileSync(receiptPath, JSON.stringify(receipt));
    const report = invoke(
      workdir,
      "report",
      "--run",
      receiptPath,
      "--visibility",
      "public",
    );
    assert.match(report, /Execution: unavailable/u);
    assert.doesNotMatch(report, /score\s*[:=]\s*\d+/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-fixture provider runs require a terms receipt and fail closed", () => {
  const cwd = new URL("..", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-v1-rights-"));
  try {
    const evidenceRoot = join(root, "evidence");
    const cacheRoot = join(root, "cache");
    const configPath = join(root, "candidate.json");
    writeFileSync(configPath, JSON.stringify({ candidateType: "agent_stack" }));
    const plan = JSON.parse(
      invoke(
        cwd.pathname,
        "plan",
        "--track",
        "agentdojo-security",
        "--profile",
        "pilot",
        "--candidate-config",
        configPath,
        "--evidence-root",
        evidenceRoot,
        "--cache-root",
        cacheRoot,
      ),
    );
    const planPath = join(root, "run-plan.json");
    writeFileSync(planPath, JSON.stringify(plan));
    const receipt = JSON.parse(
      invoke(cwd.pathname, "run", "--plan", planPath, "--evidence-root", evidenceRoot),
    );
    assert.equal(receipt.executionStatus, "rights_hold");
    assert.equal(receipt.failureOwner, "rights");

    const termsPath = join(root, "provider-terms.json");
    writeFileSync(termsPath, JSON.stringify({ terms: "current" }));
    const isolatedPlan = JSON.parse(
      invoke(
        cwd.pathname,
        "plan",
        "--track",
        "agentdojo-security",
        "--profile",
        "pilot",
        "--candidate-config",
        configPath,
        "--provider-terms-receipt",
        termsPath,
        "--evidence-root",
        evidenceRoot,
        "--cache-root",
        cacheRoot,
      ),
    );
    const isolatedPlanPath = join(root, "terms-plan.json");
    writeFileSync(isolatedPlanPath, JSON.stringify(isolatedPlan));
    const unavailable = JSON.parse(
      invoke(
        cwd.pathname,
        "run",
        "--plan",
        isolatedPlanPath,
        "--evidence-root",
        evidenceRoot,
      ),
    );
    assert.equal(unavailable.executionStatus, "unavailable");
    assert.equal(unavailable.failureOwner, "host");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
