import { createTrialIdentity, stableDigest } from "./identity.ts";
import {
  artifactReceipt,
  canonicalEvaluatorRef,
  canonicalTrialInput,
  immutableReceipt,
  receiptError,
  snapshotAndFreeze,
  validateArtifactPersistenceAttestation,
  validateCandidateRunEnvelope,
  validateHostEvidence,
  validateHostExecutionEnvelope,
  validateIsolationAttestation,
  validateVerification,
} from "./validation.ts";
import type {
  Artifact,
  CleanupResult,
  EvaluatorRef,
  HostEvidence,
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
  readonly inspectHostEvidence: (input: {
    readonly trial: TrialSpec;
    readonly trialId: string;
    readonly artifact: Artifact;
    readonly evidence: HostEvidence;
  }) => Promise<unknown> | unknown;
  readonly persistArtifact: (input: {
    readonly trial: TrialSpec;
    readonly trialId: string;
    readonly artifact: Artifact;
  }) => Promise<unknown> | unknown;
  readonly now: () => unknown;
  readonly timing: TimingProvider;
}

const canonicalUtcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const invalidTrialId = `trial-invalid-${stableDigest("invalid-trial-provenance").slice("sha256:".length)}`;
const invalidReceiptTrial = Object.freeze({
  candidate: null,
  task: null,
  harness: null,
  model: null,
  host: null,
  repetition: null,
  evidenceClass: null,
});

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
  try {
    return (
      stableDigest(snapshotAndFreeze(input.candidate.ref)) ===
        stableDigest(trial.candidate) &&
      stableDigest(snapshotAndFreeze(input.host.ref)) === stableDigest(trial.host) &&
      stableDigest(snapshotAndFreeze(input.task.ref)) === stableDigest(trial.task)
    );
  } catch {
    return false;
  }
}

function candidateExecutionBoundary(candidate: CandidateAdapter): CandidateAdapter {
  return {
    ref: candidate.ref,
    async run(input) {
      try {
        const resolved: unknown = await candidate.run(input);
        const candidateRun = validateCandidateRunEnvelope(resolved);
        if (!candidateRun) {
          return {
            kind: "failure",
            message: "candidate adapter returned invalid output",
          };
        }
        if (candidateRun.kind === "failure") {
          return { kind: "failure", message: candidateRun.message };
        }
        return candidateRun.artifact
          ? { kind: "success", artifact: candidateRun.artifact }
          : { kind: "success" };
      } catch {
        return { kind: "failure", message: "candidate adapter execution failed" };
      }
    },
  };
}

async function executeHostBoundary(
  input: RunTrialInput,
  trial: TrialSpec,
  trialId: string,
  workspaceId: string,
): Promise<
  | { readonly kind: "returned"; readonly output: unknown }
  | { readonly kind: "host_failure" }
> {
  const candidate = candidateExecutionBoundary(input.candidate);
  try {
    return {
      kind: "returned",
      output: await input.host.execute({
        trial,
        trialId,
        candidate,
        workspaceId,
      }),
    };
  } catch {
    return { kind: "host_failure" };
  }
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
  const { declaredEvaluator, trial } = canonicalTrialInput(
    input.trial,
    runningEvaluator,
  );
  const projectedReceiptTrial = trial
    ? {
        candidate: trial.candidate,
        task: trial.task,
        harness: trial.harness,
        model: trial.model,
        host: trial.host,
        repetition: trial.repetition,
        evidenceClass: trial.host.isolationClass,
      }
    : invalidReceiptTrial;
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
      const hostAttempt = await executeHostBoundary(
        input,
        trial,
        canonicalTrialId,
        workspaceId,
      );
      if (hostAttempt.kind === "host_failure") {
        status = "host_failure";
        error = receiptError("host_execution_failed");
      } else {
        const execution = validateHostExecutionEnvelope(hostAttempt.output);
        if (!execution) {
          status = "evaluator_failure";
          error = receiptError("evaluator_execution_failed");
        } else if (execution.kind === "host_failure") {
          status = "host_failure";
          error = receiptError("host_execution_failed");
        } else if (execution.candidate.kind === "failure") {
          status = "candidate_failure";
          error = receiptError("candidate_execution_failed");
        } else {
          const immutableArtifact = execution.candidate.artifact;
          if (!immutableArtifact) {
            status = "invalid";
            error = receiptError("artifact_digest_invalid");
          } else {
            const evidenceWasSupplied = execution.evidence !== undefined;
            let validatedEvidence: HostEvidence | undefined;
            if (evidenceWasSupplied) {
              try {
                validatedEvidence = validateHostEvidence(
                  execution.evidence,
                  trial.host.isolationClass,
                  {
                    trialId: canonicalTrialId,
                    artifactDigest: immutableArtifact.digest,
                  },
                );
              } catch {
                validatedEvidence = undefined;
              }
            }
            if (trial.host.isolationClass === "isolated" && !evidenceWasSupplied) {
              status = "unavailable";
              error = receiptError("isolation_evidence_missing");
            } else if (trial.host.isolationClass === "isolated" && !validatedEvidence) {
              status = "unavailable";
              error = receiptError("isolation_evidence_invalid");
            } else {
              if (validatedEvidence) {
                const inspectedEvidence =
                  typeof input.inspectHostEvidence === "function"
                    ? await input.inspectHostEvidence({
                        trial,
                        trialId: canonicalTrialId,
                        artifact: immutableArtifact,
                        evidence: validatedEvidence,
                      })
                    : undefined;
                hostEvidence = validateIsolationAttestation(
                  inspectedEvidence,
                  validatedEvidence,
                  trial.host,
                  {
                    trialId: canonicalTrialId,
                    artifactDigest: immutableArtifact.digest,
                  },
                );
              }
              if (trial.host.isolationClass === "isolated" && !hostEvidence) {
                status = "unavailable";
                error = receiptError("isolation_evidence_invalid");
              } else {
                const suppliedArtifactLocator =
                  typeof input.persistArtifact === "function"
                    ? await input.persistArtifact({
                        trial,
                        trialId: canonicalTrialId,
                        artifact: immutableArtifact,
                      })
                    : undefined;
                const persistence = validateArtifactPersistenceAttestation(
                  suppliedArtifactLocator,
                  trial.host.isolationClass,
                  {
                    trialId: canonicalTrialId,
                    artifactDigest: immutableArtifact.digest,
                  },
                );
                if (!persistence) {
                  status = "unavailable";
                  error = receiptError(
                    suppliedArtifactLocator === undefined
                      ? "artifact_locator_missing"
                      : "artifact_locator_invalid",
                  );
                } else {
                  artifactSummary = artifactReceipt(immutableArtifact, persistence);
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
  const publicTrialWasInvalid =
    status === "invalid" && cleanup.status === "not_required";
  const receiptTrial = publicTrialWasInvalid
    ? invalidReceiptTrial
    : projectedReceiptTrial;
  const base = {
    trialId: publicTrialWasInvalid ? invalidTrialId : canonicalTrialId,
    evaluator: runningEvaluator,
    candidate: receiptTrial.candidate,
    task: receiptTrial.task,
    harness: receiptTrial.harness,
    model: receiptTrial.model,
    host: receiptTrial.host,
    repetition: receiptTrial.repetition,
    status,
    evidenceClass: receiptTrial.evidenceClass,
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
