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

const PRODUCT_BOUNDARY = Object.freeze({
  candidateMode: "connectivity_only" as const,
  capabilitiesUsed: Object.freeze([]) as readonly [],
  productBehaviorExercised: false as const,
  referenceHost: "eval-skills-reference-host-v1" as const,
  productIdentity: Object.freeze({
    repository: "https://github.com/openboa-ai/coffee-chat" as const,
    commit: "a".repeat(40),
    calver: "2026.8.23",
    packageDigest: ("sha256:" + "b".repeat(64)) as `sha256:${string}`,
  }),
});

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

test("product trial receipts bind connectivity-only provenance without claiming behavior", () => {
  const receipt = createTrialReceipt({
    runId: "run-product",
    trackId: "ifeval",
    trialId: "prompt-1000",
    executionStatus: "measured",
    host: {
      id: "eval-skills-reference-host-v1",
      isolationClass: "real",
      evidenceRef: ("sha256:" + "d".repeat(64)) as `sha256:${string}`,
    },
    artifacts: { output: ("sha256:" + "e".repeat(64)) as `sha256:${string}` },
    metrics: null,
    productBoundary: PRODUCT_BOUNDARY,
  });

  assert.equal(receipt.candidateMode, "connectivity_only");
  assert.deepEqual(receipt.capabilitiesUsed, []);
  assert.equal(receipt.productBehaviorExercised, false);
  assert.equal(receipt.productIdentity?.commit, "a".repeat(40));
  assert.equal("packageRoot" in receipt, false);
  assert.equal(Object.isFrozen(receipt.capabilitiesUsed), true);

  assert.throws(
    () =>
      createTrialReceipt({
        runId: "run-product",
        trackId: "ifeval",
        trialId: "prompt-1000",
        executionStatus: "measured",
        host: receipt.host,
        artifacts: receipt.artifacts,
        metrics: null,
        productBoundary: {
          ...PRODUCT_BOUNDARY,
          capabilitiesUsed: ["coffee-chat"],
        } as never,
      }),
    /capabilitiesUsed|empty/u,
  );
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

test("track reports preserve the product connectivity boundary in provenance", () => {
  const report = createTrackReport({
    trackId: "ifeval",
    claimStatus: "calibration",
    executionStatus: "measured",
    nativeMetricIds: ["strictPrompt"],
    metrics: {
      strictPrompt: { numerator: 1, denominator: 1, value: 1 },
    },
    provenance: {
      sourceManifestDigest: ("sha256:" + "f".repeat(64)) as `sha256:${string}`,
      runId: "run-product",
      ...PRODUCT_BOUNDARY,
    },
  });

  const parsed = parseTrackReport(JSON.parse(JSON.stringify(report)));
  assert.equal(parsed.provenance.candidateMode, "connectivity_only");
  assert.deepEqual(parsed.provenance.capabilitiesUsed, []);
  assert.equal(parsed.provenance.productBehaviorExercised, false);
  assert.equal(parsed.provenance.productIdentity?.calver, "2026.8.23");
});

test("track reports preserve only redacted IFEval risk-acceptance provenance", () => {
  const rightsRiskAcceptanceDigest = ("sha256:" + "9".repeat(64)) as `sha256:${string}`;
  const report = createTrackReport({
    trackId: "ifeval",
    claimStatus: "calibration",
    executionStatus: "measured",
    nativeMetricIds: ["strictPrompt"],
    metrics: {
      strictPrompt: { numerator: 1, denominator: 1, value: 1 },
    },
    provenance: {
      sourceManifestDigest: ("sha256:" + "f".repeat(64)) as `sha256:${string}`,
      runId: "run-private-risk-accepted",
      rightsRiskAcceptanceDigest,
      licenseCleared: false,
      rightsExecutionScope: "private-internal-smoke-only",
      ...PRODUCT_BOUNDARY,
    },
  });

  const parsed = parseTrackReport(JSON.parse(JSON.stringify(report)));
  assert.equal(
    parsed.provenance.rightsRiskAcceptanceDigest,
    rightsRiskAcceptanceDigest,
  );
  assert.equal(parsed.provenance.licenseCleared, false);
  assert.equal(parsed.provenance.rightsExecutionScope, "private-internal-smoke-only");
  assert.equal(parsed.provenance.candidateMode, "connectivity_only");
  assert.equal(JSON.stringify(parsed).includes("workspace-owner"), false);

  assert.throws(
    () =>
      createTrackReport({
        trackId: "ifeval",
        claimStatus: "calibration",
        executionStatus: "measured",
        nativeMetricIds: ["strictPrompt"],
        metrics: {
          strictPrompt: { numerator: 1, denominator: 1, value: 1 },
        },
        provenance: {
          sourceManifestDigest: ("sha256:" + "f".repeat(64)) as `sha256:${string}`,
          runId: "run-private-risk-accepted-without-product-boundary",
          rightsRiskAcceptanceDigest,
          licenseCleared: false,
          rightsExecutionScope: "private-internal-smoke-only",
        },
      }),
    /rights risk provenance|product candidate boundary/u,
  );
});
