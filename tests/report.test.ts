import assert from "node:assert/strict";
import test from "node:test";

import { formatTrackReport } from "../src/report.ts";
import { createTrackReport } from "../src/eval-core.ts";

const PRODUCT_BOUNDARY = Object.freeze({
  candidateMode: "connectivity_only" as const,
  capabilitiesUsed: Object.freeze([]) as readonly [],
  productBehaviorExercised: false as const,
  referenceHost: "eval-skills-reference-host-v1" as const,
  productIdentity: Object.freeze({
    repository: "https://github.com/openboa-ai/coffee-chat" as const,
    commit: "e1ac82de77ab12b9b2499771a194ef3db356b3a6",
    calver: "2026.8.23",
    packageDigest:
      "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41" as `sha256:${string}`,
  }),
});

test("public Taste reports retain not_active without exposing numeric metrics", () => {
  const report = createTrackReport({
    trackId: "coffee-chat-taste",
    claimStatus: "provisional_internal",
    executionStatus: "measured",
    nativeMetricIds: ["pointwise", "pairwise"],
    metrics: {
      pointwise: { numerator: 5, denominator: 5, value: 1 },
      pairwise: { numerator: 4, denominator: 5, value: 0.8 },
    },
    provenance: {
      sourceManifestDigest: ("sha256:" + "a".repeat(64)) as `sha256:${string}`,
      runId: "run-taste",
    },
  });
  const output = formatTrackReport(report, "public");
  assert.match(output, /Benchmark: not_active/u);
  assert.doesNotMatch(output, /pointwise:|pairwise:|value:/u);
  assert.match(formatTrackReport(report, "internal"), /pointwise:/u);
});

test("product candidate reports state connectivity-only without a behavior claim", () => {
  const report = createTrackReport({
    trackId: "ifeval",
    claimStatus: "calibration",
    executionStatus: "measured",
    nativeMetricIds: ["strictPrompt"],
    metrics: {
      strictPrompt: { numerator: 1, denominator: 1, value: 1 },
    },
    provenance: {
      sourceManifestDigest: ("sha256:" + "a".repeat(64)) as `sha256:${string}`,
      runId: "run-product",
      candidateMode: "connectivity_only",
      capabilitiesUsed: [],
      productBehaviorExercised: false,
      referenceHost: "eval-skills-reference-host-v1",
      productIdentity: {
        repository: "https://github.com/openboa-ai/coffee-chat",
        commit: "e1ac82de77ab12b9b2499771a194ef3db356b3a6",
        calver: "2026.8.23",
        packageDigest:
          "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41",
      },
    },
  });

  const output = formatTrackReport(report, "public");
  assert.match(output, /Candidate mode: connectivity_only/u);
  assert.match(output, /Capabilities used: none/u);
  assert.match(output, /Product behavior exercised: false/u);
  assert.match(output, /not a Product performance claim/u);
  assert.match(output, /reference-host metrics are withheld/u);
  assert.doesNotMatch(output, /strictPrompt:|value:|1\/1/u);
  assert.doesNotMatch(output, /packageDigest|e39384/u);
  assert.match(formatTrackReport(report, "internal"), /strictPrompt: 1\/1/u);
});

test("public risk-accepted IFEval reports disclose the boundary but suppress metrics", () => {
  const report = createTrackReport({
    trackId: "ifeval",
    claimStatus: "calibration",
    executionStatus: "measured",
    nativeMetricIds: ["strictPrompt"],
    metrics: {
      strictPrompt: { numerator: 1, denominator: 1, value: 1 },
    },
    provenance: {
      sourceManifestDigest: ("sha256:" + "a".repeat(64)) as `sha256:${string}`,
      runId: "run-risk-accepted",
      rightsRiskAcceptanceDigest: ("sha256:" + "b".repeat(64)) as `sha256:${string}`,
      licenseCleared: false,
      rightsExecutionScope: "private-internal-smoke-only",
      ...PRODUCT_BOUNDARY,
    },
  });

  const output = formatTrackReport(report, "public");
  assert.match(output, /License cleared: false/u);
  assert.match(output, /private-internal-smoke-only/u);
  assert.match(output, /withheld/u);
  assert.doesNotMatch(output, /strictPrompt:|1\/1|workspace-owner/u);
  assert.match(formatTrackReport(report, "internal"), /strictPrompt: 1\/1/u);
});
