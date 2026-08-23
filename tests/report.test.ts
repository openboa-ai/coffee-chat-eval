import assert from "node:assert/strict";
import test from "node:test";

import { formatTrackReport } from "../src/report.ts";
import { createTrackReport } from "../src/eval-core.ts";

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
