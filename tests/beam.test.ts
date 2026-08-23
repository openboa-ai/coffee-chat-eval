import assert from "node:assert/strict";
import test from "node:test";

import {
  BEAM_CATEGORIES,
  BEAM_CONVERSATION_COUNT,
  BEAM_QUERY_COUNT,
  createBeamInventory,
  summarizeBeamObservations,
  type BeamObservation,
} from "../src/beam.ts";

test("BEAM record-core inventory is 20 conversations x six categories x two stable questions", () => {
  assert.deepEqual(BEAM_CATEGORIES, [
    "abstention",
    "contradiction_resolution",
    "information_extraction",
    "knowledge_update",
    "multi_session_reasoning",
    "temporal_reasoning",
  ]);
  assert.equal(BEAM_CONVERSATION_COUNT, 20);
  assert.equal(BEAM_QUERY_COUNT, 240);
  assert.equal(createBeamInventory("score").length, 240);
  assert.equal(createBeamInventory("smoke").length, 6);
  assert.deepEqual(
    createBeamInventory("smoke").map((item) => [item.conversationId, item.category, item.questionOrdinal]),
    [
      ["100K/1", "abstention", 0],
      ["100K/1", "contradiction_resolution", 0],
      ["100K/1", "information_extraction", 0],
      ["100K/1", "knowledge_update", 0],
      ["100K/1", "multi_session_reasoning", 0],
      ["100K/1", "temporal_reasoning", 0],
    ],
  );
  assert.equal(createBeamInventory("pilot").length, 12);
  assert.equal(createBeamInventory("fixture").length, 1);
});

test("BEAM preserves upstream diagnostic quirks and reports categories independently", () => {
  const observations: BeamObservation[] = [
    {
      conversationId: "100K/00",
      category: "abstention",
      score: 0.5,
      response: "<question>",
    },
    {
      conversationId: "100K/00",
      category: "abstention",
      score: 1,
      response: "answer",
    },
  ];
  const report = summarizeBeamObservations(observations);
  assert.equal(report.flags.partialCreditTruncation, true);
  assert.equal(report.flags.questionPlaceholderUnexpanded, true);
  assert.equal(report.flags.paperComparable, false);
  assert.deepEqual(report.categories.abstention, {
    numerator: 1,
    denominator: 2,
    accuracy: 0.5,
  });
  assert.equal(report.categories.temporal_reasoning, null);
  assert.equal(summarizeBeamObservations([]).categories.abstention, null);
});
