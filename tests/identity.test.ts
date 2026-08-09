import assert from "node:assert/strict";
import test from "node:test";

import { createTrialIdentity, stableDigest } from "../src/identity.ts";
import type { TrialSpec } from "../src/types.ts";

const trial: TrialSpec = {
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
  task: { id: "fixture-task", digest: stableDigest("fixture-task") },
  harness: { id: "fixture-harness", digest: stableDigest("fixture-harness") },
  model: { id: "fixture-model", digest: stableDigest("fixture-model") },
  host: {
    id: "fixture-host",
    isolationClass: "fixture",
    configurationDigest: stableDigest("fixture-host-configuration"),
    isolationReference: "fixture://fake-host",
  },
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
  assert.notEqual(
    createTrialIdentity({
      ...trial,
      evaluator: {
        ...trial.evaluator,
        configurationDigest: stableDigest("other-evaluator-configuration"),
      },
    }),
    first,
  );
  assert.notEqual(
    createTrialIdentity({
      ...trial,
      host: {
        ...trial.host,
        configurationDigest: stableDigest("other-host-configuration"),
      },
    }),
    first,
  );
});
