import { isAbsolute } from "node:path";

import type { BaselineTask } from "./bench.ts";

export const HARBOR_VERSION = "0.21.0" as const;

export type FailureClass = "host" | "candidate" | "verifier" | "artifact";

export interface HarborOraclePlan {
  readonly task: BaselineTask;
  readonly command: string;
  readonly args: readonly string[];
  readonly jobName: string;
  readonly jobRoot: string;
}

export type ParsedHarborResult =
  | {
      readonly resultState: "executed";
      readonly nativeReward: number;
      readonly nativeTrialId: string;
      readonly nativeTrialName: string;
      readonly nativeTaskName: string;
      readonly nativeAgentName: string;
      readonly nativeAgentVersion: string;
      readonly nativeEnvironmentType: "docker";
      readonly nativeEnvironmentDelete: true;
      readonly verifierEnvironmentMode: "shared" | "separate";
    }
  | {
      readonly resultState: "invalid";
      readonly failureClass: FailureClass;
      readonly reason: string;
    };

export const NATIVE_CODEX_AVAILABILITY = Object.freeze({
  status: "unavailable" as const,
  reason: "credential_isolation_unavailable" as const,
  detail:
    "Harbor 0.21 native Codex places provider credentials in candidate-readable environment and filesystem state",
});

export function createHarborOraclePlan(input: {
  readonly task: BaselineTask;
  readonly harborCommand: string;
  readonly jobsRoot: string;
}): HarborOraclePlan {
  if (!isAbsolute(input.task.path) || !isAbsolute(input.jobsRoot)) {
    throw new TypeError("Harbor task and jobs paths must be absolute");
  }
  if (!isAbsolute(input.harborCommand)) {
    throw new TypeError("Harbor command must be an absolute pinned executable");
  }
  const jobName = `bench-oracle-${input.task.condition}`;
  return Object.freeze({
    task: input.task,
    command: input.harborCommand,
    args: Object.freeze([
      "run",
      "-p",
      input.task.path,
      "-a",
      "oracle",
      "-o",
      input.jobsRoot,
      "--job-name",
      jobName,
      "--n-concurrent",
      "1",
      "-k",
      "1",
      "-y",
    ]),
    jobName,
    jobRoot: `${input.jobsRoot}/${jobName}`,
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function classifyFailure(result: Record<string, unknown>): FailureClass {
  const exception = record(result.exception_info);
  const type =
    typeof exception?.exception_type === "string" ? exception.exception_type : "";
  if (record(result.verifier) !== undefined || /verifier|reward/iu.test(type)) {
    return "verifier";
  }
  if (record(result.agent_execution) !== undefined) return "candidate";
  return "host";
}

export function parseHarborTrialResult(value: unknown): ParsedHarborResult {
  const result = record(value);
  if (result === undefined) {
    return {
      resultState: "invalid",
      failureClass: "artifact",
      reason: "Harbor result must be a JSON object",
    };
  }
  if (result.exception_info !== null && result.exception_info !== undefined) {
    return {
      resultState: "invalid",
      failureClass: classifyFailure(result),
      reason: "Harbor trial recorded an exception",
    };
  }
  const verifier = record(result.verifier_result);
  const rewards = record(verifier?.rewards);
  const reward = rewards?.reward;
  const agentInfo = record(result.agent_info);
  const config = record(result.config);
  const environment = record(config?.environment);
  if (
    typeof reward !== "number" ||
    !Number.isFinite(reward) ||
    typeof result.id !== "string" ||
    typeof result.trial_name !== "string" ||
    typeof result.task_name !== "string" ||
    typeof agentInfo?.name !== "string" ||
    typeof agentInfo.version !== "string" ||
    environment?.type !== "docker" ||
    environment.delete !== true ||
    (result.verifier_environment_mode !== "shared" &&
      result.verifier_environment_mode !== "separate")
  ) {
    return {
      resultState: "invalid",
      failureClass: "artifact",
      reason: "Harbor result lacks required execution evidence",
    };
  }
  return {
    resultState: "executed",
    nativeReward: reward,
    nativeTrialId: result.id,
    nativeTrialName: result.trial_name,
    nativeTaskName: result.task_name,
    nativeAgentName: agentInfo.name,
    nativeAgentVersion: agentInfo.version,
    nativeEnvironmentType: "docker",
    nativeEnvironmentDelete: true,
    verifierEnvironmentMode: result.verifier_environment_mode,
  };
}
