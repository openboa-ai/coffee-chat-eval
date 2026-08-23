import { createAgentDojoInventory } from "./agentdojo.ts";
import { createBeamInventory } from "./beam.ts";
import { createIfevalInventory } from "./ifeval.ts";
import { stableDigest } from "./identity.ts";
import type { RunProfile, TrackAdapter } from "./eval-core.ts";
import { createTasteInventory } from "./taste.ts";
import type { EvaluationTrackId } from "./track-registry.ts";

const IFEVAL_ADAPTER: TrackAdapter = Object.freeze({
  id: "ifeval",
  nativeMetricIds: [
    "strictPrompt",
    "strictInstruction",
    "loosePrompt",
    "looseInstruction",
  ],
  samplingUnit: "prompt",
  inventory: (profile: RunProfile) => createIfevalInventory(profile),
  candidateVisibleInput: (caseRef: unknown) => {
    const value = caseRef as { readonly caseId: string; readonly caseDigest: string };
    return Object.freeze({ caseId: value.caseId, inputDigest: value.caseDigest });
  },
});

const BEAM_ADAPTER: TrackAdapter = Object.freeze({
  id: "beam-record-core",
  nativeMetricIds: [
    "abstention",
    "contradiction_resolution",
    "information_extraction",
    "knowledge_update",
    "multi_session_reasoning",
    "temporal_reasoning",
  ],
  samplingUnit: "conversation",
  inventory: (profile: RunProfile) => createBeamInventory(profile),
  candidateVisibleInput: (caseRef: unknown) => {
    const value = caseRef as {
      readonly conversationId: string;
      readonly category: string;
      readonly questionOrdinal: number;
      readonly caseDigest: string;
    };
    return Object.freeze({
      conversationId: value.conversationId,
      category: value.category,
      questionOrdinal: value.questionOrdinal,
      inputDigest: value.caseDigest,
    });
  },
});

const AGENTDOJO_ADAPTER: TrackAdapter = Object.freeze({
  id: "agentdojo-security",
  nativeMetricIds: [
    "benignUtility",
    "utilityUnderAttack",
    "targetedASR",
    "injectionTaskSolvability",
  ],
  samplingUnit: "suite_user_task_cluster",
  inventory: (profile: RunProfile) => createAgentDojoInventory(profile),
  candidateVisibleInput: (caseRef: unknown) => {
    const value = caseRef as {
      readonly suite: string;
      readonly kind: string;
      readonly userTaskId: string | null;
      readonly episodeDigest: string;
    };
    return Object.freeze({
      suite: value.suite,
      userTaskId: value.userTaskId,
      inputDigest: value.episodeDigest,
    });
  },
});

const TASTE_ADAPTER: TrackAdapter = Object.freeze({
  id: "coffee-chat-taste",
  nativeMetricIds: ["pointwise", "pairwise"],
  samplingUnit: "family",
  inventory: (profile: RunProfile) => {
    const inventory = createTasteInventory(profile);
    return inventory.submissions;
  },
  candidateVisibleInput: (caseRef: unknown) => {
    const value = caseRef as {
      readonly submissionId: string;
      readonly familyId: string;
      readonly condition: string;
      readonly candidateInputDigest: string;
    };
    return Object.freeze({
      submissionId: value.submissionId,
      familyId: value.familyId,
      condition: value.condition,
      inputDigest: value.candidateInputDigest,
    });
  },
});

export const TRACK_ADAPTERS: Readonly<Record<EvaluationTrackId, TrackAdapter>> =
  Object.freeze({
    "coffee-chat-taste": TASTE_ADAPTER,
    "beam-record-core": BEAM_ADAPTER,
    ifeval: IFEVAL_ADAPTER,
    "agentdojo-security": AGENTDOJO_ADAPTER,
  });

export function getTrackAdapter(trackId: EvaluationTrackId): TrackAdapter {
  const adapter = TRACK_ADAPTERS[trackId];
  if (adapter === undefined)
    throw new TypeError(`track adapter is unavailable: ${trackId}`);
  return adapter;
}

export function candidateVisibleDigest(
  trackId: EvaluationTrackId,
  caseRef: unknown,
): `sha256:${string}` {
  return stableDigest(getTrackAdapter(trackId).candidateVisibleInput(caseRef));
}
