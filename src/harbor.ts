export const HARBOR_VERSION = "0.21.0" as const;

const CANDIDATE_REPOSITORY = "https://github.com/openboa-ai/coffee-chat";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

export type CanaryAgent = "oracle" | "nop" | "codex";
export type FailureClass = "host" | "candidate" | "verifier" | "artifact";

export interface HarborJobInput {
  readonly agent: CanaryAgent;
  readonly candidateCommit: string;
  readonly jobsDir: string;
  readonly model?: string;
}

export interface HarborJobConfig {
  readonly job_name: string;
  readonly jobs_dir: string;
  readonly n_attempts: 1;
  readonly n_concurrent_trials: 1;
  readonly environment: { readonly type: "docker"; readonly delete: true };
  readonly verifier: { readonly disable: false };
  readonly agents: readonly [
    {
      readonly name: CanaryAgent;
      readonly model_name?: string;
      readonly env: {
        readonly COFFEE_CHAT_CANDIDATE_REPOSITORY: string;
        readonly COFFEE_CHAT_CANDIDATE_COMMIT: string;
      };
    },
  ];
  readonly tasks: readonly [{ readonly path: "evals/protocol-canary" }];
  readonly artifacts: readonly ["/app/protocol-canary.json"];
}

export type ParsedHarborResult =
  | {
      readonly resultState: "unmeasured";
      readonly nativeReward: number;
      readonly nativeTrialId: string;
      readonly nativeTrialName: string;
      readonly nativeTaskName: string;
      readonly nativeAgentName: string;
      readonly nativeAgentVersion: string;
      readonly nativeModelName?: string;
      readonly nativeCandidateCommit?: string;
      readonly nativeEnvironmentType: "docker";
      readonly nativeEnvironmentDelete: true;
      readonly verifierEnvironmentMode: "separate";
    }
  | {
      readonly resultState: "invalid";
      readonly failureClass: FailureClass;
      readonly reason: string;
    };

export function createHarborJobConfig(input: HarborJobInput): HarborJobConfig {
  if (!COMMIT_PATTERN.test(input.candidateCommit)) {
    throw new Error("candidateCommit must be a full lowercase Git commit");
  }
  if (!input.jobsDir.trim()) {
    throw new Error("jobsDir must not be empty");
  }

  return {
    job_name: `coffee-chat-protocol-canary-${input.agent}`,
    jobs_dir: input.jobsDir,
    n_attempts: 1,
    n_concurrent_trials: 1,
    environment: { type: "docker", delete: true },
    verifier: { disable: false },
    agents: [
      {
        name: input.agent,
        ...(input.model === undefined ? {} : { model_name: input.model }),
        env: {
          COFFEE_CHAT_CANDIDATE_REPOSITORY: CANDIDATE_REPOSITORY,
          COFFEE_CHAT_CANDIDATE_COMMIT: input.candidateCommit,
        },
      },
    ],
    tasks: [{ path: "evals/protocol-canary" }],
    artifacts: ["/app/protocol-canary.json"],
  };
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
  if (record(result.agent_execution) !== undefined) {
    return "candidate";
  }
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
  if (typeof reward !== "number" || !Number.isFinite(reward)) {
    return {
      resultState: "invalid",
      failureClass: "artifact",
      reason: "Harbor verifier reward must be a finite number",
    };
  }
  if (result.verifier_environment_mode !== "separate") {
    return {
      resultState: "invalid",
      failureClass: "verifier",
      reason: "Protocol canary requires a separate verifier environment",
    };
  }
  if (typeof result.id !== "string" || typeof result.trial_name !== "string") {
    return {
      resultState: "invalid",
      failureClass: "artifact",
      reason: "Harbor result is missing native trial identity",
    };
  }
  const agentInfo = record(result.agent_info);
  const modelInfo = record(agentInfo?.model_info);
  const config = record(result.config);
  const agentConfig = record(config?.agent);
  const agentKwargs = record(agentConfig?.kwargs);
  const environmentConfig = record(config?.environment);
  if (
    typeof result.task_name !== "string" ||
    typeof agentInfo?.name !== "string" ||
    typeof agentInfo.version !== "string" ||
    environmentConfig?.type !== "docker" ||
    environmentConfig.delete !== true
  ) {
    return {
      resultState: "invalid",
      failureClass: "artifact",
      reason: "Harbor result is missing native task or agent identity",
    };
  }

  return {
    resultState: "unmeasured",
    nativeReward: reward,
    nativeTrialId: result.id,
    nativeTrialName: result.trial_name,
    nativeTaskName: result.task_name,
    nativeAgentName: agentInfo.name,
    nativeAgentVersion: agentInfo.version,
    nativeEnvironmentType: "docker",
    nativeEnvironmentDelete: true,
    ...(typeof modelInfo?.name === "string" ? { nativeModelName: modelInfo.name } : {}),
    ...(typeof agentKwargs?.candidate_commit === "string"
      ? { nativeCandidateCommit: agentKwargs.candidate_commit }
      : {}),
    verifierEnvironmentMode: "separate",
  };
}
