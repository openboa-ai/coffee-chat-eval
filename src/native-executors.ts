import type { EvaluationTrackId } from "./track-registry.ts";
import type { TrackExecutor } from "./run-engine.ts";
import { createIfevalTrackExecutor } from "./ifeval.ts";
import { createTasteTrackExecutor } from "./taste.ts";
import { createBeamTrackExecutor } from "./beam.ts";
import { createAgentDojoTrackExecutor } from "./agentdojo.ts";

function deferred(trackId: EvaluationTrackId): TrackExecutor {
  return async ({ evidence }) => ({
    executionStatus: "not_implemented" as const,
    trialReceipts: [],
    metrics: { execution: { numerator: null, denominator: null, value: null } },
    nativeEvidence: evidence({
      value: { trackId, reason: "native sampled executor is not registered" },
      mediaType: "application/json",
    }),
    cleanupStatus: "complete" as const,
  });
}

export function getNativeTrackExecutor(trackId: EvaluationTrackId): TrackExecutor {
  switch (trackId) {
    case "ifeval":
      return createIfevalTrackExecutor() as unknown as TrackExecutor;
    case "coffee-chat-taste":
      return createTasteTrackExecutor() as unknown as TrackExecutor;
    case "beam-record-core":
      return createBeamTrackExecutor() as unknown as TrackExecutor;
    case "agentdojo-security":
      return createAgentDojoTrackExecutor() as unknown as TrackExecutor;
  }
}
