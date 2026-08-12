export type Digest = `sha256:${string}`;
export type PcdaCondition = "T0" | "T1-A" | "T1-B";
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

export interface CombinedBudgetInput {
  readonly capNanoUsd: number;
  readonly candidatePlannedNanoUsd: number;
  readonly candidateSettledNanoUsd: number | null;
  readonly judgeWorstCaseNanoUsd: number;
}

export type CombinedBudgetResult =
  | { readonly state: "authorized"; readonly judgeBudgetNanoUsd: number }
  | { readonly state: "budget_exceeded"; readonly reason: string }
  | { readonly state: "unmeasured"; readonly reason: string };

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

export function parsePcdaNativeResult(
  value: unknown,
  expected?: {
    readonly agentName: "codex";
    readonly agentVersion: "0.147.0";
    readonly modelName: "gpt-5.6-terra";
  },
): ParsedPcdaNativeResult {
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
  if (
    expected !== undefined &&
    (agent.name !== expected.agentName ||
      agent.version !== expected.agentVersion ||
      model?.name !== expected.modelName)
  ) {
    return invalid("candidate", "Harbor candidate identity does not match the launch");
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

export function buildPcdaFailureReceipt(input: {
  readonly evaluatorCommit: string;
  readonly evaluatorTreeClean: boolean;
  readonly benchCommit: string;
  readonly bankDigest: Digest;
  readonly candidateModel: "gpt-5.6-terra";
  readonly failedCondition: PcdaCondition;
  readonly completedCandidateSettledNanoUsd: number;
  readonly reason: string;
  readonly cleanup: { readonly state: "completed"; readonly matchingContainers: 0 };
}) {
  if (!input.evaluatorTreeClean || !/^[0-9a-f]{40}$/u.test(input.evaluatorCommit)) {
    throw new Error("failure receipt requires a clean evaluator commit");
  }
  if (!/^[0-9a-f]{40}$/u.test(input.benchCommit)) {
    throw new Error("failure receipt requires an exact Bench commit");
  }
  digest(input.bankDigest, "bankDigest");
  boundedNanoUsd(
    input.completedCandidateSettledNanoUsd,
    "completedCandidateSettledNanoUsd",
  );
  if (input.reason.length === 0 || input.reason.length > 1_000) {
    throw new Error("failure receipt reason must be bounded");
  }
  return Object.freeze({
    release: "2026.8.12" as const,
    evaluatorCommit: input.evaluatorCommit,
    benchCommit: input.benchCommit,
    bankDigest: input.bankDigest,
    candidateModel: input.candidateModel,
    repetition: 0 as const,
    state: "unmeasured" as const,
    failure: Object.freeze({
      condition: input.failedCondition,
      executionState: "failed" as const,
      candidateState: "failed" as const,
      verifierState: "unmeasured" as const,
      judgeState: "skipped" as const,
      measurementState: "unmeasured" as const,
      reason: input.reason,
      cleanup: input.cleanup,
    }),
    cost: Object.freeze({
      campaignCapNanoUsd: 50_000_000_000 as const,
      candidateReservationNanoUsd: 20_000_000_000 as const,
      candidateCallReservationNanoUsd: 6_000_000_000 as const,
      observedCandidateSettledNanoUsd: input.completedCandidateSettledNanoUsd,
      failedCallSettledNanoUsd: null,
      remainingBudgetNanoUsd: null,
    }),
  });
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
  if (oracle.nativeReward !== 1 || noop.nativeReward !== 0) {
    return { state: "rejected", reason: "Oracle must be 1 and no-op must be 0" };
  }
  return { state: "accepted", oracleReward: 1, noopReward: 0 };
}

function boundedNanoUsd(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

export function authorizeCombinedBudget(
  input: CombinedBudgetInput,
): CombinedBudgetResult {
  boundedNanoUsd(input.capNanoUsd, "capNanoUsd");
  boundedNanoUsd(input.candidatePlannedNanoUsd, "candidatePlannedNanoUsd");
  boundedNanoUsd(input.judgeWorstCaseNanoUsd, "judgeWorstCaseNanoUsd");
  if (input.capNanoUsd !== 50_000_000_000) {
    throw new Error("PCDA combined cap must be exactly USD 50");
  }
  if (input.candidatePlannedNanoUsd > input.capNanoUsd) {
    return { state: "budget_exceeded", reason: "candidate reservation exceeds cap" };
  }
  if (input.candidateSettledNanoUsd === null) {
    return { state: "unmeasured", reason: "candidate settled cost is unavailable" };
  }
  boundedNanoUsd(input.candidateSettledNanoUsd, "candidateSettledNanoUsd");
  if (
    input.candidateSettledNanoUsd > input.candidatePlannedNanoUsd ||
    input.candidateSettledNanoUsd + input.judgeWorstCaseNanoUsd > input.capNanoUsd
  ) {
    return { state: "budget_exceeded", reason: "combined reservation exceeds cap" };
  }
  return {
    state: "authorized",
    judgeBudgetNanoUsd: input.capNanoUsd - input.candidateSettledNanoUsd,
  };
}

export interface PcdaConditionEvidence {
  readonly condition: PcdaCondition;
  readonly native: ParsedPcdaNativeResult;
  readonly artifactDigest: Digest;
  readonly candidateSettledNanoUsd: number;
  readonly cleanup: {
    readonly state: "completed" | "failed";
    readonly matchingContainers: number;
  };
  readonly judge?: {
    readonly state:
      | "measured"
      | "judge_disagreement"
      | "judge_unavailable"
      | "candidate_invalid"
      | "candidate_failure"
      | "verifier_failure"
      | "unmeasured";
    readonly resultDigest: Digest;
    readonly plannedWorstCaseNanoUsd?: number;
    readonly settledNanoUsd?: number;
  };
}

export function buildUnsignedPcdaAttestation(input: {
  readonly projection: {
    readonly release: string;
    readonly trialId: string;
    readonly caseId: string;
    readonly condition: PcdaCondition;
    readonly caseSourceDigest: Digest;
    readonly candidateDigest: Digest;
    readonly verifierDigest: Digest;
    readonly projectionDigest: Digest;
  };
  readonly artifactDigest: Digest;
  readonly benchCommit: string;
  readonly bankDigest: Digest;
  readonly deterministic: {
    readonly state:
      "unmeasured" | "candidate_invalid" | "candidate_failure" | "verifier_failure";
    readonly accepted: boolean;
    readonly criticalFailure: boolean;
    readonly reasonCode:
      "none" | "candidate_invalid" | "candidate_failure" | "verifier_failure";
  };
}): Readonly<Record<string, unknown>> {
  if (!/^[0-9a-f]{40}$/u.test(input.benchCommit)) {
    throw new Error("unsigned attestation requires an exact Bench commit");
  }
  digest(input.bankDigest, "bankDigest");
  digest(input.artifactDigest, "artifactDigest");
  return Object.freeze({
    artifactType: "isolated_verifier_attestation",
    issuer: "openboa-ai/coffee-chat-eval",
    release: input.projection.release,
    benchRepository: "openboa-ai/coffee-chat-bench",
    benchCommit: input.benchCommit,
    bankDigest: input.bankDigest,
    trialId: input.projection.trialId,
    caseId: input.projection.caseId,
    condition: input.projection.condition,
    sourceDigest: input.projection.caseSourceDigest,
    candidateDigest: input.projection.candidateDigest,
    verifierDigest: input.projection.verifierDigest,
    projectionDigest: input.projection.projectionDigest,
    artifactDigest: input.artifactDigest,
    ...input.deterministic,
    isolation: {
      network: {
        taskBaseline: "no-network",
        setup: {
          policy: "allowlist",
          hosts: ["dl-cdn.alpinelinux.org", "registry.npmjs.org"],
        },
        agent: { policy: "allowlist", hosts: ["api.openai.com"] },
        verifierBaseline: "no-network",
        verifierPhase: "no-network",
      },
      candidateInputs: "candidate_projection_only",
      verifierJudgment: "verifier_only",
      transferredArtifacts: ["/app/output.json"],
      cleanup: "completed",
    },
  });
}

export interface PcdaCampaignReceiptInput {
  readonly evaluatorCommit: string;
  readonly evaluatorTreeClean: boolean;
  readonly benchCommit: string;
  readonly bankDigest: Digest;
  readonly candidateModel: "gpt-5.6-terra";
  readonly campaignCapNanoUsd: 50_000_000_000;
  readonly candidateReservationNanoUsd: number;
  readonly candidateCallReservationNanoUsd: number;
  readonly remainingBudgetNanoUsd: number;
  readonly conditions: readonly PcdaConditionEvidence[];
}

function digest(value: string, label: string): Digest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a sha256 digest`);
  }
  return value as Digest;
}

export function buildPcdaCampaignReceipt(input: PcdaCampaignReceiptInput) {
  if (!input.evaluatorTreeClean || !/^[0-9a-f]{40}$/u.test(input.evaluatorCommit)) {
    throw new Error("receipt requires a clean evaluator commit");
  }
  if (!/^[0-9a-f]{40}$/u.test(input.benchCommit)) {
    throw new Error("receipt requires an exact Bench commit");
  }
  digest(input.bankDigest, "bankDigest");
  for (const [label, value] of [
    ["candidateReservationNanoUsd", input.candidateReservationNanoUsd],
    ["candidateCallReservationNanoUsd", input.candidateCallReservationNanoUsd],
    ["remainingBudgetNanoUsd", input.remainingBudgetNanoUsd],
  ] as const) {
    boundedNanoUsd(value, label);
  }
  if (
    input.campaignCapNanoUsd !== 50_000_000_000 ||
    input.candidateReservationNanoUsd > input.campaignCapNanoUsd ||
    input.candidateCallReservationNanoUsd > input.candidateReservationNanoUsd ||
    input.remainingBudgetNanoUsd > input.campaignCapNanoUsd
  ) {
    throw new Error("campaign receipt has invalid cost authority");
  }
  if (
    input.conditions.length !== 3 ||
    input.conditions.map(({ condition }) => condition).join(",") !== "T0,T1-A,T1-B"
  ) {
    throw new Error("campaign receipt requires exactly T0, T1-A, and T1-B");
  }
  const conditions = input.conditions.map((condition) => {
    digest(condition.artifactDigest, "artifactDigest");
    boundedNanoUsd(condition.candidateSettledNanoUsd, "candidateSettledNanoUsd");
    if (
      condition.cleanup.state !== "completed" ||
      condition.cleanup.matchingContainers !== 0
    ) {
      throw new Error(`cleanup evidence failed for ${condition.condition}`);
    }
    if (condition.native.state === "invalid") {
      const failure = condition.native.failureClass;
      return Object.freeze({
        condition: condition.condition,
        executionState: failure === "host" ? "failed" : "completed",
        candidateState: failure === "candidate" ? "failed" : "unmeasured",
        verifierState: failure === "verifier" ? "failed" : "unmeasured",
        judgeState: "skipped",
        measurementState: "invalid",
        reason: condition.native.reason,
        artifactDigest: condition.artifactDigest,
        candidateSettledNanoUsd: condition.candidateSettledNanoUsd,
      });
    }
    if (condition.judge === undefined) {
      return Object.freeze({
        condition: condition.condition,
        executionState: "completed",
        candidateState: "completed",
        verifierState: condition.native.state,
        judgeState: "unavailable",
        measurementState: "unmeasured",
        reason: "judge_not_run",
        artifactDigest: condition.artifactDigest,
        nativeTrialId: condition.native.nativeTrialId,
        nativeTrialName: condition.native.nativeTrialName,
        candidateSettledNanoUsd: condition.candidateSettledNanoUsd,
      });
    }
    digest(condition.judge.resultDigest, "judge.resultDigest");
    const benchState = condition.judge.state;
    const componentStates =
      benchState === "candidate_invalid"
        ? {
            candidateState: "invalid",
            verifierState: "unmeasured",
            judgeState: "skipped",
            measurementState: "invalid",
          }
        : benchState === "candidate_failure"
          ? {
              candidateState: "failed",
              verifierState: "unmeasured",
              judgeState: "skipped",
              measurementState: "unmeasured",
            }
          : benchState === "verifier_failure"
            ? {
                candidateState: "completed",
                verifierState: "failed",
                judgeState: "skipped",
                measurementState: "unmeasured",
              }
            : {
                candidateState: "completed",
                verifierState: condition.native.state,
                judgeState:
                  benchState === "measured"
                    ? "measured"
                    : benchState === "judge_disagreement"
                      ? "disagreement"
                      : benchState === "judge_unavailable"
                        ? "unavailable"
                        : "unmeasured",
                measurementState: benchState === "measured" ? "measured" : "unmeasured",
              };
    return Object.freeze({
      condition: condition.condition,
      executionState: "completed",
      ...componentStates,
      reason: benchState,
      artifactDigest: condition.artifactDigest,
      nativeTrialId: condition.native.nativeTrialId,
      nativeTrialName: condition.native.nativeTrialName,
      judgeResultDigest: condition.judge.resultDigest,
      candidateSettledNanoUsd: condition.candidateSettledNanoUsd,
      judgeSettledNanoUsd: condition.judge.settledNanoUsd ?? 0,
    });
  });
  const candidateSettledNanoUsd = input.conditions.reduce(
    (total, condition) => total + condition.candidateSettledNanoUsd,
    0,
  );
  const judgeSettledNanoUsd = input.conditions.reduce(
    (total, condition) => total + (condition.judge?.settledNanoUsd ?? 0),
    0,
  );
  if (
    !Number.isSafeInteger(candidateSettledNanoUsd) ||
    !Number.isSafeInteger(judgeSettledNanoUsd) ||
    input.campaignCapNanoUsd - candidateSettledNanoUsd - judgeSettledNanoUsd !==
      input.remainingBudgetNanoUsd
  ) {
    throw new Error("campaign receipt cost reconciliation failed");
  }
  return Object.freeze({
    release: "2026.8.12" as const,
    evaluatorCommit: input.evaluatorCommit,
    benchCommit: input.benchCommit,
    bankDigest: input.bankDigest,
    candidateModel: input.candidateModel,
    repetition: 0 as const,
    cost: Object.freeze({
      campaignCapNanoUsd: input.campaignCapNanoUsd,
      candidateReservationNanoUsd: input.candidateReservationNanoUsd,
      candidateCallReservationNanoUsd: input.candidateCallReservationNanoUsd,
      candidateSettledNanoUsd,
      judgeSettledNanoUsd,
      remainingBudgetNanoUsd: input.remainingBudgetNanoUsd,
    }),
    conditions: Object.freeze(conditions),
  });
}
