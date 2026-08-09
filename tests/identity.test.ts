import assert from "node:assert/strict";
import test from "node:test";

import { createTrialIdentity } from "../src/identity.ts";
import type { TrialSpec } from "../src/types.ts";

const trial: TrialSpec = {
  candidate: {
    repository: "https://github.com/openboa-ai/coffee-chat",
    commit: "0123456789abcdef0123456789abcdef01234567",
    calver: "2026.8.9",
    adapter: "fake-candidate",
  },
  task: { id: "fixture-task", digest: "sha256:task" },
  harness: { id: "fixture-harness", digest: "sha256:harness" },
  model: { id: "fixture-model", digest: "sha256:model" },
  host: { id: "fixture-host", isolationClass: "fixture" },
  repetition: 0,
};

test("trial identity is stable for the complete tuple", () => {
  const first = createTrialIdentity(trial);
  const second = createTrialIdentity({ ...trial });

  assert.equal(first, second);
  assert.match(first, /^trial-[0-9a-f]{64}$/);
  assert.notEqual(createTrialIdentity({ ...trial, repetition: 1 }), first);
  assert.notEqual(
    createTrialIdentity({
      ...trial,
      model: { ...trial.model, id: "other-model" },
    }),
    first,
  );
});
