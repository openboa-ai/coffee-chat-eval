import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createRunPlan,
  parseRunSpec,
  parseSourceManifest,
  type RunPlan,
} from "../src/eval-core.ts";
import { IFEVAL_RUNTIME_LOCK } from "../src/python-runtime.ts";
import { IFEVAL_SMOKE_KEYS } from "../src/ifeval.ts";
import { stableDigest } from "../src/identity.ts";
import { executeImmutableRun } from "../src/run-engine.ts";
import { materializeSource } from "../src/source-cache.ts";
import { createFixtureCandidateTransport } from "../src/transports.ts";

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function privateFailureReason(
  result: Awaited<ReturnType<typeof executeImmutableRun>>,
): string {
  const evidence = JSON.parse(readFileSync(result.nativeEvidence.path, "utf8")) as {
    readonly reason?: unknown;
  };
  return String(evidence.reason);
}

function planFixture(): Readonly<{
  root: string;
  plan: RunPlan;
  manifest: ReturnType<typeof parseSourceManifest>;
}> {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-plan-integrity-"));
  const sourceInput = join(root, "source-input");
  const inputDataDirectory = join(sourceInput, "instruction_following_eval", "data");
  mkdirSync(inputDataDirectory, { recursive: true });
  writeFileSync(join(sourceInput, "LICENSE"), "license");
  writeFileSync(
    join(inputDataDirectory, "input_data.jsonl"),
    `${IFEVAL_SMOKE_KEYS.map((key) =>
      JSON.stringify({ key, prompt: `fixture prompt ${key}` }),
    ).join("\n")}\n`,
  );
  const manifest = parseSourceManifest({
    schema: "source-manifest-v1",
    trackId: "ifeval",
    source: {
      repository: "https://example.invalid/ifeval",
      commit: "d".repeat(40),
      license: "Apache-2.0",
      licenseDigest: digest("license"),
    },
    allowlist: ["LICENSE", "instruction_following_eval/data/input_data.jsonl"],
    excludedPaths: ["responses/**"],
    retention: {
      source: "cache-only",
      evidence: "private-content-addressed",
      public: "aggregate-provenance-only",
    },
    publicArtifactPolicy: "receipt-redacted",
  });
  const cacheRoot = join(root, "cache");
  materializeSource({
    manifest,
    cacheRoot,
    sourceRoot: sourceInput,
    runtimeLockDigest: digest(readFileSync(IFEVAL_RUNTIME_LOCK, "utf8")),
    runtimeLockOrigin: "eval-owned",
    expectedRuntimeLockPath: IFEVAL_RUNTIME_LOCK,
    licenseEvidence: [
      { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
    ],
  });
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId: "ifeval",
    profile: "fixture",
    sourceManifestDigest: stableDigest(manifest),
    candidateDigest: stableDigest("candidate"),
    judgeDigest: stableDigest("judge"),
    attackDigest: stableDigest("attack"),
    defenseDigest: stableDigest("defense"),
    configurationDigest: stableDigest("configuration"),
    candidateType: "fixture",
    caseCensus: { prompts: 1 },
  });
  const plan = createRunPlan({
    manifest,
    spec,
    evidenceRoot: join(root, "evidence"),
    cacheRoot,
  });
  return Object.freeze({ root, plan, manifest });
}

test("direct run execution rejects cloned plan identity drift before native dispatch", async () => {
  const attacks = [
    {
      name: "trackId",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({ ...plan, trackId: "agentdojo-security" }),
    },
    {
      name: "profile",
      mutate: (plan: RunPlan): RunPlan => Object.freeze({ ...plan, profile: "smoke" }),
    },
    {
      name: "id",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({ ...plan, id: "../forged-outside-evidence" }),
    },
    {
      name: "runSpecDigest",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({ ...plan, runSpecDigest: stableDigest("drifted run spec") }),
    },
    {
      name: "sourceManifestDigest",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({
          ...plan,
          sourceManifestDigest: stableDigest("drifted source manifest"),
        }),
    },
    {
      name: "claimStatus",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({ ...plan, claimStatus: "pilot" }),
    },
    {
      name: "executionStatus",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({ ...plan, executionStatus: "measured" as never }),
    },
    {
      name: "profile and claimStatus",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({ ...plan, profile: "smoke", claimStatus: "calibration" }),
    },
    {
      name: "nested runSpec census",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({
          ...plan,
          runSpec: Object.freeze({
            ...plan.runSpec!,
            caseCensus: Object.freeze({ prompts: 9 }),
          }),
        }),
    },
    {
      name: "noncanonical evidenceRoot",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({ ...plan, evidenceRoot: `${plan.evidenceRoot}/../evidence` }),
    },
    {
      name: "noncanonical cacheRoot",
      mutate: (plan: RunPlan): RunPlan =>
        Object.freeze({ ...plan, cacheRoot: `${plan.cacheRoot}/../cache` }),
    },
  ] as const;

  const observations: Array<{
    readonly name: string;
    readonly executionStatus: string;
    readonly failureOwner: string | undefined;
    readonly candidateCalls: number;
    readonly reason: string;
  }> = [];
  for (const attack of attacks) {
    const fixture = planFixture();
    let candidateCalls = 0;
    let cleanupCalls = 0;
    try {
      const result = await executeImmutableRun({
        plan: attack.mutate(fixture.plan),
        manifest: fixture.manifest,
        candidate: createFixtureCandidateTransport(
          () => {
            candidateCalls += 1;
            return "fixture response";
          },
          { evidenceRoot: fixture.plan.evidenceRoot },
        ),
        judge: undefined,
        hostCleanup: async () => {
          cleanupCalls += 1;
          return "complete";
        },
      });

      observations.push({
        name: attack.name,
        executionStatus: result.trackReport.executionStatus,
        failureOwner: result.publicReceipt.failureOwner,
        candidateCalls,
        reason: privateFailureReason(result),
      });
      assert.equal(cleanupCalls, 1, `${attack.name} cleanup`);
      assert.match(
        result.plan.id,
        /^run-[0-9a-f]{64}$/u,
        `${attack.name} canonical id`,
      );
      if (attack.name === "id") {
        assert.equal(result.plan.id, fixture.plan.id);
      }
      assert.equal(
        existsSync(join(fixture.root, "forged-outside-evidence")),
        false,
        `${attack.name} must not write through a forged id`,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  assert.deepEqual(
    observations.map(({ reason: _reason, ...observation }) => observation),
    attacks.map((attack) => ({
      name: attack.name,
      executionStatus: "invalid",
      failureOwner: "verifier",
      candidateCalls: 0,
    })),
  );
  for (const observation of observations) {
    assert.match(observation.reason, /run plan/u, `${observation.name} reason`);
  }
});
