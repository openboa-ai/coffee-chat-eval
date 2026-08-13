import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { HARBOR_VERSION, parseHarborTrialResult } from "./harbor.ts";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface ProtocolCalibrationOptions {
  readonly command: "calibrate";
}

export interface BenchmarkCalibrationOptions {
  readonly command: "benchmark-calibrate";
}

export type CanaryCliOptions = ProtocolCalibrationOptions | BenchmarkCalibrationOptions;

export function parseCanaryCliArgs(args: readonly string[]): CanaryCliOptions {
  if (
    args.length === 1 &&
    (args[0] === "calibrate" || args[0] === "benchmark-calibrate")
  ) {
    return Object.freeze({ command: args[0] });
  }
  throw new Error("usage: canary-cli (calibrate|benchmark-calibrate)");
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function singleTrialDirectory(jobDir: string): string {
  const trials = readdirSync(jobDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(join(jobDir, entry.name, "result.json")),
    )
    .map((entry) => join(jobDir, entry.name));
  if (trials.length !== 1 || trials[0] === undefined) {
    throw new Error("calibration job must contain exactly one Harbor trial");
  }
  return trials[0];
}

function requireFreshJobDirectory(path: string): void {
  if (existsSync(path)) {
    throw new Error(`refusing to reuse existing Harbor job directory: ${path}`);
  }
}

function runCalibrationPair(options: {
  readonly taskPath: string;
  readonly taskName: string;
  readonly jobPrefix: string;
}): void {
  for (const [agent, expectedReward] of [
    ["oracle", 1],
    ["nop", 0],
  ] as const) {
    const jobName = `${options.jobPrefix}-${agent}`;
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
        options.taskPath,
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
      result.nativeTaskName !== options.taskName ||
      result.nativeAgentName !== agent ||
      result.nativeReward !== expectedReward
    ) {
      throw new Error(
        `Harbor ${options.taskName} ${agent} expected reward ${expectedReward}`,
      );
    }
  }
}

export function runCalibration(): void {
  runCalibrationPair({
    taskPath: "evals/protocol-canary",
    taskName: "openboa-ai/protocol-canary",
    jobPrefix: "coffee-chat-protocol-canary",
  });
}

export function runBenchmarkCalibration(): void {
  runCalibrationPair({
    taskPath: "evals/ifeval-smoke",
    taskName: "openboa-ai/ifeval-smoke",
    jobPrefix: "coffee-chat-ifeval-smoke",
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const options = parseCanaryCliArgs(process.argv.slice(2));
    if (options.command === "calibrate") runCalibration();
    else runBenchmarkCalibration();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
