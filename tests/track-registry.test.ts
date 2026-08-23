import assert from "node:assert/strict";
import test from "node:test";

import { EVALUATION_TRACKS, getEvaluationTrack } from "../src/track-registry.ts";

test("declares the supported track ids and their explicit case counts without track semantics", () => {
  assert.deepEqual(
    EVALUATION_TRACKS.map((track) => track.id),
    ["coffee-chat-taste", "beam-record-core", "ifeval", "agentdojo-security"],
  );

  for (const track of EVALUATION_TRACKS) {
    assert.equal(Number.isInteger(track.declaredCaseCount), true);
    assert.equal(track.declaredCaseCount >= 0, true);
    assert.equal(track.status, "not_active");
  }
  assert.equal(getEvaluationTrack("ifeval")?.id, "ifeval");
  assert.equal(getEvaluationTrack("unknown-track"), undefined);
});
