import type { ClaimStatus } from "./types.ts";

export const EVALUATION_TRACK_IDS = [
  "coffee-chat-taste",
  "beam-record-core",
  "ifeval",
  "agentdojo-security",
] as const;

export type EvaluationTrackId = (typeof EVALUATION_TRACK_IDS)[number];

export interface EvaluationTrack {
  readonly id: EvaluationTrackId;
  readonly declaredCaseCount: number;
  readonly status: Extract<ClaimStatus, "not_active">;
}

export const EVALUATION_TRACKS: readonly EvaluationTrack[] = Object.freeze([
  Object.freeze({
    id: "coffee-chat-taste",
    // Full profile submissions (32 families x three conditions). Judge calls
    // are recorded by the Taste adapter separately (96 submissions/672 calls).
    declaredCaseCount: 96,
    status: "not_active",
  }),
  Object.freeze({
    id: "beam-record-core",
    declaredCaseCount: 240,
    status: "not_active",
  }),
  Object.freeze({ id: "ifeval", declaredCaseCount: 541, status: "not_active" }),
  Object.freeze({
    id: "agentdojo-security",
    declaredCaseCount: 1081,
    status: "not_active",
  }),
]);

export function getEvaluationTrack(id: string): EvaluationTrack | undefined {
  return EVALUATION_TRACKS.find((track) => track.id === id);
}
