import type { EvaluationTrackId } from "./track-registry.ts";
import type { TrackExecutor } from "./track-executor.ts";
import { createIfevalTrackExecutor } from "./ifeval.ts";
import { createTasteTrackExecutor } from "./taste.ts";
import { createBeamTrackExecutor } from "./beam.ts";
import { createAgentDojoTrackExecutor } from "./agentdojo.ts";

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
