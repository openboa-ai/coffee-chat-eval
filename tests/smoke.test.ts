import assert from "node:assert/strict";
import test from "node:test";

import { formatDryRunReport } from "../src/report.ts";
import { createDryRunRegistry } from "../src/registry.ts";

test("dry run exposes the Bench projection and safe Codex boundary without a score", () => {
  const report = formatDryRunReport(createDryRunRegistry());

  assert.match(report, /bench-projection: unmeasured/u);
  assert.match(report, /native-harbor-codex: unavailable/u);
  assert.match(report, /credential_isolation_unavailable/u);
  assert.doesNotMatch(report, /(?:score|metric|performance)\s*[:=]\s*\d+/iu);
});
