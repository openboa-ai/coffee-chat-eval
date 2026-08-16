import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BENCHMARK_CONDITIONS,
  parseProjectionManifest,
  selectBaselineTasks,
} from "../src/bench.ts";
import {
  createHarborOraclePlan,
  NATIVE_CODEX_AVAILABILITY,
  parseHarborTrialResult,
} from "../src/harbor.ts";
import { stableDigest } from "../src/identity.ts";
import { runOracleControl } from "../src/runner.ts";

function projection() {
  const tasks = Array.from({ length: 16 }, (_, caseIndex) =>
    BENCHMARK_CONDITIONS.map((condition, conditionIndex) => ({
      caseId: `case-${caseIndex}`,
      condition,
      trialId: `trial-${String(caseIndex * 5 + conditionIndex).padStart(24, "0")}`,
      taskDigest: `sha256:${String(caseIndex * 5 + conditionIndex).padStart(64, "0")}`,
      directory: `task-${String(caseIndex * 5 + conditionIndex).padStart(24, "0")}`,
      taskBytesDigest: `sha256:${String(100 + caseIndex * 5 + conditionIndex).padStart(64, "0")}`,
    })),
  ).flat();
  const semantic = {
    release: "2026.8.12",
    harborTaskSchema: "1.4" as const,
    bankDigest: `sha256:${"a".repeat(64)}`,
    tasks,
  };
  return { ...semantic, projectionDigest: stableDigest(semantic) };
}

test("selects one task-only and one diagnostic task from a valid Bench projection", () => {
  const manifest = parseProjectionManifest(projection());
  const selected = selectBaselineTasks({
    manifest,
    projectionRoot: "/workspace/projected",
    caseId: "case-0",
    diagnosticTarget: "b",
  });

  assert.deepEqual(
    selected.map(({ condition }) => condition),
    ["task_only", "diagnostic_target_b"],
  );
  assert.equal(selected[1].path, "/workspace/projected/task-000000000000000000000004");
});

test("rejects tampered or incomplete projection manifests", () => {
  const valid = projection();
  assert.throws(
    () => parseProjectionManifest({ ...valid, tasks: valid.tasks.slice(1) }),
    /exactly 80 tasks/u,
  );
  assert.throws(
    () => parseProjectionManifest({ ...valid, release: "2026.8.13" }),
    /projection digest/u,
  );
});

test("creates a single-task credential-free Harbor Oracle command", () => {
  const task = selectBaselineTasks({
    manifest: parseProjectionManifest(projection()),
    projectionRoot: "/workspace/projected",
    caseId: "case-0",
    diagnosticTarget: "a",
  })[0];
  const plan = createHarborOraclePlan({
    task,
    harborCommand: "/opt/harbor/bin/harbor",
    jobsRoot: "/workspace/artifacts/run",
  });

  assert.deepEqual(plan.args.slice(0, 7), [
    "run",
    "-p",
    task.path,
    "-a",
    "oracle",
    "-o",
    "/workspace/artifacts/run",
  ]);
  assert.doesNotMatch(JSON.stringify(plan), /OPENAI_API_KEY|api.?key/iu);
});

test("normalizes successful Harbor execution without treating reward as measurement", () => {
  const result = parseHarborTrialResult({
    id: "native-id",
    trial_name: "task__oracle__1",
    task_name: "openboa/task",
    config: { environment: { type: "docker", delete: true } },
    agent_info: { name: "oracle", version: "1.0.0" },
    verifier_result: { rewards: { reward: 1 } },
    verifier_environment_mode: "shared",
    exception_info: null,
  });

  assert.equal(result.resultState, "executed");
  if (result.resultState === "executed") assert.equal(result.nativeReward, 1);
});

test("preserves verifier failure and blocks stock Harbor Codex credentials", () => {
  assert.deepEqual(
    parseHarborTrialResult({
      exception_info: { exception_type: "RewardFileNotFoundError" },
      verifier: { started_at: "now" },
    }),
    {
      resultState: "invalid",
      failureClass: "verifier",
      reason: "Harbor trial recorded an exception",
    },
  );
  assert.deepEqual(NATIVE_CODEX_AVAILABILITY, {
    status: "unavailable",
    reason: "credential_isolation_unavailable",
    detail:
      "Harbor 0.21 native Codex places provider credentials in candidate-readable environment and filesystem state",
  });
});

test("records a Harbor process failure as host evidence", () => {
  const artifacts = new URL("../artifacts", import.meta.url);
  mkdirSync(artifacts, { recursive: true });
  const parent = mkdtempSync(join(fileURLToPath(artifacts), "runner-failure-"));
  try {
    const manifest = parseProjectionManifest(projection());
    const task = selectBaselineTasks({
      manifest,
      projectionRoot: "/workspace/projected",
      caseId: "case-0",
      diagnosticTarget: "a",
    })[0];
    const receipt = runOracleControl({
      task,
      manifest,
      benchmarkCommit: "a".repeat(40),
      harborCommand: "/usr/bin/false",
      jobsRoot: join(parent, "job"),
    });
    assert.deepEqual(receipt.execution, {
      resultState: "invalid",
      failureClass: "host",
      reason: "Harbor control process failed",
    });
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
