import assert from "node:assert/strict";
import test from "node:test";

import {
  IFEVAL_PILOT_CASES,
  IFEVAL_PROMPT_COUNT,
  IFEVAL_TOP_LEVEL_FAMILIES,
  createIfevalInventory,
  summarizeIfevalObservations,
  type IfevalObservation,
} from "../src/ifeval.ts";

test("IFEval inventory pins the official 541 prompts and nine checker-family first cases", () => {
  assert.equal(IFEVAL_PROMPT_COUNT, 541);
  assert.deepEqual(IFEVAL_TOP_LEVEL_FAMILIES, [
    "punctuation",
    "detectable_format",
    "length_constraints",
    "detectable_content",
    "combination",
    "change_case",
    "startend",
    "keywords",
    "language",
  ]);
  assert.deepEqual(IFEVAL_PILOT_CASES, [
    { family: "punctuation", caseId: "1000" },
    { family: "detectable_format", caseId: "1012" },
    { family: "length_constraints", caseId: "1069" },
    { family: "detectable_content", caseId: "1005" },
    { family: "combination", caseId: "1098" },
    { family: "change_case", caseId: "1019" },
    { family: "startend", caseId: "1040" },
    { family: "keywords", caseId: "1122" },
    { family: "language", caseId: "1108" },
  ]);
  assert.equal(createIfevalInventory("score").length, 541);
  assert.equal(createIfevalInventory("smoke").length, 9);
  assert.equal(createIfevalInventory("pilot").length, 9);
  assert.equal(createIfevalInventory("fixture").length, 1);
});

test("IFEval keeps four native metrics and never turns an empty denominator into zero", () => {
  const observations: IfevalObservation[] = [
    {
      caseId: "1000",
      strictPrompt: true,
      strictInstructions: [true, false],
      loosePrompt: true,
      looseInstructions: [true, true],
    },
    {
      caseId: "1005",
      strictPrompt: false,
      strictInstructions: [false],
      loosePrompt: true,
      looseInstructions: [true],
    },
  ];
  const report = summarizeIfevalObservations(observations);
  assert.deepEqual(report.metrics.strictPrompt, {
    numerator: 1,
    denominator: 2,
    accuracy: 0.5,
  });
  assert.deepEqual(report.metrics.strictInstruction, {
    numerator: 1,
    denominator: 3,
    accuracy: 1 / 3,
  });
  assert.deepEqual(report.metrics.loosePrompt, {
    numerator: 2,
    denominator: 2,
    accuracy: 1,
  });
  assert.deepEqual(report.metrics.looseInstruction, {
    numerator: 3,
    denominator: 3,
    accuracy: 1,
  });
  assert.equal(summarizeIfevalObservations([]).metrics.strictPrompt.accuracy, null);
});
