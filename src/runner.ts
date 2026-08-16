import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { BaselineTask, ProjectionManifest, ProjectionTask } from "./bench.ts";
import {
  createHarborOraclePlan,
  HARBOR_VERSION,
  parseHarborTrialResult,
  type ParsedHarborResult,
} from "./harbor.ts";
import { readBoundedJson } from "./resources.ts";

const RESULT_BYTES = 2 * 1024 * 1024;

export interface OracleControlReceipt {
  readonly schema: "coffee-chat-eval/oracle-control";
  readonly benchmark: {
    readonly repository: "https://github.com/openboa-ai/coffee-chat-bench";
    readonly commit: string;
    readonly release: string;
    readonly bankDigest: string;
    readonly projectionDigest: string;
  };
  readonly harness: {
    readonly name: "harbor";
    readonly version: typeof HARBOR_VERSION;
  };
  readonly task: ProjectionTask;
  readonly execution: ParsedHarborResult;
  readonly measurement: "not_performed";
}

function assertCommit(commit: string) {
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new TypeError("benchmark commit must be a full lowercase Git commit");
  }
}

function prepareJobsRoot(raw: string): string {
  if (!isAbsolute(raw)) throw new TypeError("jobs root must be absolute");
  const jobsRoot = resolve(raw);
  const parent = dirname(jobsRoot);
  if (realpathSync(parent) !== parent) {
    throw new TypeError("jobs root parent must be a canonical Docker-shareable path");
  }
  mkdirSync(jobsRoot, { recursive: false });
  return jobsRoot;
}

function trialResultPath(jobRoot: string): string {
  const trials = readdirSync(jobRoot, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && entry.name.includes("__"),
  );
  if (trials.length !== 1) throw new Error("Harbor job must produce exactly one trial");
  return join(jobRoot, trials[0]!.name, "result.json");
}

export function runOracleControl(input: {
  readonly task: BaselineTask;
  readonly manifest: ProjectionManifest;
  readonly benchmarkCommit: string;
  readonly harborCommand: string;
  readonly jobsRoot: string;
}): OracleControlReceipt {
  assertCommit(input.benchmarkCommit);
  const jobsRoot = prepareJobsRoot(input.jobsRoot);
  const { path: _taskPath, ...receiptTask } = input.task;
  const plan = createHarborOraclePlan({
    task: {
      caseId: input.task.caseId,
      condition: input.task.condition,
      trialId: input.task.trialId,
      taskDigest: input.task.taskDigest,
      directory: input.task.directory,
      taskBytesDigest: input.task.taskBytesDigest,
      path: input.task.path,
    },
    harborCommand: input.harborCommand,
    jobsRoot,
  });
  const run = spawnSync(plan.command, plan.args, {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let execution: ParsedHarborResult;
  if (run.error !== undefined || run.status !== 0) {
    execution = {
      resultState: "invalid",
      failureClass: "host",
      reason: "Harbor control process failed",
    };
  } else {
    try {
      execution = parseHarborTrialResult(
        readBoundedJson(
          trialResultPath(plan.jobRoot),
          RESULT_BYTES,
          "Harbor trial result",
        ),
      );
    } catch {
      execution = {
        resultState: "invalid",
        failureClass: "artifact",
        reason: "Harbor result artifact is missing or invalid",
      };
    }
  }
  return Object.freeze({
    schema: "coffee-chat-eval/oracle-control",
    benchmark: {
      repository: "https://github.com/openboa-ai/coffee-chat-bench" as const,
      commit: input.benchmarkCommit,
      release: input.manifest.release,
      bankDigest: input.manifest.bankDigest,
      projectionDigest: input.manifest.projectionDigest,
    },
    harness: { name: "harbor" as const, version: HARBOR_VERSION },
    task: receiptTask,
    execution,
    measurement: "not_performed",
  });
}
