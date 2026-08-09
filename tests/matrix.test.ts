import assert from "node:assert/strict";
import test from "node:test";

import { createTrialIdentity, stableDigest } from "../src/identity.ts";
import { expandMatrix } from "../src/matrix.ts";
import type { MatrixDefinition } from "../src/types.ts";

function matrixDefinition(): MatrixDefinition {
  return {
    evaluator: {
      repository: "https://github.com/openboa-ai/coffee-chat-eval",
      commit: "741e54ea6c49b9ab53a6c29ee79ccc033dc548b9",
      calver: "2026.8.9",
      configurationDigest: stableDigest("fixture-evaluator-configuration"),
    },
    candidate: {
      repository: "https://github.com/openboa-ai/coffee-chat",
      commit: "0123456789abcdef0123456789abcdef01234567",
      calver: "2026.8.9",
      adapter: "fake-candidate",
    },
    tasks: [
      { id: "task-a", digest: stableDigest("task-a") },
      { id: "task-b", digest: stableDigest("task-b") },
    ],
    harnesses: [{ id: "harness", digest: stableDigest("harness") }],
    models: [
      { id: "model-a", digest: stableDigest("model-a") },
      { id: "model-b", digest: stableDigest("model-b") },
    ],
    hosts: [
      {
        id: "fixture-host",
        isolationClass: "fixture",
        configurationDigest: stableDigest("fixture-host-configuration"),
        isolationReference: "fixture://fake-host",
      },
    ],
    repetitions: 2,
  };
}

test("matrix expansion is a stable Cartesian product without duplicate trial ids", () => {
  const trials = expandMatrix(matrixDefinition());

  assert.equal(trials.length, 8);
  assert.deepEqual(
    trials
      .slice(0, 3)
      .map((trial) => [trial.task.id, trial.model.id, trial.repetition]),
    [
      ["task-a", "model-a", 0],
      ["task-a", "model-a", 1],
      ["task-a", "model-b", 0],
    ],
  );
  assert.equal(new Set(trials.map((trial) => trial.id)).size, trials.length);
  assert.equal(
    trials[0]?.evaluator.configurationDigest,
    stableDigest("fixture-evaluator-configuration"),
  );
});

test("matrix rejects every empty Cartesian axis instead of producing zero trials", () => {
  for (const axis of ["tasks", "harnesses", "models", "hosts"] as const) {
    assert.throws(
      () => expandMatrix({ ...matrixDefinition(), [axis]: [] }),
      new RegExp(`${axis} must contain at least one entry`, "u"),
    );
  }
});

test("matrix snapshots and deeply freezes trial references before identity", () => {
  const definition = structuredClone(matrixDefinition());
  const trials = expandMatrix(definition);
  const first = trials[0];

  assert.ok(first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.evaluator), true);
  assert.equal(Object.isFrozen(first.task), true);
  assert.equal(first.id, createTrialIdentity(first));

  (definition.evaluator as { calver: string }).calver = "2027.1.1";
  (definition.tasks[0] as { id: string }).id = "mutated-task";

  assert.equal(first.evaluator.calver, "2026.8.9");
  assert.equal(first.task.id, "task-a");
  assert.equal(first.id, createTrialIdentity(first));
  assert.throws(() => {
    (first.task as { id: string }).id = "forbidden";
  });
});

test("matrix projects only allowlisted evaluator provenance into trial identity", () => {
  const definition = matrixDefinition();
  const [projected] = expandMatrix({
    ...definition,
    evaluator: {
      ...definition.evaluator,
      undeclaredSecret: "must-not-enter-trial",
    } as typeof definition.evaluator,
  });

  assert.ok(projected);
  assert.deepEqual(Object.keys(projected.evaluator).sort(), [
    "calver",
    "commit",
    "configurationDigest",
    "repository",
  ]);
  assert.doesNotMatch(JSON.stringify(projected), /must-not-enter-trial/u);
  assert.throws(
    () =>
      expandMatrix({
        ...definition,
        evaluator: {
          ...definition.evaluator,
          repository: "https://github.com/attacker/coffee-chat-eval",
        },
      }),
    /trusted evaluator provenance is invalid/u,
  );
});
