import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BEAM_CATEGORIES,
  BEAM_CONVERSATION_COUNT,
  BEAM_QUERY_COUNT,
  createBeamInventory,
  createBeamTrackExecutor,
  summarizeBeamObservations,
  type BeamObservation,
} from "../src/beam.ts";
import { createFixtureCandidateTransport } from "../src/transports.ts";
import { putEvidence } from "../src/evidence.ts";

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
    createBeamInventory("smoke").map((item) => [
      item.conversationId,
      item.category,
      item.questionOrdinal,
    ]),
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

test("BEAM bridge rejects response categories outside record-core before evaluation", () => {
  const script = String.raw`
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

bridge_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("beam_bridge", bridge_path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

with tempfile.TemporaryDirectory() as root_text:
    root = Path(root_text)
    source = root / "source"
    probing_path = source / "chats" / "100K" / "1" / "probing_questions"
    probing_path.mkdir(parents=True)
    probing = {
        category: [{"question": category, "rubric": ["rubric"]}]
        for category in (*bridge.CATEGORIES, "event_ordering")
    }
    (probing_path / "probing_questions.json").write_text(json.dumps(probing))
    query_path = root / "queries.json"
    query_path.write_text(json.dumps([{"category": "abstention"}]))
    category_map = {
        "abstention": [{"llm_response": "answer"}],
        "event_ordering": [{"llm_response": "hidden extra scorer"}],
    }
    for index, payload in enumerate((category_map, {"100K/1": category_map})):
        response_path = root / f"responses-{index}.json"
        response_path.write_text(json.dumps(payload))
        try:
            bridge.run(
                source,
                query_path,
                response_path,
                root / f"output-{index}.json",
                "fixture",
            )
        except ValueError as exc:
            assert "unadmitted category" in str(exc)
        else:
            raise AssertionError("unadmitted BEAM response category must fail closed")
`;
  execFileSync("python3", [
    "-c",
    script,
    new URL("../integrations/beam/bridge.py", import.meta.url).pathname,
  ]);
});

test("BEAM smoke executor sends six candidate queries and validates eleven native Judge calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-beam-executor-"));
  try {
    const sourceRoot = join(root, "source", "chats", "100K", "1", "probing_questions");
    mkdirSync(sourceRoot, { recursive: true });
    const bank = Object.fromEntries(
      BEAM_CATEGORIES.map((category, index) => [
        category,
        [
          {
            question: `${category} question`,
            rubric: Array.from(
              { length: index === 1 ? 4 : index === 4 || index === 5 ? 2 : 1 },
              (_, i) => `rubric-${i}`,
            ),
          },
        ],
      ]),
    );
    writeFileSync(join(sourceRoot, "probing_questions.json"), JSON.stringify(bank));
    let candidateCalls = 0;
    const candidateInputs: unknown[] = [];
    const candidate = createFixtureCandidateTransport(
      (input) => {
        candidateCalls += 1;
        candidateInputs.push(input);
        return `response-${candidateCalls}`;
      },
      { evidenceRoot: root },
    );
    const executor = createBeamTrackExecutor({
      conversationLoader: {
        load: async ({ conversationId }) => ({
          conversationId,
          messages: ["conversation-only"],
        }),
      },
      bridge: {
        run: async ({ outputPath, queryPath, responsePath }) => {
          const queries = JSON.parse(readFileSync(queryPath, "utf8")) as unknown[];
          const responses = JSON.parse(readFileSync(responsePath, "utf8")) as Record<
            string,
            unknown
          >;
          writeFileSync(
            outputPath,
            JSON.stringify({
              queryCount: queries.length,
              judgeCalls: 11,
              unusedEmbeddingInitializationBypassed: true,
              paperComparable: false,
              categories: Object.fromEntries(
                BEAM_CATEGORIES.map((category) => [
                  category,
                  { numerator: 0, denominator: 1, accuracy: 0 },
                ]),
              ),
              responses,
            }),
          );
        },
      },
    });
    const result = await executor({
      plan: {
        profile: "smoke",
        id: "run-beam",
        evidenceRoot: root,
        trackId: "beam-record-core",
      },
      source: { sourceRoot: join(root, "source") },
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
    assert.equal(candidateCalls, 6);
    assert.deepEqual(Object.keys(candidateInputs[0] as object).sort(), [
      "conversation",
      "question",
    ]);
    assert.deepEqual((candidateInputs[0] as { conversation: unknown }).conversation, {
      conversationId: "100K/1",
      messages: ["conversation-only"],
    });
    assert.equal(result.trialReceipts.length, 6);
    assert.equal(result.metrics.abstention?.denominator, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
