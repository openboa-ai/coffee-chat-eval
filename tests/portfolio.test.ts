import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { putEvidence } from "../src/evidence.ts";
import {
  executePortfolioSmoke,
  parsePortfolioBrokerConfig,
  PORTFOLIO_SMOKE_CENSUS,
} from "../src/portfolio.ts";
import { runCli } from "../src/cli.ts";
import type { ImmutableRunResult } from "../src/run-engine.ts";
import { createIfevalTrackExecutor } from "../src/ifeval.ts";
import { createTasteTrackExecutor } from "../src/taste.ts";
import { createBeamTrackExecutor, BEAM_CATEGORIES } from "../src/beam.ts";
import { createAgentDojoTrackExecutor } from "../src/agentdojo.ts";
import {
  createFixtureCandidateTransport,
  createFixtureJudgeTransport,
} from "../src/transports.ts";

function fakeResult(
  root: string,
  trackId: keyof typeof PORTFOLIO_SMOKE_CENSUS,
  native: unknown,
): ImmutableRunResult {
  const evidence = putEvidence(root, `${JSON.stringify(native)}\n`, "private");
  const runId = `run-${trackId}`;
  const runRoot = join(root, runId);
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(join(runRoot, "trial-receipts.json"), "[]\n");
  const trackReport = {
    trackId,
    claimStatus: "calibration" as const,
    executionStatus: "measured" as const,
    nativeMetricIds: [],
    denominators: {},
    metrics: {},
    provenance: { sourceManifestDigest: evidence.digest, runId },
  };
  return {
    plan: { id: runId } as ImmutableRunResult["plan"],
    trackReport,
    nativeEvidence: {
      path: evidence.path,
      digest: evidence.digest,
      mediaType: "application/json",
      bytes: evidence.path.length,
    },
    cleanupStatus: "complete",
    publicReceiptPath: join(runRoot, "public-receipt.json"),
    trackReportPath: join(runRoot, "track-report.json"),
    trialReceiptsPath: join(runRoot, "trial-receipts.json"),
    publicReceipt: {} as ImmutableRunResult["publicReceipt"],
  };
}

test("portfolio smoke receipt gates all four sampled native censuses without metric thresholds", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-"));
  try {
    const native = {
      "coffee-chat-taste": {
        schema: "coffee-chat-eval/taste-native-v1",
        summary: { candidateArtifacts: [{}, {}, {}], judgeCalls: 21 },
      },
      "beam-record-core": { queryCount: 6, judgeCalls: 11 },
      ifeval: {
        source: { inputCount: 9 },
        metrics: Object.fromEntries(
          ["strictPrompt", "strictInstruction", "loosePrompt", "looseInstruction"].map(
            (key) => [key, { denominator: 9 }],
          ),
        ),
      },
      "agentdojo-security": { episodes: [{}, {}, {}] },
    } as const;
    const tracks = (
      Object.keys(PORTFOLIO_SMOKE_CENSUS) as (keyof typeof PORTFOLIO_SMOKE_CENSUS)[]
    ).map((trackId) => ({
      trackId: trackId as
        "coffee-chat-taste" | "beam-record-core" | "ifeval" | "agentdojo-security",
      plan: { id: `run-${trackId}` } as never,
      manifest: {} as never,
      candidate: {} as never,
      judge: undefined,
    }));
    const receipt = await executePortfolioSmoke({
      tracks,
      evidenceRoot: root,
      runTrack: async (track) => fakeResult(root, track.trackId, native[track.trackId]),
    });
    assert.equal(receipt.status, "measured");
    assert.equal(receipt.claimStatus, "calibration");
    assert.equal(receipt.tracks.length, 4);
    assert.match(receipt.publicReceiptPath, /public-receipt\.json$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio cleanup failure is recorded as invalid instead of escaping the receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-cleanup-"));
  try {
    const native = {
      "coffee-chat-taste": {
        summary: { candidateArtifacts: [{}, {}, {}], judgeCalls: 21 },
      },
      "beam-record-core": { queryCount: 6, judgeCalls: 11 },
      ifeval: { source: { inputCount: 9 } },
      "agentdojo-security": { episodes: [{}, {}, {}] },
    } as const;
    const tracks = Object.keys(PORTFOLIO_SMOKE_CENSUS).map((trackId) => ({
      trackId: trackId as keyof typeof PORTFOLIO_SMOKE_CENSUS,
      plan: { id: `cleanup-${trackId}` } as never,
      manifest: {} as never,
      candidate: {} as never,
      judge: undefined,
      close: async () => {
        if (trackId === "beam-record-core") throw new Error("proxy close failed");
      },
    }));
    const receipt = await executePortfolioSmoke({
      tracks,
      evidenceRoot: root,
      runTrack: async (track) => fakeResult(root, track.trackId, native[track.trackId]),
    });
    assert.equal(receipt.status, "failed");
    assert.equal(
      receipt.tracks.find((track) => track.trackId === "beam-record-core")
        ?.cleanupStatus,
      "failed",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio smoke CLI requires an absolute private config", async () => {
  await assert.rejects(
    () => runCli(["portfolio", "smoke", "--config", "relative.json"]),
    /absolute/u,
  );
});

test("portfolio broker config names a host-held key without accepting key bytes", () => {
  assert.deepEqual(parsePortfolioBrokerConfig({ providerKeyEnv: "OPENAI_API_KEY" }), {
    providerKeyEnv: "OPENAI_API_KEY",
  });
  assert.throws(
    () => parsePortfolioBrokerConfig({ providerKey: "provider-secret" }),
    /provider key bytes are not accepted|providerKey/u,
  );
});

test("offline portfolio replay executes all four sampled Runner paths", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-replay-"));
  try {
    const sourceRoot = join(root, "source");
    mkdirSync(join(sourceRoot, "instruction_following_eval", "data"), {
      recursive: true,
    });
    mkdirSync(join(sourceRoot, "chats", "100K", "1", "probing_questions"), {
      recursive: true,
    });
    writeFileSync(
      join(sourceRoot, "instruction_following_eval", "data", "input_data.jsonl"),
      [1000, 1012, 1069, 1005, 1098, 1019, 1040, 1122, 1108]
        .map((key) => JSON.stringify({ key, prompt: `prompt-${key}` }))
        .join("\n") + "\n",
    );
    const beamBank = Object.fromEntries(
      BEAM_CATEGORIES.map((category, index) => [
        category,
        [
          {
            question: `${category}-question`,
            rubric: Array.from(
              { length: index === 1 ? 4 : index > 3 ? 2 : 1 },
              () => "rubric",
            ),
          },
        ],
      ]),
    );
    writeFileSync(
      join(
        sourceRoot,
        "chats",
        "100K",
        "1",
        "probing_questions",
        "probing_questions.json",
      ),
      JSON.stringify(beamBank),
    );
    const evidence = ({ value, mediaType }: { value: unknown; mediaType: string }) => {
      const item = putEvidence(root, `${JSON.stringify(value)}\n`, "private");
      return {
        path: item.path,
        digest: item.digest,
        mediaType,
        bytes: readFileSync(item.path).byteLength,
      };
    };
    const candidate = createFixtureCandidateTransport(() => "fixture", {
      evidenceRoot: root,
    });
    const tasteCandidate = createFixtureCandidateTransport(
      () => ({
        artifact: { mediaType: "text/plain", content: "fixture" },
        decisionRecord: {
          decision: "fixture",
          evidenceUse: [],
          tradeoffs: [],
          constraints: [],
          uncertainty: null,
        },
      }),
      { evidenceRoot: root },
    );
    const judge = createFixtureJudgeTransport(() => ({ score: 1 }), {
      evidenceRoot: root,
    });
    const plans = Object.keys(PORTFOLIO_SMOKE_CENSUS).map((trackId) => ({
      trackId: trackId as
        "coffee-chat-taste" | "beam-record-core" | "ifeval" | "agentdojo-security",
      plan: {
        id: `run-${trackId}`,
        profile: "smoke",
        evidenceRoot: root,
        trackId,
      } as never,
      manifest: {} as never,
      candidate: trackId === "coffee-chat-taste" ? tasteCandidate : candidate,
      judge:
        trackId === "coffee-chat-taste" || trackId === "beam-record-core"
          ? judge
          : undefined,
    }));
    const executors = {
      "coffee-chat-taste": createTasteTrackExecutor({
        api: {
          getBenchmarkInput: (_manifest, condition) => ({ condition }),
          evaluateSubmission: async () => ({ state: "measured" }),
          evaluateCaseFamily: async ({ transport }) => {
            for (let index = 0; index < 21; index += 1)
              await transport.complete({ index });
            return { state: "measured" };
          },
        },
      }),
      "beam-record-core": createBeamTrackExecutor({
        bridge: {
          run: async ({ outputPath }) => {
            writeFileSync(
              outputPath,
              JSON.stringify({
                queryCount: 6,
                judgeCalls: 11,
                unusedEmbeddingInitializationBypassed: true,
                paperComparable: false,
                categories: Object.fromEntries(
                  BEAM_CATEGORIES.map((category) => [
                    category,
                    { numerator: 0, denominator: 1, accuracy: 0 },
                  ]),
                ),
              }),
            );
          },
        },
      }),
      ifeval: createIfevalTrackExecutor({
        bridge: {
          run: async ({ output, keys }) => {
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
      }),
      "agentdojo-security": createAgentDojoTrackExecutor({
        bridge: {
          run: async ({ outputPath }) => {
            writeFileSync(
              outputPath,
              JSON.stringify({
                schema: "coffee-chat-eval/agentdojo-security-v1",
                sourceCommit: "a75aba7631d3ca5fb7ab938965c97ead2f9ff84b",
                benchmarkVersion: "v1.2.2",
                attack: "important_instructions_no_model_name",
                publishedTableComparable: false,
                status: "measured",
                candidateCalls: 3,
                benignUtility: { numerator: 1, denominator: 1, value: 1 },
                utilityUnderAttack: { numerator: 1, denominator: 1, value: 1 },
                targetedASR: { numerator: 0, denominator: 1, value: 0 },
                injectionTaskSolvability: { numerator: 1, denominator: 1, value: 1 },
                episodes: [
                  {
                    suite: "workspace",
                    kind: "benign",
                    userTaskId: "user_task_0",
                    injectionTaskId: null,
                  },
                  {
                    suite: "workspace",
                    kind: "injection-control",
                    userTaskId: null,
                    injectionTaskId: "injection_task_0",
                  },
                  {
                    suite: "workspace",
                    kind: "attacked",
                    userTaskId: "user_task_0",
                    injectionTaskId: "injection_task_0",
                  },
                ],
              }),
            );
          },
        },
      }),
    } as const;
    const receipt = await executePortfolioSmoke({
      tracks: plans,
      evidenceRoot: root,
      runTrack: async (track) => {
        const executor = executors[track.trackId];
        const result = await executor({
          plan: track.plan,
          manifest: track.manifest,
          source: { sourceRoot },
          candidate: track.candidate,
          judge: track.judge,
          runtime:
            track.trackId === "beam-record-core"
              ? {
                  judge: {
                    endpoint: "http://127.0.0.1:1",
                    capabilityToken: "fixture",
                    model: "gpt-5.6-luna",
                    maxRequests: 11,
                  },
                }
              : track.trackId === "agentdojo-security"
                ? {
                    candidate: {
                      endpoint: "http://127.0.0.1:1",
                      capabilityToken: "fixture",
                      model: "gpt-5.6-luna",
                      maxRequests: 45,
                    },
                  }
                : undefined,
          evidence,
        } as never);
        const runRoot = join(root, track.plan.id);
        mkdirSync(runRoot, { recursive: true });
        writeFileSync(
          join(runRoot, "trial-receipts.json"),
          JSON.stringify(result.trialReceipts),
        );
        return {
          plan: track.plan,
          trackReport: {
            trackId: track.trackId,
            claimStatus: "calibration",
            executionStatus: result.executionStatus,
            nativeMetricIds: Object.keys(result.metrics),
            denominators: {},
            metrics: result.metrics,
            provenance: {
              sourceManifestDigest: "sha256:" + "0".repeat(64),
              runId: track.plan.id,
            },
          },
          nativeEvidence: result.nativeEvidence,
          cleanupStatus: result.cleanupStatus,
          publicReceiptPath: join(runRoot, "public-receipt.json"),
          trackReportPath: join(runRoot, "track-report.json"),
          trialReceiptsPath: join(runRoot, "trial-receipts.json"),
          publicReceipt: {} as never,
        } as never;
      },
    });
    assert.equal(receipt.status, "measured");
    assert.equal(receipt.tracks.length, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
