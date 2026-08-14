export type PcdaFailureClass = "host" | "candidate" | "verifier" | "artifact";

export type ParsedPcdaNativeResult =
  | {
      readonly state: "accepted" | "rejected";
      readonly nativeReward: 0 | 1;
      readonly nativeTrialId: string;
      readonly nativeTrialName: string;
      readonly nativeTaskName: "openboa-ai/pcda-case-projection";
      readonly nativeAgentName: string;
      readonly nativeAgentVersion: string;
      readonly nativeModelName?: string;
      readonly nativeEnvironmentType: "docker";
      readonly nativeEnvironmentDelete: true;
      readonly verifierEnvironmentMode: "separate";
    }
  | {
      readonly state: "invalid";
      readonly failureClass: PcdaFailureClass;
      readonly reason: string;
    };

interface NativeRecord {
  readonly [key: string]: unknown;
}

function record(value: unknown): NativeRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as NativeRecord)
    : undefined;
}

function invalid(
  failureClass: PcdaFailureClass,
  reason: string,
): ParsedPcdaNativeResult {
  return { state: "invalid", failureClass, reason };
}

function classifyFailure(value: NativeRecord): PcdaFailureClass {
  const exception = record(value.exception_info);
  const type =
    typeof exception?.exception_type === "string" ? exception.exception_type : "";
  if (record(value.verifier) !== undefined || /verifier|reward/iu.test(type)) {
    return "verifier";
  }
  if (record(value.agent_execution) !== undefined || /agent|candidate/iu.test(type)) {
    return "candidate";
  }
  return "host";
}

export function parsePcdaNativeResult(value: unknown): ParsedPcdaNativeResult {
  const result = record(value);
  if (result === undefined) {
    return invalid("artifact", "Harbor result must be a JSON object");
  }
  if (result.exception_info !== null && result.exception_info !== undefined) {
    return invalid(classifyFailure(result), "Harbor trial recorded an exception");
  }
  const verifier = record(result.verifier_result);
  const rewards = record(verifier?.rewards);
  const reward = rewards?.reward;
  if (reward !== 0 && reward !== 1) {
    return invalid("artifact", "Harbor verifier reward must be exactly 0 or 1");
  }
  if (result.verifier_environment_mode !== "separate") {
    return invalid("verifier", "PCDA requires a separate verifier environment");
  }
  const agent = record(result.agent_info);
  const model = record(agent?.model_info);
  const config = record(result.config);
  const environment = record(config?.environment);
  if (
    typeof result.id !== "string" ||
    result.id.length === 0 ||
    typeof result.trial_name !== "string" ||
    result.trial_name.length === 0 ||
    result.task_name !== "openboa-ai/pcda-case-projection" ||
    typeof agent?.name !== "string" ||
    typeof agent.version !== "string" ||
    environment?.type !== "docker" ||
    environment.delete !== true
  ) {
    return invalid("artifact", "Harbor result is missing exact native identity");
  }
  return {
    state: reward === 1 ? "accepted" : "rejected",
    nativeReward: reward,
    nativeTrialId: result.id,
    nativeTrialName: result.trial_name,
    nativeTaskName: "openboa-ai/pcda-case-projection",
    nativeAgentName: agent.name,
    nativeAgentVersion: agent.version,
    ...(typeof model?.name === "string" ? { nativeModelName: model.name } : {}),
    nativeEnvironmentType: "docker",
    nativeEnvironmentDelete: true,
    verifierEnvironmentMode: "separate",
  };
}

export function calibratePcdaNativeResults(input: {
  readonly oracle: unknown;
  readonly noop: unknown;
}):
  | { readonly state: "accepted"; readonly oracleReward: 1; readonly noopReward: 0 }
  | { readonly state: "rejected"; readonly reason: string }
  | { readonly state: "invalid"; readonly reason: string } {
  const oracle = parsePcdaNativeResult(input.oracle);
  const noop = parsePcdaNativeResult(input.noop);
  if (oracle.state === "invalid" || noop.state === "invalid") {
    return { state: "invalid", reason: "calibration native evidence is invalid" };
  }
  if (
    oracle.nativeTrialId !== "pcda-calibration-oracle" ||
    oracle.nativeTrialName !== "coffee-chat-pcda-calibration__oracle__1" ||
    oracle.nativeAgentName !== "oracle" ||
    oracle.nativeAgentVersion !== "0.1.0" ||
    noop.nativeTrialId !== "pcda-calibration-noop" ||
    noop.nativeTrialName !== "coffee-chat-pcda-calibration__nop__1" ||
    noop.nativeAgentName !== "nop" ||
    noop.nativeAgentVersion !== "0.1.0"
  ) {
    return {
      state: "invalid",
      reason: "calibration native identities do not match the sealed Oracle/no-op pair",
    };
  }
  if (oracle.nativeReward !== 1 || noop.nativeReward !== 0) {
    return { state: "rejected", reason: "Oracle must be 1 and no-op must be 0" };
  }
  return { state: "accepted", oracleReward: 1, noopReward: 0 };
}
