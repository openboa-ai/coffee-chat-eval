import assert from "node:assert/strict";
import test from "node:test";

import { formatDryRunReport } from "../src/report.ts";
import { createDryRunRegistry } from "../src/registry.ts";

test("dry-run report keeps fixture and unavailable states visible without scores", () => {
  const report = formatDryRunReport(createDryRunRegistry());

  assert.match(report, /fixture-only/);
  assert.match(report, /unmeasured/);
  assert.match(report, /unavailable/);
  assert.match(report, /no coffee chat performance score is produced/i);
});
