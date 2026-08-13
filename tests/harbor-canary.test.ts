import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createHarborJobConfig, parseHarborTrialResult } from "../src/harbor.ts";
import { createCalibrationEnvironment, parseCanaryCliArgs } from "../src/canary-cli.ts";
import {
  createProtocolCanaryReceipt,
  formatProtocolCanaryReport,
  validateCodexTraceEvidence,
  validatePluginInstallEvidence,
  validateProtocolCanaryArtifact,
} from "../src/protocol-canary.ts";
import {
  createBenchmarkExecutionReceipt,
  validateIFEvalTraceEvidence,
  validateIFEvalResultArtifact,
} from "../src/benchmark-smoke.ts";

const repository = new URL("..", import.meta.url);
const candidateCommit = "8505c34785f06e99886ffc2dfdae3a98248248b6";

function nativeResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "11111111-1111-7111-8111-111111111111",
    task_name: "openboa-ai/protocol-canary",
    trial_name: "protocol-canary__oracle__1",
    trial_uri: "file:///jobs/protocol-canary/trials/oracle",
    task_checksum: "canary-checksum",
    agent_info: { name: "oracle", version: "1.0.0" },
    config: { environment: { type: "docker", delete: true }, agent: {} },
    verifier_environment_mode: "separate",
    verifier_result: { rewards: { reward: 1 } },
    started_at: "2026-08-12T00:00:00Z",
    finished_at: "2026-08-12T00:00:01Z",
    environment_setup: {
      started_at: "2026-08-12T00:00:00Z",
      finished_at: "2026-08-12T00:00:00Z",
    },
    agent_execution: {
      started_at: "2026-08-12T00:00:00Z",
      finished_at: "2026-08-12T00:00:00Z",
    },
    verifier: {
      started_at: "2026-08-12T00:00:00Z",
      finished_at: "2026-08-12T00:00:01Z",
    },
    ...overrides,
  };
}

function ifevalTrace(readObservation: unknown): unknown {
  return {
    steps: [
      {
        source: "system",
        message:
          "coffee-chat:coffee-chat (file: /tmp/codex-home/plugins/cache/openboa-ai/coffee-chat/2026.8.10/skills/coffee-chat/SKILL.md)",
      },
      {
        source: "agent",
        tool_calls: [
          {
            function_name: "exec",
            arguments: {
              input:
                'const r = await tools.exec_command({"cmd":"cat /app/ifeval-case.json","workdir":"/app"});',
            },
          },
        ],
        observation: readObservation,
      },
      {
        source: "agent",
        tool_calls: [
          {
            function_name: "exec",
            arguments: {
              input:
                'const r = await tools.exec_command({"cmd":"node scripts/run.mjs","workdir":"/tmp/codex-home/plugins/cache/openboa-ai/coffee-chat/2026.8.10/skills/coffee-chat"});',
            },
          },
        ],
        observation: {
          results: [
            {
              content:
                '{"schema":"coffee-chat-capability-result","capability":"coffee-chat","status":"not_implemented"}',
            },
          ],
        },
      },
    ],
  };
}

test("projects one pinned Harbor job without inventing other harnesses", () => {
  assert.deepEqual(
    createHarborJobConfig({
      agent: "oracle",
      candidateCommit,
      jobsDir: "artifacts/harbor",
    }),
    {
      job_name: "coffee-chat-protocol-canary-oracle",
      jobs_dir: "artifacts/harbor",
      n_attempts: 1,
      n_concurrent_trials: 1,
      environment: { type: "docker", delete: true },
      verifier: { disable: false },
      agents: [
        {
          name: "oracle",
          env: {
            COFFEE_CHAT_CANDIDATE_REPOSITORY:
              "https://github.com/openboa-ai/coffee-chat",
            COFFEE_CHAT_CANDIDATE_COMMIT: candidateCommit,
          },
        },
      ],
      tasks: [{ path: "evals/protocol-canary" }],
      artifacts: ["/app/protocol-canary.json"],
    },
  );
});

test("calibration is an explicit non-model command", () => {
  assert.deepEqual(parseCanaryCliArgs(["calibrate"]), {
    command: "calibrate",
  });
  assert.deepEqual(parseCanaryCliArgs(["benchmark-calibrate"]), {
    command: "benchmark-calibrate",
  });
});

test("calibration rejects credentials and passes only an allowlisted child environment", () => {
  assert.throws(
    () =>
      createCalibrationEnvironment({
        OPENAI_API_KEY: "must-not-enter-harbor",
        PATH: "/usr/bin",
      }),
    /credential_environment_not_allowed:OPENAI_API_KEY/u,
  );
  assert.deepEqual(
    createCalibrationEnvironment({
      ACTIONS_RUNTIME_TOKEN: "must-not-enter-harbor",
      CODEX_CI: "1",
      HOME: "/tmp/home",
      LANG: "C.UTF-8",
      PATH: "/usr/bin",
      SSH_AUTH_SOCK: "/tmp/agent.sock",
      TMPDIR: "/tmp",
    }),
    {
      HOME: "/tmp/home",
      LANG: "C.UTF-8",
      PATH: "/usr/bin",
      TMPDIR: "/tmp",
    },
  );
});

test("keeps IFEval constraints sealed from the candidate task image", () => {
  const instruction = readFileSync(
    new URL("../evals/ifeval-smoke/instruction.md", import.meta.url),
    "utf8",
  );
  const environment = readFileSync(
    new URL("../evals/ifeval-smoke/environment/Dockerfile", import.meta.url),
    "utf8",
  );
  const visibleCase = readFileSync(
    new URL("../evals/ifeval-smoke/environment/case.json", import.meta.url),
    "utf8",
  );
  const sealedReference = readFileSync(
    new URL("../evals/ifeval-smoke/tests/reference.json", import.meta.url),
    "utf8",
  );

  assert.match(instruction, /\/app\/ifeval-case\.json/u);
  assert.match(environment, /COPY case\.json \/app\/ifeval-case\.json/u);
  assert.match(visibleCase, /"key": 1001/u);
  assert.doesNotMatch(visibleCase, /instruction_id_list|punctuation:no_comma/u);
  assert.match(sealedReference, /punctuation:no_comma/u);
});

test("records benchmark execution without converting it into a performance score", () => {
  const traceEvidence = validateIFEvalTraceEvidence(
    ifevalTrace({
      results: [
        {
          content:
            '{"benchmark":"IFEval","key":1001,"prompt":"I am planning a trip to Japan, and I would like thee to write an itinerary for my journey in a Shakespearean style. You are not allowed to use any commas in your response.","source_digest":"sha256:d5ef5259a025140861c13b78b2be73479893b29d3cd1ed12cfda9446427d0396"}',
        },
      ],
    }),
  );
  const receiptInput = {
    evaluatorCommit: "c0d1323c0679d41584b6db30dd793ab3872ad68d",
    candidateCommit,
    pluginVersion: "2026.8.10",
    installedPluginDigest:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    model: "gpt-5.6-sol",
    harborResult: parseHarborTrialResult(
      nativeResult({
        task_name: "openboa-ai/ifeval-smoke",
        trial_name: "ifeval-smoke__codex__1",
        agent_info: { name: "codex", version: "0.147.0" },
        verifier_result: { rewards: { reward: 0 } },
      }),
    ),
    traceEvidence,
    artifactEvidence: validateIFEvalResultArtifact({
      benchmark: "IFEval",
      key: 1001,
      source_digest:
        "sha256:d5ef5259a025140861c13b78b2be73479893b29d3cd1ed12cfda9446427d0396",
      status: "not_implemented",
      response: "",
    }),
    sourceManifestDigest:
      "sha256:b7a02386bc8304e3338030fe4f4d97fb19a6ff1948f57d833482a199c2dab741",
    harborResultPath: "artifacts/harbor/job/trial/result.json",
    codexTracePath: "artifacts/harbor/job/trial/agent/trajectory.json",
    hostEvidence: {
      harborLockPath: "artifacts/harbor/job/trial/lock.json",
      harborLockDigest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      taskImageDefinitionDigest:
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      verifierImageDefinitionDigest:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
    cleanup: "verified",
  } as const;
  const receipt = createBenchmarkExecutionReceipt(receiptInput);

  assert.equal(receipt.executionStatus, "executed");
  assert.equal(receipt.resultState, "not_implemented");
  assert.equal(receipt.measurement, "not_performed");
  assert.equal(receipt.benchmarkInputRead, "verified");
  assert.equal(receipt.candidateInputDelivery, "not_supported");
  assert.equal(receipt.nativeHarborReward, 0);
  assert.equal(receipt.benchmark.name, "IFEval");
  assert.equal("score" in receipt, false);
  assert.throws(
    () =>
      createBenchmarkExecutionReceipt({
        ...receiptInput,
        sourceManifestDigest:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      }),
    /source manifest digest/u,
  );
  assert.throws(
    () =>
      validateIFEvalResultArtifact({
        benchmark: "IFEval",
        key: 1001,
        source_digest:
          "sha256:d5ef5259a025140861c13b78b2be73479893b29d3cd1ed12cfda9446427d0396",
        status: "not_implemented",
        response: "",
        malformed: true,
      }),
    /artifact is invalid/u,
  );
});

test("rejects an attempted IFEval read without successful pinned case evidence", () => {
  assert.throws(
    () =>
      validateIFEvalTraceEvidence(
        ifevalTrace({
          results: [
            {
              content:
                "Script failed\nOutput:\ncat: /app/ifeval-case.json: No such file",
            },
          ],
        }),
      ),
    /input evidence/u,
  );
});

test("preserves successful and failed calibration rewards as unmeasured evidence", () => {
  const oracle = parseHarborTrialResult(nativeResult());
  const nop = parseHarborTrialResult(
    nativeResult({
      trial_name: "protocol-canary__nop__1",
      agent_info: { name: "nop", version: "1.0.0" },
      verifier_result: { rewards: { reward: 0 } },
    }),
  );

  assert.ok(oracle.resultState === "unmeasured");
  assert.ok(nop.resultState === "unmeasured");
  assert.deepEqual(
    [oracle.resultState, oracle.nativeReward, nop.resultState, nop.nativeReward],
    ["unmeasured", 1, "unmeasured", 0],
  );
});

test("does not collapse host, candidate, verifier, and invalid artifacts", () => {
  const occurred_at = "2026-08-12T00:00:01Z";
  const exception = (exception_type: string) => ({
    exception_type,
    exception_message: "controlled failure",
    exception_traceback: "omitted",
    occurred_at,
  });

  const host = parseHarborTrialResult(
    nativeResult({
      verifier_result: null,
      agent_execution: null,
      verifier: null,
      exception_info: exception("EnvironmentStartError"),
    }),
  );
  const candidate = parseHarborTrialResult(
    nativeResult({
      verifier_result: null,
      verifier: null,
      exception_info: exception("NonZeroAgentExitCodeError"),
    }),
  );
  const verifier = parseHarborTrialResult(
    nativeResult({
      verifier_result: null,
      exception_info: exception("RewardFileParseError"),
    }),
  );
  assert.ok(host.resultState === "invalid");
  assert.ok(candidate.resultState === "invalid");
  assert.ok(verifier.resultState === "invalid");
  assert.equal(host.failureClass, "host");
  assert.equal(candidate.failureClass, "candidate");
  assert.equal(verifier.failureClass, "verifier");
  assert.deepEqual(
    parseHarborTrialResult(
      nativeResult({ verifier_result: { rewards: { reward: "one" } } }),
    ),
    {
      resultState: "invalid",
      failureClass: "artifact",
      reason: "Harbor verifier reward must be a finite number",
    },
  );
});

test("receipt and report retain conformance evidence but make no performance claim", () => {
  const receipt = createProtocolCanaryReceipt({
    trialId: "trial-abc",
    evaluatorCommit: "c0d1323c0679d41584b6db30dd793ab3872ad68d",
    candidateCommit,
    taskDigest:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    plugin: {
      pluginId: "coffee-chat@openboa-ai",
      version: "2026.8.10",
      installedPath: "/tmp/codex-home/plugins/cache/openboa-ai/coffee-chat/2026.8.10",
      digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
    trace: {
      pluginSkillDiscovery: "verified",
      publicEntrypointInvocation: "verified",
      capabilityStatus: "not_implemented",
    },
    artifact: validateProtocolCanaryArtifact({
      protocol: "coffee-chat-plugin",
      entrypoint: "coffee-chat",
      status: "invoked",
    }),
    model: "gpt-5.6-sol",
    harborResult: parseHarborTrialResult(nativeResult()),
    harborResultPath: "artifacts/harbor/job/trial/result.json",
    codexTracePath: "artifacts/harbor/job/trial/agent/trajectory.json",
    isolationReference: "docker://protocol-canary",
    hostEvidence: {
      harborLockPath: "artifacts/harbor/job/trial/lock.json",
      harborLockDigest:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      taskImageDefinitionDigest:
        "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      verifierImageDefinitionDigest:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
    cleanup: "verified",
  });
  const report = formatProtocolCanaryReport(receipt);

  assert.equal(receipt.resultState, "unmeasured");
  assert.equal(receipt.execution.model, "gpt-5.6-sol");
  assert.equal(receipt.evidence.nativeReward, 1);
  assert.match(report, /Result: unmeasured/u);
  assert.match(report, /Native Harbor reward: 1/u);
  assert.match(report, /No Coffee Chat performance claim is produced/u);
  assert.doesNotMatch(report, /performance score\s*[:=]\s*1/iu);
});

test("requires trace evidence for fresh discovery and public entrypoint execution", () => {
  const trace = {
    steps: [
      {
        source: "system",
        message:
          "coffee-chat:coffee-chat (file: /tmp/codex-home/plugins/cache/openboa-ai/coffee-chat/2026.8.10/skills/coffee-chat/SKILL.md)",
      },
      {
        source: "agent",
        tool_calls: [
          {
            function_name: "exec",
            arguments: {
              input:
                'const r = await tools.exec_command({"cmd":"node scripts/run.mjs","workdir":"/tmp/codex-home/plugins/cache/openboa-ai/coffee-chat/2026.8.10/skills/coffee-chat"});',
            },
          },
        ],
        observation: {
          results: [
            {
              content:
                '{"schema":"coffee-chat-capability-result","capability":"coffee-chat","status":"not_implemented"}',
            },
          ],
        },
      },
    ],
  };

  assert.deepEqual(validateCodexTraceEvidence(trace), {
    pluginSkillDiscovery: "verified",
    publicEntrypointInvocation: "verified",
    capabilityStatus: "not_implemented",
  });
  assert.throws(
    () => validateCodexTraceEvidence({ steps: trace.steps.slice(0, 1) }),
    /entrypoint invocation/u,
  );
  const falseInvocation = structuredClone(trace);
  falseInvocation.steps[1]!.tool_calls![0]!.arguments.input =
    'const r = await tools.exec_command({"cmd":"printf node scripts/run.mjs","workdir":"/tmp/codex-home/plugins/cache/openboa-ai/coffee-chat/2026.8.10/skills/coffee-chat"});';
  falseInvocation.steps[1]!.observation = {
    results: [
      {
        content: "prefix coffee-chat-capability-result suffix not_implemented",
      },
    ],
  };
  assert.throws(
    () => validateCodexTraceEvidence(falseInvocation),
    /entrypoint invocation/u,
  );
});

test("rejects oversized trajectory evidence before traversal", () => {
  assert.throws(
    () =>
      validateCodexTraceEvidence({
        steps: [{ source: "system", message: "x".repeat(2 * 1024 * 1024 + 1) }],
      }),
    /resource limit/u,
  );
});

test("rejects substring-only IFEval read evidence", () => {
  const trace = ifevalTrace({
    results: [
      {
        content: `prefix {"benchmark":"IFEval","key":1001,"source_digest":"sha256:d5ef5259a025140861c13b78b2be73479893b29d3cd1ed12cfda9446427d0396"} suffix`,
      },
    ],
  }) as {
    steps: Array<{
      tool_calls?: Array<{ arguments: { input: string } }>;
    }>;
  };
  trace.steps[1]!.tool_calls![0]!.arguments.input =
    'const r = await tools.exec_command({"cmd":"printf cat /app/ifeval-case.json","workdir":"/app"});';
  assert.throws(() => validateIFEvalTraceEvidence(trace), /IFEval input evidence/u);
});

test("accepts only a discovered, installed, enabled Plugin with matching cache digest", () => {
  const digest =
    "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.deepEqual(
    validatePluginInstallEvidence({
      available: {
        installed: [],
        available: [
          {
            pluginId: "coffee-chat@openboa-ai",
            installed: false,
            enabled: false,
            version: "2026.8.10",
          },
        ],
      },
      installation: {
        pluginId: "coffee-chat@openboa-ai",
        installedPath: "/tmp/codex-home/plugins/cache/openboa-ai/coffee-chat/2026.8.10",
      },
      installed: {
        installed: [
          {
            pluginId: "coffee-chat@openboa-ai",
            installed: true,
            enabled: true,
            version: "2026.8.10",
          },
        ],
        available: [],
      },
      sourceDigest: digest,
      installedDigest: digest,
    }),
    {
      pluginId: "coffee-chat@openboa-ai",
      version: "2026.8.10",
      installedPath: "/tmp/codex-home/plugins/cache/openboa-ai/coffee-chat/2026.8.10",
      digest,
    },
  );

  assert.throws(
    () =>
      validatePluginInstallEvidence({
        available: { installed: [], available: [] },
        installation: {},
        installed: { installed: [], available: [] },
        sourceDigest: digest,
        installedDigest:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      }),
    /digest mismatch/u,
  );
});

test("protocol canary keeps candidate-visible instruction separate from sealed judgment", () => {
  const instruction = readFileSync(
    new URL("evals/protocol-canary/instruction.md", repository),
    "utf8",
  );
  const verifier = readFileSync(
    new URL("evals/protocol-canary/tests/test.sh", repository),
    "utf8",
  );
  const verifierLogic = readFileSync(
    new URL("evals/protocol-canary/tests/verify.py", repository),
    "utf8",
  );
  const solution = readFileSync(
    new URL("evals/protocol-canary/solution/solve.sh", repository),
    "utf8",
  );
  const verifierImage = readFileSync(
    new URL("evals/protocol-canary/tests/Dockerfile", repository),
    "utf8",
  );

  assert.match(instruction, /\/app\/protocol-canary\.json/u);
  assert.doesNotMatch(instruction, /reward|solution|expected_digest/iu);
  assert.match(verifier, /\/tests\/verify\.py/u);
  assert.match(verifierLogic, /\/logs\/verifier\/reward\.json/u);
  assert.match(verifierImage, /COPY test\.sh \/tests\/test\.sh/u);
  assert.match(solution, /\/app\/protocol-canary\.json/u);
});
