import assert from "node:assert/strict";
import test from "node:test";

import { createTrialIdentity, stableDigest } from "../src/identity.ts";
import { formatDryRunReport } from "../src/report.ts";
import { createDryRunRegistry } from "../src/registry.ts";
import { runDeferredTrial } from "../src/runner.ts";
import type { TrialSpec } from "../src/types.ts";

const trial: TrialSpec = {
  evaluator: {
    repository: "https://github.com/openboa-ai/coffee-chat-eval",
    commit: "741e54ea6c49b9ab53a6c29ee79ccc033dc548b9",
    calver: "2026.8.9",
    configurationDigest: stableDigest("evaluator"),
  },
  candidate: {
    repository: "https://github.com/openboa-ai/coffee-chat",
    commit: "0123456789abcdef0123456789abcdef01234567",
    calver: "2026.8.9",
    adapter: "public-adapter",
  },
  task: { id: "task", digest: stableDigest("task") },
  harness: { id: "harness", digest: stableDigest("harness") },
  model: { id: "model", digest: stableDigest("model") },
  host: {
    id: "real-host",
    isolationClass: "real",
    configurationDigest: stableDigest("host"),
    isolationReference: "unavailable://real-host",
  },
  repetition: 0,
};

test("dry run labels fixture and real-host outcomes without a performance score", () => {
  const report = formatDryRunReport(createDryRunRegistry());

  assert.match(report, /fixture-candidate-host: unmeasured/u);
  assert.match(report, /real-provider-host: unavailable/u);
  assert.doesNotMatch(report, /(?:score|metric|performance)\s*[:=]\s*\d+/iu);
});

test("deferred trial execution returns an explicit not implemented state", () => {
  assert.deepEqual(runDeferredTrial(trial), {
    trialId: createTrialIdentity(trial),
    status: "not_implemented",
    reason: "provider execution is deferred in the migration shell",
  });
});
