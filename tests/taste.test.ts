import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  TASTE_FAMILY_COUNT,
  TASTE_JUDGE_CALLS,
  TASTE_SUBMISSION_COUNT,
  createTasteInventory,
  createTasteBridgeCommand,
  executeTasteBench,
  createTasteTrackExecutor,
  type TasteCondition,
} from "../src/taste.ts";
import {
  createFixtureCandidateTransport,
  createFixtureJudgeTransport,
} from "../src/transports.ts";
import { putEvidence } from "../src/evidence.ts";

test("Coffee Chat Taste inventory keeps the 32 x 3 x (13+8) plan explicit", () => {
  assert.equal(TASTE_FAMILY_COUNT, 32);
  assert.equal(TASTE_SUBMISSION_COUNT, 96);
  assert.equal(TASTE_JUDGE_CALLS, 672);
  const smoke = createTasteInventory("smoke");
  assert.equal(smoke.families.length, 1);
  assert.deepEqual(smoke.conditions, [
    "unconditioned",
    "target_a",
    "target_b",
  ] satisfies readonly TasteCondition[]);
  assert.equal(smoke.submissions.length, 3);
  assert.equal(smoke.judgeCalls, 21);
  assert.equal(smoke.claimStatus, "calibration");
  const pilot = createTasteInventory("pilot");
  assert.equal(pilot.families.length, 1);
  assert.deepEqual(pilot.conditions, [
    "unconditioned",
    "target_a",
    "target_b",
  ] satisfies readonly TasteCondition[]);
  assert.equal(pilot.judgeCalls, 21);
  const score = createTasteInventory("score");
  assert.equal(score.families.length, 32);
  assert.equal(score.submissions.length, 96);
  assert.equal(score.judgeCalls, 672);
  assert.equal(score.claimStatus, "provisional_internal");
  assert.equal(score.benchmarkStatus, "not_active");
});

test("Taste bridge command keeps source/cache/evidence roots explicit", () => {
  const command = createTasteBridgeCommand({
    cacheRoot: "/var/tmp/eval-cache",
    evidenceRoot: "/var/tmp/eval-evidence",
    candidateConfigPath: "/var/tmp/candidate.json",
  });
  assert.equal(command.command, "node");
  assert.match(command.args.join(" "), /integrations\/bench\/bridge\.ts/u);
  assert.match(command.args.join(" "), /gpt-5\.6-luna/u);
});

test("Taste bridge keeps candidate inputs separate from sealed Judge calls and preserves failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-taste-test-"));
  const candidateSubmission = {
    artifact: { mediaType: "text/plain", content: "candidate output" },
    decisionRecord: {
      decision: "take a reversible next step",
      evidenceUse: [{ sourceId: "doc-1", use: "supports the decision" }],
      tradeoffs: [{ factors: ["speed", "safety"], resolution: "stage the change" }],
      constraints: [{ constraint: "preserve recovery", handling: "keep rollback" }],
      uncertainty: null,
    },
  };
  const calls: string[] = [];
  const api = {
    getBenchmarkInput: (manifest: unknown, condition: TasteCondition) => ({
      manifest,
      condition,
      prompt: "sealed upstream input",
    }),
    evaluateSubmission: async () => ({}),
    evaluateCaseFamily: async ({
      transport,
    }: {
      transport: { complete: (request: unknown) => Promise<{ raw: string }> };
    }) => {
      for (let index = 0; index < 21; index += 1) {
        calls.push(`judge:${index}`);
        await transport.complete({ index });
      }
      return { state: "measured" };
    },
  };
  const judge = {
    kind: "sealed-judge" as const,
    evaluate: async () => {
      const verdict = putEvidence(root, JSON.stringify({ score: 3 }), "private");
      return {
        state: "measured" as const,
        verdict: {
          path: verdict.path,
          digest: verdict.digest,
          mediaType: "application/json",
          bytes: JSON.stringify({ score: 3 }).length,
        },
        verdictDigest: verdict.digest,
        latencyMs: 1,
        inputTokens: null,
        outputTokens: null,
      };
    },
  };
  const candidate = createFixtureCandidateTransport(() => candidateSubmission, {
    evidenceRoot: root,
  });
  const result = await executeTasteBench({
    profile: "pilot",
    manifest: { familyId: "family-00" },
    api,
    candidate,
    judge,
  });
  assert.equal(result.executionStatus, "measured");
  assert.equal(result.submissions, 3);
  assert.equal(result.judgeCalls, 21);
  assert.equal(calls.filter((call) => call.startsWith("judge:")).length, 21);
  assert.doesNotMatch(
    JSON.stringify(result),
    /sealed upstream input|candidate output|rubric/iu,
  );

  const failed = await executeTasteBench({
    profile: "pilot",
    manifest: { familyId: "family-00" },
    candidate,
    api: {
      ...api,
      getBenchmarkInput: () => {
        throw new Error("source unavailable");
      },
    },
    judge,
  });
  assert.equal(failed.executionStatus, "unavailable");
  assert.equal(failed.failureOwner, "source");
  assert.equal(failed.score, null);
  rmSync(root, { recursive: true, force: true });
});

test("Taste native executor preserves the 3/13/8 smoke census privately", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-taste-native-"));
  try {
    let judgeCalls = 0;
    const api = {
      getBenchmarkInput: (_manifest: unknown, condition: TasteCondition) => ({
        condition,
      }),
      evaluateSubmission: async () => ({}),
      evaluateCaseFamily: async ({
        transport,
      }: {
        transport: { complete: (request: unknown) => Promise<{ raw: string }> };
      }) => {
        for (let index = 0; index < 21; index += 1) {
          judgeCalls += 1;
          await transport.complete({ index });
        }
        return { native: true, judgeCalls };
      },
    };
    const candidate = createFixtureCandidateTransport(
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
    const judge = {
      kind: "sealed-judge" as const,
      evaluate: async () => {
        const evidence = putEvidence(root, JSON.stringify({ score: 3 }), "private");
        return {
          state: "measured" as const,
          verdict: {
            path: evidence.path,
            digest: evidence.digest,
            mediaType: "application/json",
            bytes: Buffer.byteLength(JSON.stringify({ score: 3 })),
          },
          verdictDigest: evidence.digest,
          latencyMs: 1,
          inputTokens: null,
          outputTokens: null,
        };
      },
    };
    const executor = createTasteTrackExecutor({ api });
    const result = await executor({
      plan: {
        profile: "smoke",
        id: "run-taste",
        evidenceRoot: root,
        trackId: "coffee-chat-taste",
      },
      manifest: { caseId: "fixture" },
      source: { sourceRoot: root },
      candidate,
      judge,
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
    assert.equal(judgeCalls, 21);
    assert.equal(result.trialReceipts.length, 3);
    assert.equal(result.metrics["pointwiseCalls"]?.denominator, 13);
    assert.equal(result.metrics["pairwiseCalls"]?.denominator, 8);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Taste native executor loads the first pinned bank manifest for the native evaluator", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-taste-source-"));
  try {
    mkdirSync(join(root, "bank", "public", "cases"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "bank", "bank.json"),
      JSON.stringify({ cases: [{ casePath: "public/cases/first.json" }] }),
    );
    writeFileSync(
      join(root, "bank", "public", "cases", "first.json"),
      JSON.stringify({ caseId: "case-first" }),
    );
    writeFileSync(
      join(root, "src", "evaluator.ts"),
      `
      export function getBenchmarkInput(manifest, condition) {
        if (manifest.caseId !== "case-first") throw new Error("wrong Bench case manifest");
        return { condition };
      }
      export async function evaluateCaseFamily({ manifest, transport }) {
        if (manifest.caseId !== "case-first") throw new Error("wrong Bench family manifest");
        for (let index = 0; index < 21; index += 1) await transport.complete({ index });
        return { state: "measured" };
      }
    `,
    );
    const candidate = createFixtureCandidateTransport(
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
    const result = await createTasteTrackExecutor()({
      plan: {
        profile: "smoke",
        id: "run-taste-source",
        evidenceRoot: root,
        trackId: "coffee-chat-taste",
      },
      manifest: { sourceManifest: true },
      source: { sourceRoot: root },
      candidate,
      judge,
      evidence: ({ value, mediaType }) => {
        const item = putEvidence(root, `${JSON.stringify(value)}\n`, "private");
        return {
          path: item.path,
          digest: item.digest,
          mediaType,
          bytes: readFileSync(item.path).byteLength,
        };
      },
    });
    assert.equal(result.executionStatus, "measured");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
