import { createTrialIdentity, stableDigest } from "./identity.ts";
import {
  artifactReceipt,
  immutableReceipt,
  receiptError,
  receiptEvidence,
  snapshotAndFreeze,
  validateArtifact,
} from "./validation.ts";
import type {
  CleanupResult,
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
  const trial = snapshotAndFreeze(input.trial);
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
  if (trial.id !== undefined && trial.id !== canonicalTrialId) {
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
      } else {
        if (execution.evidence) hostEvidence = receiptEvidence(execution.evidence);
        if (trial.host.isolationClass === "isolated" && !hostEvidence) {
          status = "unavailable";
          error = receiptError("isolation_evidence_missing");
        } else if (execution.candidate.kind === "failure") {
          status = "candidate_failure";
          error = receiptError("candidate_execution_failed");
        } else {
          const artifact = validateArtifact(execution.candidate.artifact);
          if (!artifact) {
            status = "invalid";
            error = receiptError("artifact_digest_invalid");
          } else {
            const immutableArtifact = snapshotAndFreeze(artifact);
            artifactSummary = artifactReceipt(immutableArtifact);
            try {
              const verification = await input.task.verify(immutableArtifact);
              if (verification.status === "valid") {
                metrics = snapshotAndFreeze(verification.metrics);
                status =
                  trial.host.isolationClass === "isolated" ? "measured" : "unmeasured";
                if (status === "unmeasured")
                  error = receiptError("verification_unmeasured");
              } else {
                status = verification.status;
                error = receiptError(`verification_${verification.status}`);
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
