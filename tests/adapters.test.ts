import assert from "node:assert/strict";
import test from "node:test";

import { TRACK_ADAPTERS, getTrackAdapter } from "../src/adapters.ts";

test("all four adapters expose native metrics, sampling unit, census, and sealed boundary", () => {
  assert.deepEqual(Object.keys(TRACK_ADAPTERS), [
    "coffee-chat-taste",
    "beam-record-core",
    "ifeval",
    "agentdojo-security",
  ]);
  assert.equal(getTrackAdapter("coffee-chat-taste").inventory("score").length, 96);
  assert.equal(getTrackAdapter("beam-record-core").inventory("score").length, 240);
  assert.equal(getTrackAdapter("ifeval").inventory("score").length, 541);
  assert.equal(getTrackAdapter("agentdojo-security").inventory("score").length, 1081);
  for (const adapter of Object.values(TRACK_ADAPTERS)) {
    const visible = adapter.candidateVisibleInput(adapter.inventory("fixture")[0]);
    const serialized = JSON.stringify(visible);
    assert.doesNotMatch(
      serialized,
      /rubric|ground.?truth|injection.?goal|judge|secret|environment/iu,
    );
  }
});
