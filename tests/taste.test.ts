import assert from "node:assert/strict";
import test from "node:test";

import {
  TASTE_FAMILY_COUNT,
  TASTE_JUDGE_CALLS,
  TASTE_SUBMISSION_COUNT,
  createTasteInventory,
  createTasteBridgeCommand,
  executeTasteBench,
  type TasteCondition,
} from "../src/taste.ts";

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
  const calls: string[] = [];
  const api = {
    getBenchmarkInput: async (manifest: unknown, condition: TasteCondition) => ({
      manifest,
      condition,
      prompt: "sealed upstream input",
    }),
    evaluateSubmission: async (input: unknown) => {
      calls.push(`submission:${JSON.stringify(input)}`);
      return { output: "candidate output" };
    },
    evaluateCaseFamily: async (request: unknown) => request,
  };
  const judge = {
    model: "gpt-5.6-luna",
    evaluate: async (request: { readonly kind: string }) => {
      calls.push(`judge:${request.kind}`);
      return { state: "measured" as const, verdict: "pass" };
    },
  };
  const result = await executeTasteBench({ profile: "pilot", api, judge });
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
    api: {
      ...api,
      getBenchmarkInput: async () => {
        throw new Error("source unavailable");
      },
    },
    judge,
  });
  assert.equal(failed.executionStatus, "unavailable");
  assert.equal(failed.failureOwner, "source");
  assert.equal(failed.score, null);
});
