import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  IFEVAL_PILOT_CASES,
  IFEVAL_PROMPT_COUNT,
  IFEVAL_TOP_LEVEL_FAMILIES,
  createIfevalInventory,
  createIfevalTrackExecutor,
  summarizeIfevalObservations,
  type IfevalObservation,
} from "../src/ifeval.ts";
import { createFixtureCandidateTransport } from "../src/transports.ts";
import { putEvidence } from "../src/evidence.ts";

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

test("IFEval smoke executor calls the candidate for nine pinned prompts and validates native denominators", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-ifeval-executor-"));
  try {
    const sourceRoot = join(root, "source");
    const inputPath = join(sourceRoot, "instruction_following_eval", "data");
    mkdirSync(inputPath, { recursive: true });
    writeFileSync(
      join(inputPath, "input_data.jsonl"),
      IFEVAL_PILOT_CASES.map((entry) =>
        JSON.stringify({ key: Number(entry.caseId), prompt: `prompt-${entry.caseId}` }),
      ).join("\n") + "\n",
    );
    let candidateCalls = 0;
    const candidate = createFixtureCandidateTransport(
      () => {
        candidateCalls += 1;
        return `response-${candidateCalls}`;
      },
      { evidenceRoot: root },
    );
    const executor = createIfevalTrackExecutor({
      bridge: {
        run: async ({ output, keys }) => {
          writeFileSync(
            output,
            JSON.stringify({
              source: { inputCount: keys.length, keys },
              metrics: {
                strictPrompt: {
                  numerator: 1,
                  denominator: keys.length,
                  accuracy: 1 / keys.length,
                },
                strictInstruction: {
                  numerator: 1,
                  denominator: keys.length,
                  accuracy: 1 / keys.length,
                },
                loosePrompt: {
                  numerator: 1,
                  denominator: keys.length,
                  accuracy: 1 / keys.length,
                },
                looseInstruction: {
                  numerator: 1,
                  denominator: keys.length,
                  accuracy: 1 / keys.length,
                },
              },
            }),
          );
        },
      },
    });
    const result = await executor({
      plan: {
        profile: "smoke",
        id: "run-ifeval",
        evidenceRoot: root,
        trackId: "ifeval",
      },
      source: { sourceRoot },
      candidate,
      evidence: ({ value, mediaType }) => {
        const evidence = putEvidence(
          root,
          typeof value === "string" ? value : JSON.stringify(value),
          "private",
        );
        return {
          path: evidence.path,
          digest: evidence.digest,
          mediaType,
          bytes: Buffer.byteLength(
            typeof value === "string" ? value : JSON.stringify(value),
          ),
        };
      },
    });
    assert.equal(result.executionStatus, "measured");
    assert.equal(candidateCalls, 9);
    assert.equal(result.metrics.strictPrompt?.denominator, 9);
    assert.equal(result.trialReceipts.length, 9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("IFEval score executor resolves ordinal inventory identities to official source keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-ifeval-score-executor-"));
  try {
    const sourceRoot = join(root, "source");
    const inputPath = join(sourceRoot, "instruction_following_eval", "data");
    mkdirSync(inputPath, { recursive: true });
    writeFileSync(
      join(inputPath, "input_data.jsonl"),
      Array.from({ length: IFEVAL_PROMPT_COUNT }, (_, index) =>
        JSON.stringify({ key: 2000 + index, prompt: `prompt-${index}` }),
      ).join("\n") + "\n",
    );
    const candidate = createFixtureCandidateTransport(() => "score-response", {
      evidenceRoot: root,
    });
    let observedKeys: readonly number[] = [];
    const executor = createIfevalTrackExecutor({
      bridge: {
        run: async ({ output, keys }) => {
          observedKeys = keys;
          writeFileSync(
            output,
            JSON.stringify({
              source: { inputCount: keys.length, keys },
              metrics: Object.fromEntries(
                [
                  "strictPrompt",
                  "strictInstruction",
                  "loosePrompt",
                  "looseInstruction",
                ].map((key) => [
                  key,
                  { numerator: 0, denominator: keys.length, accuracy: 0 },
                ]),
              ),
            }),
          );
        },
      },
    });
    const result = await executor({
      plan: {
        profile: "score",
        id: "run-ifeval-score",
        evidenceRoot: root,
        trackId: "ifeval",
      },
      source: { sourceRoot },
      candidate,
      evidence: ({ value, mediaType }) => {
        const evidence = putEvidence(root, JSON.stringify(value), "private");
        return {
          path: evidence.path,
          digest: evidence.digest,
          mediaType,
          bytes: Buffer.byteLength(JSON.stringify(value)),
        };
      },
    });
    assert.equal(result.executionStatus, "measured");
    assert.equal(result.trialReceipts.length, IFEVAL_PROMPT_COUNT);
    assert.deepEqual(observedKeys.slice(0, 3), [2000, 2001, 2002]);
    assert.deepEqual(observedKeys.slice(-1), [2540]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
