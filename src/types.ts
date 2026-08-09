export type ResultState =
  "measured" | "unmeasured" | "skipped" | "unavailable" | "invalid" | "not_implemented";

export type IsolationClass = "fixture" | "real";

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

export interface DeferredExecution {
  readonly trialId: string;
  readonly status: "not_implemented" | "unavailable";
  readonly reason: string;
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
