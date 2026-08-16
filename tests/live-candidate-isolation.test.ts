import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NATIVE_CODEX_AVAILABILITY } from "../src/harbor.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("stock Harbor Codex is unavailable until credentials leave candidate state", () => {
  assert.equal(NATIVE_CODEX_AVAILABILITY.status, "unavailable");
  assert.equal(NATIVE_CODEX_AVAILABILITY.reason, "credential_isolation_unavailable");
  const adapterSources = [
    "src/codex-runner.ts",
    "src/codex.ts",
    "src/responses-proxy.ts",
  ]
    .map(read)
    .join("\n");
  assert.match(adapterSources, /startResponsesProxy/u);
  assert.match(adapterSources, /proxy_capability_only/u);
  assert.match(adapterSources, /capabilityToken: proxy\.capabilityToken/u);
  assert.match(adapterSources, /providerKeyInCandidateArtifacts/u);
  assert.doesNotMatch(adapterSources, /auth\.json/u);
});
