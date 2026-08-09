import { createTrialIdentity, stableDigest } from "./identity.ts";
import {
  artifactReceipt,
  canonicalEvaluatorRef,
  immutableReceipt,
  isSafeHttpsRepositoryUrl,
  receiptError,
  snapshotAndFreeze,
  validateArtifact,
  validateHostEvidence,
  validateTrialProvenance,
  validateVerification,
} from "./validation.ts";
import type {
  Artifact,
  CleanupResult,
  EvaluatorRef,
  ReceiptError,
  TimingProvenance,
  TrialReceipt,
  TrialSpec,
} from "./types.ts";
import type {
  CandidateAdapter,
  HostAdapter,
  TaskAdapter,
  TimingProvider,
  TrialStatus,
} from "./types.ts";

export interface RunTrialInput {
  readonly trial: TrialSpec;
  readonly runningEvaluator: EvaluatorRef;
  readonly candidate: CandidateAdapter;
  readonly host: HostAdapter;
  readonly task: TaskAdapter;
  readonly now: () => string;
  readonly timing: TimingProvider;
}

function cleanupFailure(error: unknown): CleanupResult {
  void error;
  return {
    status: "failed",
    error: receiptError("cleanup_failed"),
  };
}

function adapterReferencesMatch(input: RunTrialInput, trial: TrialSpec): boolean {
  return (
    stableDigest(snapshotAndFreeze(input.candidate.ref)) ===
      stableDigest(trial.candidate) &&
    stableDigest(snapshotAndFreeze(input.host.ref)) === stableDigest(trial.host) &&
    stableDigest(snapshotAndFreeze(input.task.ref)) === stableDigest(trial.task)
  );
}

function startTiming(timing: TimingProvider): {
  readonly provider: TimingProvider["ref"];
  readonly startedAt?: number;
} {
  const provider = snapshotAndFreeze(timing.ref);
  if (provider.kind !== "monotonic" || !timing.monotonicNowMs) return { provider };
  let startedAt: number;
  try {
    startedAt = timing.monotonicNowMs();
  } catch {
    return { provider };
  }
  if (!Number.isFinite(startedAt)) return { provider };
  return { provider, startedAt };
}

function finishTiming(
  started: ReturnType<typeof startTiming>,
  timing: TimingProvider,
): TimingProvenance {
  if (started.startedAt === undefined || !timing.monotonicNowMs) {
    return { provider: started.provider, status: "unmeasured" };
  }
  let finishedAt: number;
  try {
    finishedAt = timing.monotonicNowMs();
  } catch {
    return { provider: started.provider, status: "unmeasured" };
  }
  if (!Number.isFinite(finishedAt) || finishedAt < started.startedAt) {
    return { provider: started.provider, status: "unmeasured" };
  }
  return {
    provider: started.provider,
    status: "measured",
    durationMs: finishedAt - started.startedAt,
  };
}

export async function runTrial(input: RunTrialInput): Promise<TrialReceipt> {
  const runningEvaluator = canonicalEvaluatorRef(input.runningEvaluator);
  if (!runningEvaluator) {
    throw new TypeError("trusted evaluator provenance is invalid");
  }
  if (!isSafeHttpsRepositoryUrl(input.trial.candidate.repository)) {
    throw new TypeError("candidate repository provenance is invalid");
  }
  const suppliedTrial = snapshotAndFreeze(input.trial);
  const declaredEvaluator = canonicalEvaluatorRef(suppliedTrial.evaluator);
  const trial = snapshotAndFreeze({
    ...suppliedTrial,
    evaluator: runningEvaluator,
  });
  const canonicalTrialId = createTrialIdentity(trial);
  const startedAt = input.now();
  const timing = startTiming(input.timing);
  const workspaceId = `workspace-${canonicalTrialId}`;
  let cleanup: CleanupResult = { status: "not_required" };
  let status: TrialStatus = "evaluator_failure";
  let error: ReceiptError | undefined;
  let hostEvidence: TrialReceipt["hostEvidence"];
  let artifactSummary: TrialReceipt["artifact"];
  let metrics: Readonly<Record<string, number>> | undefined;
  if (!declaredEvaluator) {
    status = "invalid";
    error = receiptError("trial_provenance_invalid");
  } else if (stableDigest(declaredEvaluator) !== stableDigest(runningEvaluator)) {
    status = "invalid";
    error = receiptError("evaluator_reference_mismatch");
  } else if (!validateTrialProvenance(trial)) {
    status = "invalid";
    error = receiptError("trial_provenance_invalid");
  } else if (trial.id !== undefined && trial.id !== canonicalTrialId) {
    status = "invalid";
    error = receiptError("supplied_trial_id_mismatch");
  } else if (!adapterReferencesMatch(input, trial)) {
    status = "invalid";
    error = receiptError("adapter_reference_mismatch");
  } else {
    cleanup = { status: "completed" };
    try {
      const execution = await input.host.execute({
        trial,
        candidate: input.candidate,
        workspaceId,
      });
      if (execution.kind === "host_failure") {
        status = "host_failure";
        error = receiptError("host_execution_failed");
      } else if (execution.candidate.kind === "failure") {
        status = "candidate_failure";
        error = receiptError("candidate_execution_failed");
      } else {
        const evidenceWasSupplied = execution.evidence !== undefined;
        if (evidenceWasSupplied) {
          try {
            hostEvidence = validateHostEvidence(
              execution.evidence,
              trial.host.isolationClass,
            );
          } catch {
            hostEvidence = undefined;
          }
        }
        if (trial.host.isolationClass === "isolated" && !evidenceWasSupplied) {
          status = "unavailable";
          error = receiptError("isolation_evidence_missing");
        } else if (trial.host.isolationClass === "isolated" && !hostEvidence) {
          status = "unavailable";
          error = receiptError("isolation_evidence_invalid");
        } else {
          let artifact: Artifact | undefined;
          try {
            artifact = validateArtifact(execution.candidate.artifact);
          } catch {
            artifact = undefined;
          }
          if (!artifact) {
            status = "invalid";
            error = receiptError("artifact_digest_invalid");
          } else {
            const immutableArtifact = snapshotAndFreeze(artifact);
            artifactSummary = artifactReceipt(immutableArtifact);
            try {
              const validation = validateVerification(
                await input.task.verify(immutableArtifact),
              );
              if (validation.kind === "invalid") {
                status = "verifier_failure";
                error = receiptError(validation.error);
              } else if (validation.verification.status === "valid") {
                metrics = validation.verification.metrics;
                status =
                  trial.host.isolationClass === "isolated" ? "measured" : "unmeasured";
                if (status === "unmeasured") {
                  error = receiptError("verification_unmeasured");
                }
              } else {
                status = validation.verification.status;
                error = receiptError(`verification_${validation.verification.status}`);
              }
            } catch (caught) {
              void caught;
              status = "verifier_failure";
              error = receiptError("verifier_execution_failed");
            }
          }
        }
      }
    } catch (caught) {
      void caught;
      status = "evaluator_failure";
      error = receiptError("evaluator_execution_failed");
    } finally {
      try {
        await input.host.cleanup({ trial, workspaceId });
      } catch (caught) {
        cleanup = cleanupFailure(caught);
      }
    }
  }
  const finishedAt = input.now();
  const base = {
    trialId: canonicalTrialId,
    evaluator: runningEvaluator,
    candidate: trial.candidate,
    task: trial.task,
    harness: trial.harness,
    model: trial.model,
    host: trial.host,
    repetition: trial.repetition,
    status,
    evidenceClass: trial.host.isolationClass,
    performanceClaim: false as const,
    startedAt,
    finishedAt,
    timing: finishTiming(timing, input.timing),
    cleanup,
  };
  return immutableReceipt({
    ...base,
    ...(error ? { error } : {}),
    ...(hostEvidence ? { hostEvidence } : {}),
    ...(artifactSummary ? { artifact: artifactSummary } : {}),
    ...(metrics ? { metrics } : {}),
  });
}
