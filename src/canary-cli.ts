import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { HARBOR_VERSION } from "./harbor.ts";
import { parseHarborTrialResult } from "./harbor.ts";
import {
  createBenchmarkExecutionReceipt,
  validateIFEvalResultArtifact,
  validateIFEvalTraceEvidence,
} from "./benchmark-smoke.ts";
import { createTrialIdentity, stableDigest } from "./identity.ts";
import {
  createProtocolCanaryReceipt,
  formatProtocolCanaryReport,
  validateCodexTraceEvidence,
  validatePluginInstallEvidence,
  validateProtocolCanaryArtifact,
} from "./protocol-canary.ts";
import type { TrialSpec } from "./types.ts";

const CODEX_VERSION = "0.147.0";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canaryJobDirectory = join(
  repository,
  "artifacts",
  "harbor",
  "coffee-chat-protocol-canary-codex",
);
const benchmarkJobDirectory = join(
  repository,
  "artifacts",
  "harbor",
  "coffee-chat-ifeval-smoke-codex",
);

export interface CodexCanaryOptions {
  readonly command: "codex";
  readonly candidateRepo: string;
  readonly candidateCommit: string;
  readonly model: string;
}

export interface BenchmarkSmokeOptions {
  readonly command: "benchmark";
  readonly candidateRepo: string;
  readonly candidateCommit: string;
  readonly model: string;
}

export interface ProtocolCalibrationOptions {
  readonly command: "calibrate";
}

export interface BenchmarkCalibrationOptions {
  readonly command: "benchmark-calibrate";
}

export type CanaryCliOptions =
  | CodexCanaryOptions
  | BenchmarkSmokeOptions
  | ProtocolCalibrationOptions
  | BenchmarkCalibrationOptions;

function flagValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  const value = index === -1 ? undefined : args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseCanaryCliArgs(args: readonly string[]): CanaryCliOptions {
  if (args[0] === "calibrate" || args[0] === "benchmark-calibrate") {
    return Object.freeze({ command: args[0] });
  }
  if (args[0] !== "codex" && args[0] !== "benchmark") {
    throw new Error(
      "usage: canary-cli (calibrate|benchmark-calibrate) | (codex|benchmark) --candidate-repo PATH --candidate-commit COMMIT --model MODEL",
    );
  }
  const candidateCommit = flagValue(args, "--candidate-commit");
  if (!COMMIT_PATTERN.test(candidateCommit)) {
    throw new Error("--candidate-commit must be a full lowercase Git commit");
  }

  return Object.freeze({
    command: args[0],
    candidateRepo: resolve(flagValue(args, "--candidate-repo")),
    candidateCommit,
    model: flagValue(args, "--model"),
  });
}

function buildRealCodexHarborArgs(
  options: CodexCanaryOptions | BenchmarkSmokeOptions,
  stagedCandidate: string,
  taskPath: string,
  jobName: string,
): readonly string[] {
  return [
    "--from",
    `harbor==${HARBOR_VERSION}`,
    "harbor",
    "run",
    "--path",
    taskPath,
    "--agent",
    "integrations.harbor.coffee_chat_codex:CoffeeChatCodex",
    "--agent-kwarg",
    `candidate_path=${stagedCandidate}`,
    "--agent-kwarg",
    `candidate_commit=${options.candidateCommit}`,
    "--agent-kwarg",
    `version=${CODEX_VERSION}`,
    "--model",
    options.model,
    "--env",
    "docker",
    "--job-name",
    jobName,
    "--jobs-dir",
    "artifacts/harbor",
    "--n-concurrent",
    "1",
    "--yes",
    "--quiet",
  ];
}

export function buildCodexHarborArgs(
  options: CodexCanaryOptions,
  stagedCandidate: string,
): readonly string[] {
  return buildRealCodexHarborArgs(
    options,
    stagedCandidate,
    "evals/protocol-canary",
    "coffee-chat-protocol-canary-codex",
  );
}

export function buildBenchmarkHarborArgs(
  options: BenchmarkSmokeOptions,
  stagedCandidate: string,
): readonly string[] {
  return buildRealCodexHarborArgs(
    options,
    stagedCandidate,
    "evals/ifeval-smoke",
    "coffee-chat-ifeval-smoke-codex",
  );
}

function stageCandidate(options: CodexCanaryOptions | BenchmarkSmokeOptions): string {
  const verified = execFileSync(
    "git",
    [
      "-C",
      options.candidateRepo,
      "rev-parse",
      "--verify",
      `${options.candidateCommit}^{commit}`,
    ],
    { encoding: "utf8" },
  ).trim();
  if (verified !== options.candidateCommit) {
    throw new Error("candidate repository did not resolve the exact requested commit");
  }

  const staging = mkdtempSync(join(tmpdir(), "coffee-chat-canary-"));
  const plugin = join(staging, "plugin");
  const archive = join(staging, "plugin.tar");
  mkdirSync(plugin);
  execFileSync(
    "git",
    [
      "-C",
      options.candidateRepo,
      "archive",
      "--format=tar",
      "--output",
      archive,
      options.candidateCommit,
    ],
    { stdio: "inherit" },
  );
  execFileSync("tar", ["-xf", archive, "-C", plugin], { stdio: "inherit" });
  rmSync(archive);
  writeFileSync(
    join(staging, "candidate-commit.txt"),
    `${options.candidateCommit}\n`,
    "utf8",
  );
  return staging;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function directoryDigest(root: string): `sha256:${string}` {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);

  const hash = createHash("sha256");
  for (const path of files.sort()) {
    hash.update(path.slice(root.length + 1));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function fileDigest(path: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function collectHostEvidence(trialDir: string, taskDirectory: string) {
  const harborLock = join(trialDir, "lock.json");
  return Object.freeze({
    harborLockPath: harborLock.slice(repository.length + 1),
    harborLockDigest: fileDigest(harborLock),
    taskImageDefinitionDigest: fileDigest(
      join(taskDirectory, "environment", "Dockerfile"),
    ),
    verifierImageDefinitionDigest: fileDigest(
      join(taskDirectory, "tests", "Dockerfile"),
    ),
  });
}

function evaluatorCommitFromCleanTree(): string {
  const trackedChanges = execFileSync(
    "git",
    ["-C", repository, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" },
  ).trim();
  if (trackedChanges) {
    throw new Error(
      "refusing to issue an exact evaluator receipt from a dirty working tree",
    );
  }
  return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

function validateRecordedCandidate(agentDir: string, expectedCommit: string): void {
  const recordedCandidate = readFileSync(
    join(agentDir, "candidate-commit.txt"),
    "utf8",
  ).trim();
  if (recordedCandidate !== expectedCommit) {
    throw new Error("native trial candidate commit differs from requested commit");
  }
}

function validateCleanup(containerName: string): void {
  const remainingContainers = execFileSync(
    "docker",
    ["ps", "--all", "--filter", `name=${containerName}`, "--quiet"],
    { encoding: "utf8" },
  ).trim();
  if (remainingContainers) {
    throw new Error(`Harbor ${containerName} container cleanup is incomplete`);
  }
}

function requireFreshJobDirectory(path: string): void {
  if (existsSync(path)) {
    throw new Error(`refusing to reuse existing Harbor job directory: ${path}`);
  }
}

function validateNativeCodexIdentity(
  result: ReturnType<typeof parseHarborTrialResult>,
  expected: {
    readonly task: string;
    readonly model: string;
    readonly candidateCommit: string;
  },
): void {
  if (
    result.resultState !== "unmeasured" ||
    result.nativeTaskName !== expected.task ||
    result.nativeAgentName !== "codex" ||
    result.nativeAgentVersion !== CODEX_VERSION ||
    result.nativeModelName !== expected.model ||
    result.nativeCandidateCommit !== expected.candidateCommit
  ) {
    throw new Error("native Harbor Codex identity differs from the requested trial");
  }
}

function singleTrialDirectory(jobDir: string): string {
  const trials = readdirSync(jobDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(jobDir, entry.name, "result.json")),
    )
    .map((entry) => join(jobDir, entry.name));
  if (trials.length !== 1) {
    throw new Error("Codex canary job must contain exactly one native Harbor trial");
  }
  const trial = trials[0];
  if (trial === undefined || !statSync(trial).isDirectory()) {
    throw new Error("Codex canary native trial directory is unavailable");
  }
  return trial;
}

function finalizeCodexCanary(options: CodexCanaryOptions): void {
  const evaluatorCommit = evaluatorCommitFromCleanTree();

  const trialDir = singleTrialDirectory(canaryJobDirectory);
  const agentDir = join(trialDir, "agent");
  const harborResultPath = join(trialDir, "result.json");
  const codexTracePath = join(agentDir, "trajectory.json");
  const harborResult = parseHarborTrialResult(readJson(harborResultPath));
  if (harborResult.resultState !== "unmeasured") {
    throw new Error("native Harbor Codex trial did not complete successfully");
  }
  validateNativeCodexIdentity(harborResult, {
    task: "openboa-ai/protocol-canary",
    model: options.model,
    candidateCommit: options.candidateCommit,
  });

  const plugin = validatePluginInstallEvidence({
    available: readJson(join(agentDir, "plugin-available.json")),
    installation: readJson(join(agentDir, "plugin-install.json")),
    installed: readJson(join(agentDir, "plugin-installed.json")),
    sourceDigest: readFileSync(
      join(agentDir, "plugin-source-digest.txt"),
      "utf8",
    ).trim(),
    installedDigest: readFileSync(
      join(agentDir, "plugin-installed-digest.txt"),
      "utf8",
    ).trim(),
  });
  const trace = validateCodexTraceEvidence(readJson(codexTracePath));
  const artifact = validateProtocolCanaryArtifact(
    readJson(join(trialDir, "artifacts", "app", "protocol-canary.json")),
  );
  validateRecordedCandidate(agentDir, options.candidateCommit);
  validateCleanup("protocol-canary__");
  const taskDigest = directoryDigest(join(repository, "evals", "protocol-canary"));
  const hostEvidence = collectHostEvidence(
    trialDir,
    join(repository, "evals", "protocol-canary"),
  );
  const isolationReference = `artifact://${hostEvidence.harborLockPath}#${hostEvidence.harborLockDigest}`;
  const trial: TrialSpec = {
    evaluator: {
      repository: "https://github.com/openboa-ai/coffee-chat-eval",
      commit: evaluatorCommit,
      calver: "2026.8.12",
      configurationDigest: stableDigest({
        harbor: HARBOR_VERSION,
        codex: CODEX_VERSION,
        adapter: "CoffeeChatCodex",
      }),
    },
    candidate: {
      repository: "https://github.com/openboa-ai/coffee-chat",
      commit: options.candidateCommit,
      calver: plugin.version,
      adapter: "codex-plugin-marketplace",
    },
    task: { id: "protocol-canary", digest: taskDigest },
    harness: {
      id: `harbor-${HARBOR_VERSION}-codex-${CODEX_VERSION}`,
      digest: stableDigest({
        backend: "harbor",
        adapter: "CoffeeChatCodex",
      }),
    },
    model: {
      id: options.model,
      digest: stableDigest({ provider: "openai", model: options.model }),
    },
    host: {
      id: "harbor-docker",
      isolationClass: "real",
      configurationDigest: stableDigest({
        environment: "docker",
        delete: true,
        verifier: "separate",
      }),
      isolationReference,
    },
    repetition: 0,
  };

  const receipt = createProtocolCanaryReceipt({
    trialId: createTrialIdentity(trial),
    evaluatorCommit,
    candidateCommit: options.candidateCommit,
    taskDigest,
    plugin,
    trace,
    artifact,
    model: options.model,
    harborResult,
    harborResultPath: harborResultPath.slice(repository.length + 1),
    codexTracePath: codexTracePath.slice(repository.length + 1),
    isolationReference: trial.host.isolationReference,
    hostEvidence,
    cleanup: "verified",
  });
  writeFileSync(
    join(canaryJobDirectory, "coffee-chat-receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    join(canaryJobDirectory, "coffee-chat-report.md"),
    `${formatProtocolCanaryReport(receipt)}\n`,
    "utf8",
  );
  console.log(
    "Validated unmeasured receipt:",
    join(canaryJobDirectory, "coffee-chat-receipt.json"),
  );
}

function finalizeBenchmarkSmoke(options: BenchmarkSmokeOptions): void {
  const evaluatorCommit = evaluatorCommitFromCleanTree();
  const trialDir = singleTrialDirectory(benchmarkJobDirectory);
  const agentDir = join(trialDir, "agent");
  const harborResultPath = join(trialDir, "result.json");
  const codexTracePath = join(agentDir, "trajectory.json");
  const harborResult = parseHarborTrialResult(readJson(harborResultPath));
  if (harborResult.resultState !== "unmeasured") {
    throw new Error("native Harbor benchmark smoke trial did not execute");
  }
  validateNativeCodexIdentity(harborResult, {
    task: "openboa-ai/ifeval-smoke",
    model: options.model,
    candidateCommit: options.candidateCommit,
  });

  const plugin = validatePluginInstallEvidence({
    available: readJson(join(agentDir, "plugin-available.json")),
    installation: readJson(join(agentDir, "plugin-install.json")),
    installed: readJson(join(agentDir, "plugin-installed.json")),
    sourceDigest: readFileSync(
      join(agentDir, "plugin-source-digest.txt"),
      "utf8",
    ).trim(),
    installedDigest: readFileSync(
      join(agentDir, "plugin-installed-digest.txt"),
      "utf8",
    ).trim(),
  });
  const traceEvidence = validateIFEvalTraceEvidence(readJson(codexTracePath));
  const artifactEvidence = validateIFEvalResultArtifact(
    readJson(join(trialDir, "artifacts", "app", "ifeval-result.json")),
  );
  validateRecordedCandidate(agentDir, options.candidateCommit);
  validateCleanup("ifeval-smoke__");

  const receipt = createBenchmarkExecutionReceipt({
    evaluatorCommit,
    candidateCommit: options.candidateCommit,
    pluginVersion: plugin.version,
    installedPluginDigest: plugin.digest,
    model: options.model,
    harborResult,
    traceEvidence,
    artifactEvidence,
    sourceManifestDigest: fileDigest(
      join(repository, "evals", "ifeval-smoke", "source.json"),
    ),
    harborResultPath: harborResultPath.slice(repository.length + 1),
    codexTracePath: codexTracePath.slice(repository.length + 1),
    hostEvidence: collectHostEvidence(
      trialDir,
      join(repository, "evals", "ifeval-smoke"),
    ),
    cleanup: "verified",
  });
  const receiptPath = join(benchmarkJobDirectory, "benchmark-execution-receipt.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log("Validated benchmark execution receipt:", receiptPath);
}

export function runCodexCanary(options: CodexCanaryOptions): void {
  requireFreshJobDirectory(canaryJobDirectory);
  const staging = stageCandidate(options);
  try {
    execFileSync(process.env.UVX_BIN ?? "uvx", buildCodexHarborArgs(options, staging), {
      cwd: repository,
      env: {
        ...process.env,
        CODEX_FORCE_AUTH_JSON: "1",
        PYTHONPATH: [repository, process.env.PYTHONPATH]
          .filter((value): value is string => Boolean(value))
          .join(":"),
      },
      stdio: "inherit",
    });
    finalizeCodexCanary(options);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function runBenchmarkSmoke(options: BenchmarkSmokeOptions): void {
  requireFreshJobDirectory(benchmarkJobDirectory);
  const staging = stageCandidate(options);
  try {
    execFileSync(
      process.env.UVX_BIN ?? "uvx",
      buildBenchmarkHarborArgs(options, staging),
      {
        cwd: repository,
        env: {
          ...process.env,
          CODEX_FORCE_AUTH_JSON: "1",
          PYTHONPATH: [repository, process.env.PYTHONPATH]
            .filter((value): value is string => Boolean(value))
            .join(":"),
        },
        stdio: "inherit",
      },
    );
    finalizeBenchmarkSmoke(options);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function runCalibration(): void {
  for (const [agent, expectedReward] of [
    ["oracle", 1],
    ["nop", 0],
  ] as const) {
    const jobName = `coffee-chat-protocol-canary-${agent}`;
    requireFreshJobDirectory(join(repository, "artifacts", "harbor", jobName));
    execFileSync(
      process.env.UVX_BIN ?? "uvx",
      [
        "--from",
        `harbor==${HARBOR_VERSION}`,
        "harbor",
        "run",
        "--path",
        "evals/protocol-canary",
        "--agent",
        agent,
        "--env",
        "docker",
        "--job-name",
        jobName,
        "--jobs-dir",
        "artifacts/harbor",
        "--n-concurrent",
        "1",
        "--yes",
        "--quiet",
      ],
      { cwd: repository, env: process.env, stdio: "inherit" },
    );
    const result = parseHarborTrialResult(
      readJson(
        join(
          singleTrialDirectory(join(repository, "artifacts", "harbor", jobName)),
          "result.json",
        ),
      ),
    );
    if (result.resultState !== "unmeasured" || result.nativeReward !== expectedReward) {
      throw new Error(`Harbor ${agent} calibration expected reward ${expectedReward}`);
    }
  }
}

export function runBenchmarkCalibration(): void {
  for (const [agent, expectedReward] of [
    ["oracle", 1],
    ["nop", 0],
  ] as const) {
    const jobName = `coffee-chat-ifeval-smoke-${agent}`;
    const directory = join(repository, "artifacts", "harbor", jobName);
    requireFreshJobDirectory(directory);
    execFileSync(
      process.env.UVX_BIN ?? "uvx",
      [
        "--from",
        `harbor==${HARBOR_VERSION}`,
        "harbor",
        "run",
        "--path",
        "evals/ifeval-smoke",
        "--agent",
        agent,
        "--env",
        "docker",
        "--job-name",
        jobName,
        "--jobs-dir",
        "artifacts/harbor",
        "--n-concurrent",
        "1",
        "--yes",
        "--quiet",
      ],
      { cwd: repository, env: process.env, stdio: "inherit" },
    );
    const result = parseHarborTrialResult(
      readJson(join(singleTrialDirectory(directory), "result.json")),
    );
    if (
      result.resultState !== "unmeasured" ||
      result.nativeTaskName !== "openboa-ai/ifeval-smoke" ||
      result.nativeAgentName !== agent ||
      result.nativeReward !== expectedReward
    ) {
      throw new Error(`Harbor IFEval ${agent} expected reward ${expectedReward}`);
    }
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = parseCanaryCliArgs(process.argv.slice(2));
    if (options.command === "calibrate") runCalibration();
    else if (options.command === "benchmark-calibrate") runBenchmarkCalibration();
    else if (options.command === "codex") runCodexCanary(options);
    else runBenchmarkSmoke(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
