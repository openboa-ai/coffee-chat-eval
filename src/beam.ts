import { stableDigest } from "./identity.ts";
import type { Sha256Digest } from "./types.ts";

export type BeamProfile = "fixture" | "smoke" | "pilot" | "score";

export const BEAM_SOURCE = Object.freeze({
  codeRepository: "https://github.com/mohammadtavakoli78/BEAM",
  codeCommit: "3e12035532eb85768f1a7cd779832b650c4b2ef9",
  dataRepository: "https://huggingface.co/datasets/Mohammadta/BEAM",
  dataCommit: "3205395e897e7318c7b094ef4e6047b9b82dbb03",
  codeLicense: "MIT",
  dataLicense: "CC BY-SA 4.0",
  tier: "100K",
});

export const BEAM_CATEGORIES = Object.freeze([
  "abstention",
  "contradiction_resolution",
  "information_extraction",
  "knowledge_update",
  "multi_session_reasoning",
  "temporal_reasoning",
] as const);

export type BeamCategory = (typeof BEAM_CATEGORIES)[number];
export const BEAM_CONVERSATION_COUNT = 20;
export const BEAM_QUERIES_PER_CATEGORY = 2;
export const BEAM_QUERY_COUNT =
  BEAM_CONVERSATION_COUNT * BEAM_CATEGORIES.length * BEAM_QUERIES_PER_CATEGORY;

export interface BeamCase {
  readonly conversationId: string;
  readonly category: BeamCategory;
  readonly questionOrdinal: 0 | 1;
  readonly caseDigest: Sha256Digest;
}

function caseRef(
  conversationIndex: number,
  category: BeamCategory,
  questionOrdinal: 0 | 1,
): BeamCase {
  // The pinned BEAM checkout numbers the 100K conversations 1..20.
  const conversationId = `100K/${conversationIndex + 1}`;
  return Object.freeze({
    conversationId,
    category,
    questionOrdinal,
    caseDigest: stableDigest({
      source: BEAM_SOURCE,
      conversationId,
      category,
      questionOrdinal,
    }),
  });
}

export function createBeamInventory(profile: BeamProfile): readonly BeamCase[] {
  const conversations = profile === "score" ? BEAM_CONVERSATION_COUNT : 1;
  const categories = profile === "fixture" ? [BEAM_CATEGORIES[0]!] : BEAM_CATEGORIES;
  const questions = profile === "fixture" || profile === "smoke" ? [0 as const] : ([0, 1] as const);
  const cases: BeamCase[] = [];
  for (let conversation = 0; conversation < conversations; conversation += 1) {
    for (const category of categories) {
      for (const questionOrdinal of questions) {
        cases.push(caseRef(conversation, category, questionOrdinal));
      }
    }
  }
  return Object.freeze(cases);
}

export interface BeamObservation {
  readonly conversationId: string;
  readonly category: BeamCategory;
  readonly score: number;
  readonly response: string;
}

export interface BeamMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly accuracy: number | null;
}

export interface BeamSummary {
  readonly track: "beam-record-core";
  readonly source: typeof BEAM_SOURCE;
  readonly flags: Readonly<{
    partialCreditTruncation: true;
    questionPlaceholderUnexpanded: true;
    paperComparable: false;
  }>;
  readonly categories: Readonly<Record<BeamCategory, BeamMetric | null>>;
}

function summarizeCategory(
  observations: readonly BeamObservation[],
  category: BeamCategory,
): BeamMetric | null {
  const selected = observations.filter(
    (observation) => observation.category === category,
  );
  if (selected.length === 0) return null;
  if (selected.some((observation) => !Number.isFinite(observation.score))) {
    throw new TypeError("BEAM scores must be finite numbers");
  }
  const numerator = selected.reduce(
    (sum, observation) => sum + Math.trunc(observation.score),
    0,
  );
  return Object.freeze({
    numerator,
    denominator: selected.length,
    accuracy: numerator / selected.length,
  });
}

export function summarizeBeamObservations(
  observations: readonly BeamObservation[],
): BeamSummary {
  const categories = Object.fromEntries(
    BEAM_CATEGORIES.map((category) => [
      category,
      summarizeCategory(observations, category),
    ]),
  ) as Record<BeamCategory, BeamMetric | null>;
  return Object.freeze({
    track: "beam-record-core" as const,
    source: BEAM_SOURCE,
    flags: Object.freeze({
      partialCreditTruncation: true as const,
      questionPlaceholderUnexpanded: true as const,
      paperComparable: false as const,
    }),
    categories: Object.freeze(categories),
  });
}

export interface BeamBridgeCommand {
  readonly command: "python3";
  readonly args: readonly string[];
  readonly codeCommit: typeof BEAM_SOURCE.codeCommit;
  readonly dataCommit: typeof BEAM_SOURCE.dataCommit;
}

export function createBeamBridgeCommand(input: {
  readonly cacheRoot: string;
  readonly queryPath: string;
  readonly responsePath: string;
  readonly outputPath: string;
}): BeamBridgeCommand {
  for (const [label, value] of Object.entries(input)) {
    if (!value.startsWith("/")) throw new TypeError(`${label} must be absolute`);
  }
  return Object.freeze({
    command: "python3" as const,
    args: Object.freeze([
      "integrations/beam/bridge.py",
      "--cache-root",
      input.cacheRoot,
      "--query-path",
      input.queryPath,
      "--response-path",
      input.responsePath,
      "--output",
      input.outputPath,
      "--tier",
      BEAM_SOURCE.tier,
    ]),
    codeCommit: BEAM_SOURCE.codeCommit,
    dataCommit: BEAM_SOURCE.dataCommit,
  });
}
