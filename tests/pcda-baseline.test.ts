import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPcdaCli } from "../src/pcda-cli.ts";
import {
  calibratePcdaNativeResults,
  parsePcdaNativeResult,
} from "../src/pcda-receipt.ts";
import { PCDA_CALIBRATION_RESULT_BYTES } from "../src/pcda-resources.ts";

function nativeResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "pcda-calibration-oracle",
    trial_name: "coffee-chat-pcda-calibration__oracle__1",
    task_name: "openboa-ai/pcda-case-projection",
    exception_info: null,
    verifier_environment_mode: "separate",
    verifier_result: { rewards: { reward: 1 } },
    agent_info: {
      name: "oracle",
      version: "0.1.0",
      model_info: { name: "deterministic" },
    },
    config: { environment: { type: "docker", delete: true } },
    ...overrides,
  };
}

test("credential-free PCDA calibration accepts Oracle=1 and no-op=0", () => {
  assert.deepEqual(
    calibratePcdaNativeResults({
      oracle: nativeResult(),
      noop: nativeResult({
        id: "pcda-calibration-noop",
        trial_name: "coffee-chat-pcda-calibration__nop__1",
        agent_info: { name: "nop", version: "0.1.0" },
        verifier_result: { rewards: { reward: 0 } },
      }),
    }),
    { state: "accepted", oracleReward: 1, noopReward: 0 },
  );
});

test("PCDA calibration rejects reversed evidence and preserves verifier failures", () => {
  assert.deepEqual(
    calibratePcdaNativeResults({
      oracle: nativeResult({ verifier_result: { rewards: { reward: 0 } } }),
      noop: nativeResult({
        id: "pcda-calibration-noop",
        trial_name: "coffee-chat-pcda-calibration__nop__1",
        agent_info: { name: "nop", version: "0.1.0" },
        verifier_result: { rewards: { reward: 1 } },
      }),
    }),
    { state: "rejected", reason: "Oracle must be 1 and no-op must be 0" },
  );
  assert.deepEqual(
    parsePcdaNativeResult(
      nativeResult({
        exception_info: { exception_type: "VerifierError" },
        verifier: {},
      }),
    ),
    {
      state: "invalid",
      failureClass: "verifier",
      reason: "Harbor trial recorded an exception",
    },
  );
});

test("PCDA calibration binds exact Oracle and no-op native identities", () => {
  const noop = nativeResult({
    id: "pcda-calibration-noop",
    trial_name: "coffee-chat-pcda-calibration__nop__1",
    agent_info: { name: "nop", version: "0.1.0" },
    verifier_result: { rewards: { reward: 0 } },
  });
  for (const [label, oracle, candidateNoop] of [
    [
      "swapped roles",
      nativeResult({ agent_info: { name: "nop", version: "0.1.0" } }),
      nativeResult({
        id: "pcda-calibration-noop",
        trial_name: "coffee-chat-pcda-calibration__nop__1",
        agent_info: { name: "oracle", version: "0.1.0" },
        verifier_result: { rewards: { reward: 0 } },
      }),
    ],
    [
      "unexpected agent version",
      nativeResult({ agent_info: { name: "oracle", version: "0.2.0" } }),
      noop,
    ],
    [
      "unexpected trial identity",
      nativeResult({ id: "candidate-selected-oracle" }),
      noop,
    ],
  ] as const) {
    assert.equal(
      calibratePcdaNativeResults({ oracle, noop: candidateNoop }).state,
      "invalid",
      label,
    );
  }
});

test("PCDA CLI exposes calibration only", async () => {
  const root = mkdtempSync(join(tmpdir(), "pcda-calibration-"));
  try {
    const oracle = join(root, "oracle.json");
    const noop = join(root, "noop.json");
    writeFileSync(oracle, `${JSON.stringify(nativeResult())}\n`);
    writeFileSync(
      noop,
      `${JSON.stringify(
        nativeResult({
          id: "pcda-calibration-noop",
          trial_name: "coffee-chat-pcda-calibration__nop__1",
          agent_info: { name: "nop", version: "0.1.0" },
          verifier_result: { rewards: { reward: 0 } },
        }),
      )}\n`,
    );
    assert.deepEqual(
      await runPcdaCli(["calibrate", "--oracle-result", oracle, "--noop-result", noop]),
      {
        exitCode: 0,
        report: { state: "accepted", oracleReward: 1, noopReward: 0 },
      },
    );
    await assert.rejects(runPcdaCli(["codex"]), /usage: pcda-cli calibrate/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("PCDA CLI rejects oversized and non-regular calibration evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "pcda-calibration-bounds-"));
  try {
    const oversized = join(root, "oversized.json");
    const noop = join(root, "noop.json");
    writeFileSync(oversized, Buffer.alloc(PCDA_CALIBRATION_RESULT_BYTES + 1, 0x20));
    writeFileSync(noop, "{}\n");
    await assert.rejects(
      runPcdaCli(["calibrate", "--oracle-result", oversized, "--noop-result", noop]),
      /resource limit/u,
    );
    const directory = join(root, "directory");
    mkdirSync(directory);
    await assert.rejects(
      runPcdaCli(["calibrate", "--oracle-result", directory, "--noop-result", noop]),
      /regular file|EISDIR/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
