import assert from "node:assert/strict";
import test from "node:test";

import {
  createTrialReceipt,
  createTrackReport,
  parseTrackReport,
  type CandidateTransport,
  type InteractiveAgentTransport,
  type JudgeTransport,
  type TrackAdapter,
} from "../src/eval-core.ts";

test("common contracts keep candidate, judge, and interactive transports separate", () => {
  const candidate: CandidateTransport = {
    kind: "fixture",
    run: async () => ({ state: "unmeasured", reason: "fixture transport only" }),
  };
  const interactive: InteractiveAgentTransport = {
    kind: "agent_stack",
    run: candidate.run,
    openSession: async () => ({
      send: async () => undefined,
      close: async () => undefined,
    }),
  };
  const judge: JudgeTransport = {
    kind: "sealed-judge",
    evaluate: async () => ({ state: "unmeasured", reason: "judge not invoked" }),
  };
  assert.equal(candidate.kind, "fixture");
  assert.equal(interactive.kind, "agent_stack");
  assert.equal(judge.kind, "sealed-judge");
  const adapter: TrackAdapter = {
    id: "ifeval",
    nativeMetricIds: [
      "strictPrompt",
      "strictInstruction",
      "loosePrompt",
      "looseInstruction",
    ],
    samplingUnit: "prompt",
    inventory: () => [],
    candidateVisibleInput: () => ({ inputDigest: "sha256:" + "a".repeat(64) }),
  };
  assert.equal(adapter.id, "ifeval");
});

test("trial receipt preserves non-measurement states and artifact provenance", () => {
  const receipt = createTrialReceipt({
    runId: "run-example",
    trackId: "agentdojo-security",
    trialId: "trial-example",
    executionStatus: "unavailable",
    failureOwner: "host",
    host: {
      id: "host-fixture",
      isolationClass: "fixture",
      evidenceRef: ("sha256:" + "b".repeat(64)) as `sha256:${string}`,
    },
    artifacts: { output: ("sha256:" + "c".repeat(64)) as `sha256:${string}` },
    metrics: null,
  });
  assert.equal(receipt.executionStatus, "unavailable");
  assert.equal(receipt.failureOwner, "host");
  assert.equal(receipt.metrics, null);
  assert.match(receipt.id, /^trial-receipt-[0-9a-f]{64}$/u);
});

test("track report keeps native metric denominators independent and never emits a composite", () => {
  const report = createTrackReport({
    trackId: "agentdojo-security",
    claimStatus: "pilot",
    executionStatus: "invalid",
    nativeMetricIds: ["benignUtility", "targetedASR"],
    metrics: {
      benignUtility: { numerator: 3, denominator: 4, value: 0.75 },
      targetedASR: { numerator: null, denominator: null, value: null },
    },
    provenance: {
      sourceManifestDigest: ("sha256:" + "d".repeat(64)) as `sha256:${string}`,
      runId: "run-example",
    },
  });
  assert.equal(report.metrics.targetedASR?.value, null);
  assert.equal("composite" in report, false);
  const parsed = parseTrackReport(JSON.parse(JSON.stringify(report)));
  assert.equal(parsed.metrics.benignUtility?.denominator, 4);
  assert.throws(
    () =>
      parseTrackReport({
        ...JSON.parse(JSON.stringify(report)),
        metrics: {
          ...JSON.parse(JSON.stringify(report)).metrics,
          secret: { numerator: 1, denominator: 1, value: 1 },
        },
      }),
    /metrics do not match/u,
  );
});
