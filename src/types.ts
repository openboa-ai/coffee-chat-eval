export type TrialStatus =
  | "measured"
  | "unmeasured"
  | "skipped"
  | "unavailable"
  | "invalid"
  | "host_failure"
  | "candidate_failure"
  | "evaluator_failure"
  | "verifier_failure";

export type IsolationClass = "isolated" | "fixture" | "process";

export type Sha256Digest = `sha256:${string}`;

export interface EvaluatorRef {
  readonly repository: string;
  readonly commit: string;
  readonly calver: string;
  readonly configurationDigest: Sha256Digest;
}

export interface CandidateRef {
  readonly repository: string;
  readonly commit: string;
  readonly calver: string;
  readonly adapter: string;
}

export interface TaskRef {
  readonly id: string;
  readonly digest: Sha256Digest;
}

export interface HarnessRef {
  readonly id: string;
  readonly digest: Sha256Digest;
}

export interface ModelRef {
  readonly id: string;
  readonly digest: Sha256Digest;
}

export interface HostRef {
  readonly id: string;
  readonly isolationClass: IsolationClass;
  readonly configurationDigest: Sha256Digest;
  readonly isolationReference: string;
}

export interface TrialSpec {
  readonly id?: string;
  readonly evaluator: EvaluatorRef;
  readonly candidate: CandidateRef;
  readonly task: TaskRef;
  readonly harness: HarnessRef;
  readonly model: ModelRef;
  readonly host: HostRef;
  readonly repetition: number;
}

export interface Artifact {
  readonly id: string;
  readonly digest: Sha256Digest;
  readonly value: string;
}

export type CandidateRun =
  | { readonly kind: "success"; readonly artifact?: Artifact }
  | { readonly kind: "failure"; readonly message: string };

export interface CandidateAdapter {
  readonly ref: CandidateRef;
  run(input: {
    readonly trial: TrialSpec;
    readonly workspaceId: string;
  }): Promise<CandidateRun>;
}

export interface HostEvidence {
  readonly reference: string;
  readonly digest: Sha256Digest;
  readonly detail: string;
  readonly trialId: string;
  readonly artifactDigest: Sha256Digest;
  readonly artifactLocator: string;
}

export interface ReceiptEvidence {
  readonly locator: string;
  readonly digest: Sha256Digest;
  readonly trialId: string;
  readonly artifactDigest: Sha256Digest;
  readonly artifactLocator: string;
}

export type ReceiptErrorCode =
  | "adapter_reference_mismatch"
  | "artifact_digest_invalid"
  | "artifact_locator_invalid"
  | "artifact_locator_missing"
  | "candidate_execution_failed"
  | "cleanup_failed"
  | "evaluator_clock_invalid"
  | "evaluator_reference_mismatch"
  | "evaluator_execution_failed"
  | "host_execution_failed"
  | "isolation_evidence_invalid"
  | "isolation_evidence_missing"
  | "supplied_trial_id_mismatch"
  | "trial_provenance_invalid"
  | "verification_skipped"
  | "verification_unavailable"
  | "verification_metrics_invalid"
  | "verification_result_invalid"
  | "verification_unmeasured"
  | "verifier_execution_failed";

export interface ReceiptError {
  readonly code: ReceiptErrorCode;
}

export type HostExecution =
  | { readonly kind: "host_failure"; readonly message: string }
  | {
      readonly kind: "completed";
      readonly evidence?: HostEvidence;
      readonly artifactLocator?: string;
      readonly candidate: CandidateRun;
    };

export interface HostAdapter {
  readonly ref: HostRef;
  execute(input: {
    readonly trial: TrialSpec;
    readonly trialId: string;
    readonly candidate: CandidateAdapter;
    readonly workspaceId: string;
  }): Promise<HostExecution>;
  cleanup(input: {
    readonly trial: TrialSpec;
    readonly workspaceId: string;
  }): Promise<void>;
}

export type Verification =
  | { readonly status: "valid"; readonly metrics: Readonly<Record<string, number>> }
  | { readonly status: "skipped"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "unmeasured"; readonly reason: string };

export interface TaskAdapter {
  readonly ref: TaskRef;
  verify(artifact: Artifact): Promise<Verification> | Verification;
}

export interface CleanupResult {
  readonly status: "completed" | "failed" | "not_required";
  readonly error?: ReceiptError;
}

export interface TimingProviderRef {
  readonly id: string;
  readonly digest: Sha256Digest;
  readonly kind: "monotonic" | "unmeasured";
}

export interface TimingProvider {
  readonly ref: TimingProviderRef;
  monotonicNowMs?(): number;
}

export type TimingProvenance =
  | {
      readonly provider: TimingProviderRef;
      readonly status: "measured";
      readonly durationMs: number;
    }
  | {
      readonly provider: TimingProviderRef;
      readonly status: "unmeasured";
    };

export interface ArtifactReceipt {
  readonly locator: string;
  readonly digest: Sha256Digest;
  readonly byteSize: number;
}

export interface TrialReceipt {
  readonly trialId: string;
  readonly evaluator: EvaluatorRef;
  readonly candidate: CandidateRef;
  readonly task: TaskRef;
  readonly harness: HarnessRef;
  readonly model: ModelRef;
  readonly host: HostRef;
  readonly repetition: number | null;
  readonly status: TrialStatus;
  readonly evidenceClass: IsolationClass;
  readonly performanceClaim: false;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly timing: TimingProvenance;
  readonly error?: ReceiptError;
  readonly hostEvidence?: ReceiptEvidence;
  readonly artifact?: ArtifactReceipt;
  readonly metrics?: Readonly<Record<string, number>>;
  readonly cleanup: CleanupResult;
  readonly receiptDigest: Sha256Digest;
}

export interface MatrixDefinition {
  readonly evaluator: EvaluatorRef;
  readonly candidate: CandidateRef;
  readonly tasks: readonly TaskRef[];
  readonly harnesses: readonly HarnessRef[];
  readonly models: readonly ModelRef[];
  readonly hosts: readonly HostRef[];
  readonly repetitions: number;
}
