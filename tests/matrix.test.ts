import assert from "node:assert/strict";
import test from "node:test";

import { expandMatrix } from "../src/matrix.ts";

test("matrix expansion is a stable Cartesian product without duplicate trial ids", () => {
  const trials = expandMatrix({
    candidate: {
      repository: "https://github.com/openboa-ai/coffee-chat",
      commit: "0123456789abcdef0123456789abcdef01234567",
      calver: "2026.8.9",
      adapter: "fake-candidate",
    },
    tasks: [
      { id: "task-a", digest: "sha256:a" },
      { id: "task-b", digest: "sha256:b" },
    ],
    harnesses: [{ id: "harness", digest: "sha256:h" }],
    models: [
      { id: "model-a", digest: "sha256:ma" },
      { id: "model-b", digest: "sha256:mb" },
    ],
    hosts: [{ id: "fixture-host", isolationClass: "fixture" }],
    repetitions: 2,
  });

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
});
