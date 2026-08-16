import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NATIVE_CODEX_AVAILABILITY } from "../src/harbor.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("stock Harbor Codex is unavailable until credentials leave candidate state", () => {
  assert.equal(NATIVE_CODEX_AVAILABILITY.status, "unavailable");
  assert.equal(NATIVE_CODEX_AVAILABILITY.reason, "credential_isolation_unavailable");
  const executionSources = ["src/cli.ts", "src/runner.ts", "src/harbor.ts"]
    .map(read)
    .join("\n");
  assert.doesNotMatch(executionSources, /process\.env\.OPENAI_API_KEY/u);
  assert.doesNotMatch(executionSources, /auth\.json|--agent-env/u);
});
