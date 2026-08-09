import { createTrialIdentity, stableDigest } from "./identity.ts";
import {
  artifactReceipt,
  canonicalEvaluatorRef,
  immutableReceipt,
  isSafeHttpsRepositoryUrl,
  receiptError,
  snapshotAndFreeze,
  validateArtifact,
  validateArtifactLocator,
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
  readonly now: () => unknown;
  readonly timing: TimingProvider;
}

const canonicalUtcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const invalidTrialId = `trial-invalid-${stableDigest("invalid-trial-provenance").slice("sha256:".length)}`;

function readCanonicalUtcTimestamp(now: () => unknown): string | undefined {
  let value: unknown;
  try {
    value = now();
  } catch {
    return undefined;
  }
  if (typeof value !== "string" || !canonicalUtcTimestamp.test(value)) {
    return undefined;
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString() !== value) {
    return undefined;
  }
  return value;
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

function candidateExecutionBoundary(candidate: CandidateAdapter): CandidateAdapter {
  return {
    ref: candidate.ref,
    async run(input) {
      try {
        const resolved: unknown = await candidate.run(input);
        if (
          typeof resolved !== "object" ||
          resolved === null ||
          Array.isArray(resolved)
        ) {
          return {
            kind: "failure",
            message: "candidate adapter returned invalid output",
          };
        }
        const candidateRun = resolved as Record<string, unknown>;
        if (candidateRun.kind === "failure") {
          return typeof candidateRun.message === "string"
            ? { kind: "failure", message: candidateRun.message }
            : {
                kind: "failure",
                message: "candidate adapter returned invalid output",
              };
        }
        if (candidateRun.kind === "success") {
          try {
            const artifact = validateArtifact(candidateRun.artifact);
            return artifact
              ? { kind: "success", artifact: snapshotAndFreeze(artifact) }
              : { kind: "success" };
          } catch {
            return { kind: "success" };
          }
        }
        return {
          kind: "failure",
          message: "candidate adapter returned invalid output",
        };
      } catch {
        return { kind: "failure", message: "candidate adapter execution failed" };
      }
    },
  };
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
  const durationMs = finishedAt - started.startedAt;
  if (!Number.isFinite(durationMs)) {
    return { provider: started.provider, status: "unmeasured" };
  }
  return {
    provider: started.provider,
    status: "measured",
    durationMs,
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
  const projectedTrial = snapshotAndFreeze({
    ...suppliedTrial,
    evaluator: runningEvaluator,
  });
  const trial = validateTrialProvenance(projectedTrial) ? projectedTrial : undefined;
  const receiptTrial =
    trial ??
    snapshotAndFreeze({
      ...projectedTrial,
      repetition: null,
    });
  const canonicalTrialId = trial ? createTrialIdentity(trial) : invalidTrialId;
  const startedAt = readCanonicalUtcTimestamp(input.now);
  const timing = startTiming(input.timing);
  const workspaceId = `workspace-${canonicalTrialId}`;
  let cleanup: CleanupResult = { status: "not_required" };
  let status: TrialStatus = "evaluator_failure";
  let error: ReceiptError | undefined;
  let hostEvidence: TrialReceipt["hostEvidence"];
  let artifactSummary: TrialReceipt["artifact"];
  let metrics: Readonly<Record<string, number>> | undefined;
  if (!startedAt) {
    status = "evaluator_failure";
    error = receiptError("evaluator_clock_invalid");
  } else if (!declaredEvaluator) {
    status = "invalid";
    error = receiptError("trial_provenance_invalid");
  } else if (stableDigest(declaredEvaluator) !== stableDigest(runningEvaluator)) {
    status = "invalid";
    error = receiptError("evaluator_reference_mismatch");
  } else if (!trial) {
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
        trialId: canonicalTrialId,
        candidate: candidateExecutionBoundary(input.candidate),
        workspaceId,
      });
      if (execution.kind === "host_failure") {
        status = "host_failure";
        error = receiptError("host_execution_failed");
      } else if (execution.candidate.kind === "failure") {
        status = "candidate_failure";
        error = receiptError("candidate_execution_failed");
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
          const suppliedArtifactLocator =
            execution.artifactLocator ?? execution.evidence?.artifactLocator;
          const artifactLocator = validateArtifactLocator(
            suppliedArtifactLocator,
            trial.host.isolationClass,
          );
          if (!artifactLocator) {
            status = "unavailable";
            error = receiptError(
              suppliedArtifactLocator === undefined
                ? "artifact_locator_missing"
                : "artifact_locator_invalid",
            );
          } else {
            const evidenceWasSupplied = execution.evidence !== undefined;
            if (evidenceWasSupplied) {
              try {
                hostEvidence = validateHostEvidence(
                  execution.evidence,
                  trial.host.isolationClass,
                  {
                    trialId: canonicalTrialId,
                    artifactDigest: immutableArtifact.digest,
                    artifactLocator,
                  },
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
              artifactSummary = artifactReceipt(immutableArtifact, artifactLocator);
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
                    trial.host.isolationClass === "isolated"
                      ? "measured"
                      : "unmeasured";
                  if (status === "unmeasured") {
                    error = receiptError("verification_unmeasured");
                  }
                } else {
                  status = validation.verification.status;
                  error = receiptError(
                    `verification_${validation.verification.status}`,
                  );
                }
              } catch (caught) {
                void caught;
                status = "verifier_failure";
                error = receiptError("verifier_execution_failed");
              }
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
  const finishedAt = startedAt ? readCanonicalUtcTimestamp(input.now) : undefined;
  const timestampsAreValid =
    startedAt !== undefined &&
    finishedAt !== undefined &&
    Date.parse(finishedAt) >= Date.parse(startedAt);
  if (!timestampsAreValid) {
    status = "evaluator_failure";
    error = receiptError("evaluator_clock_invalid");
    hostEvidence = undefined;
    artifactSummary = undefined;
    metrics = undefined;
  }
  const base = {
    trialId: canonicalTrialId,
    evaluator: runningEvaluator,
    candidate: receiptTrial.candidate,
    task: receiptTrial.task,
    harness: receiptTrial.harness,
    model: receiptTrial.model,
    host: receiptTrial.host,
    repetition: receiptTrial.repetition,
    status,
    evidenceClass: receiptTrial.host.isolationClass,
    performanceClaim: false as const,
    ...(timestampsAreValid ? { startedAt, finishedAt } : {}),
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
