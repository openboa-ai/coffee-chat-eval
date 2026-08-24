import type {
  CandidateTransport,
  JudgeTransport,
  PrivateArtifactRef,
  RunPlan,
  SourceManifest,
  TrackExecutionResult,
} from "./eval-core.ts";
import type { RuntimeBundleConfig } from "./runtime-config.ts";
import type { MaterializedSourceVerification } from "./source-cache.ts";
import type { IfevalRightsRiskAcceptance } from "./ifeval.ts";

export interface EvidenceWriterInput {
  readonly value: unknown;
  readonly mediaType: string;
}

export interface TrackExecutorContext {
  readonly plan: RunPlan;
  readonly manifest: SourceManifest;
  readonly source: MaterializedSourceVerification;
  readonly candidate: CandidateTransport;
  readonly judge: JudgeTransport | undefined;
  /** Ephemeral broker capabilities supplied by `run`; never part of RunSpec identity. */
  readonly runtime?: RuntimeBundleConfig | undefined;
  /** Private operator receipt; never candidate-visible or copied to public artifacts. */
  readonly ifevalRightsRiskAcceptance?: IfevalRightsRiskAcceptance | undefined;
  readonly evidence: (input: EvidenceWriterInput) => PrivateArtifactRef;
}

/**
 * Raw adapter execution contract. This type does not grant authority to emit
 * an official run report or public receipt; that authority stays in the
 * canonical run engine.
 */
export type TrackExecutor = (
  context: TrackExecutorContext,
) => Promise<TrackExecutionResult>;
