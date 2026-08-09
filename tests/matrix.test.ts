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
      adapter: "public-adapter",
    },
    tasks: [{ id: "task-a", digest: stableDigest("task-a") }],
    harnesses: [{ id: "harness", digest: stableDigest("harness") }],
    models: [{ id: "model", digest: stableDigest("model") }],
    hosts: [
      {
        id: "fixture-host",
        isolationClass: "fixture",
        configurationDigest: stableDigest("fixture-host-configuration"),
        isolationReference: "fixture://host",
      },
      {
        id: "real-host",
        isolationClass: "real",
        configurationDigest: stableDigest("real-host-configuration"),
        isolationReference: "unavailable://real-host",
      },
    ],
    repetitions: 2,
  };
}

test("matrix expansion has deterministic unique identities for every declared tuple", () => {
  const first = expandMatrix(matrixDefinition());
  const second = expandMatrix(matrixDefinition());

  assert.equal(first.length, 4);
  assert.deepEqual(
    first.map((trial) => [trial.host.id, trial.repetition, trial.id]),
    second.map((trial) => [trial.host.id, trial.repetition, trial.id]),
  );
  assert.equal(new Set(first.map((trial) => trial.id)).size, 4);
  assert.ok(first.every((trial) => trial.id === createTrialIdentity(trial)));
});

test("matrix rejects an empty axis instead of silently creating no trials", () => {
  assert.throws(
    () => expandMatrix({ ...matrixDefinition(), hosts: [] }),
    /hosts must contain at least one entry/u,
  );
});

test("matrix expansion returns a canonical snapshot detached from caller objects", () => {
  const base = matrixDefinition();
  const candidate = {
    ...base.candidate,
    undeclaredSecret: "must-not-enter-the-trial",
  };
  const task = { id: "task-a", digest: stableDigest("task-a") };
  const host = base.hosts[0];
  assert.ok(host);
  const trials = expandMatrix({
    ...base,
    candidate,
    tasks: [task],
    hosts: [host],
    repetitions: 1,
  });
  const trial = trials[0];
  assert.ok(trial);
  const identity = trial.id;

  assert.equal("undeclaredSecret" in trial.candidate, false);

  candidate.repository = "https://example.invalid/mutated";
  task.id = "mutated-task";

  assert.equal(trial.candidate.repository, "https://github.com/openboa-ai/coffee-chat");
  assert.equal(trial.task.id, "task-a");
  assert.equal(createTrialIdentity(trial), identity);
  assert.equal(Object.isFrozen(trial.candidate), true);
  assert.equal(Object.isFrozen(trial.task), true);
});
