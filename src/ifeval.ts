import { isAbsolute, resolve } from "node:path";

import { stableDigest } from "./identity.ts";
import type { Sha256Digest } from "./types.ts";

export type IfevalProfile = "fixture" | "smoke" | "pilot" | "score";

export const IFEVAL_SOURCE = Object.freeze({
  repository: "https://github.com/google-research/google-research",
  commit: "e6890f85757dd84e27ca6df2dd30651dafad28e0",
  dataPath: "instruction_following_eval/data/input_data.jsonl",
  excludedPaths: Object.freeze([
    "instruction_following_eval/data/input_response_data_gpt4_20231107_145030.jsonl",
  ]),
  license: "Apache-2.0",
});

export const IFEVAL_PROMPT_COUNT = 541;

export const IFEVAL_TOP_LEVEL_FAMILIES = Object.freeze([
  "punctuation",
  "detectable_format",
  "length_constraints",
  "detectable_content",
  "combination",
  "change_case",
  "startend",
  "keywords",
  "language",
] as const);

export type IfevalFamily = (typeof IFEVAL_TOP_LEVEL_FAMILIES)[number];

export const IFEVAL_PILOT_CASES = Object.freeze([
  Object.freeze({ family: "punctuation" as const, caseId: "1000" }),
  Object.freeze({ family: "detectable_format" as const, caseId: "1012" }),
  Object.freeze({ family: "length_constraints" as const, caseId: "1069" }),
  Object.freeze({ family: "detectable_content" as const, caseId: "1005" }),
  Object.freeze({ family: "combination" as const, caseId: "1098" }),
  Object.freeze({ family: "change_case" as const, caseId: "1019" }),
  Object.freeze({ family: "startend" as const, caseId: "1040" }),
  Object.freeze({ family: "keywords" as const, caseId: "1122" }),
  Object.freeze({ family: "language" as const, caseId: "1108" }),
] as const);

export interface IfevalCase {
  readonly caseId: string;
  readonly ordinal: number;
  readonly sourcePath: typeof IFEVAL_SOURCE.dataPath;
  readonly caseDigest: Sha256Digest;
  readonly pilotFamilies: readonly IfevalFamily[];
}

function caseRef(
  caseId: string,
  ordinal: number,
  families: readonly IfevalFamily[] = [],
): IfevalCase {
  return Object.freeze({
    caseId,
    ordinal,
    sourcePath: IFEVAL_SOURCE.dataPath,
    caseDigest: stableDigest({
      source: IFEVAL_SOURCE,
      caseId,
      ordinal,
    }),
    pilotFamilies: Object.freeze([...families]),
  });
}

export function createIfevalInventory(profile: IfevalProfile): readonly IfevalCase[] {
  if (profile === "fixture") {
    const first = IFEVAL_PILOT_CASES[0]!;
    return Object.freeze([caseRef(first.caseId, 0, [first.family])]);
  }
  if (profile === "smoke" || profile === "pilot") {
    return Object.freeze(
      IFEVAL_PILOT_CASES.map((entry, ordinal) =>
        caseRef(entry.caseId, ordinal, [entry.family]),
      ),
    );
  }
  return Object.freeze(
    Array.from({ length: IFEVAL_PROMPT_COUNT }, (_, ordinal) =>
      caseRef(`official-index-${String(ordinal).padStart(4, "0")}`, ordinal),
    ),
  );
}

export interface IfevalObservation {
  readonly caseId: string;
  readonly strictPrompt: boolean;
  readonly strictInstructions: readonly boolean[];
  readonly loosePrompt: boolean;
  readonly looseInstructions: readonly boolean[];
}

export interface IfevalMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly accuracy: number | null;
}

export interface IfevalSummary {
  readonly track: "ifeval";
  readonly sourceCommit: typeof IFEVAL_SOURCE.commit;
  readonly metrics: Readonly<{
    strictPrompt: IfevalMetric;
    strictInstruction: IfevalMetric;
    loosePrompt: IfevalMetric;
    looseInstruction: IfevalMetric;
  }>;
}

function metric(numerator: number, denominator: number): IfevalMetric {
  return Object.freeze({
    numerator,
    denominator,
    accuracy: denominator === 0 ? null : numerator / denominator,
  });
}

export function summarizeIfevalObservations(
  observations: readonly IfevalObservation[],
): IfevalSummary {
  let strictPromptNumerator = 0;
  let strictInstructionNumerator = 0;
  let strictInstructionDenominator = 0;
  let loosePromptNumerator = 0;
  let looseInstructionNumerator = 0;
  let looseInstructionDenominator = 0;
  for (const observation of observations) {
    if (observation.strictPrompt) strictPromptNumerator += 1;
    strictInstructionNumerator += observation.strictInstructions.filter(Boolean).length;
    strictInstructionDenominator += observation.strictInstructions.length;
    if (observation.loosePrompt) loosePromptNumerator += 1;
    looseInstructionNumerator += observation.looseInstructions.filter(Boolean).length;
    looseInstructionDenominator += observation.looseInstructions.length;
  }
  return Object.freeze({
    track: "ifeval" as const,
    sourceCommit: IFEVAL_SOURCE.commit,
    metrics: Object.freeze({
      strictPrompt: metric(strictPromptNumerator, observations.length),
      strictInstruction: metric(
        strictInstructionNumerator,
        strictInstructionDenominator,
      ),
      loosePrompt: metric(loosePromptNumerator, observations.length),
      looseInstruction: metric(looseInstructionNumerator, looseInstructionDenominator),
    }),
  });
}

export interface IfevalBridgeCommand {
  readonly command: "python3";
  readonly args: readonly string[];
  readonly cacheRoot: string;
  readonly inputPath: string;
  readonly responsePath: string;
  readonly outputPath: string;
}

export function createIfevalBridgeCommand(input: {
  readonly cacheRoot: string;
  readonly inputPath: string;
  readonly responsePath: string;
  readonly outputPath: string;
}): IfevalBridgeCommand {
  for (const [label, value] of Object.entries(input)) {
    if (!isAbsolute(value)) throw new TypeError(`${label} must be absolute`);
  }
  const cacheRoot = resolve(input.cacheRoot);
  const sourcePath = resolve(input.inputPath);
  if (sourcePath.includes("input_response_data_gpt4")) {
    throw new TypeError("historical IFEval responses are excluded");
  }
  return Object.freeze({
    command: "python3" as const,
    args: Object.freeze([
      "integrations/ifeval/bridge.py",
      "--source-root",
      cacheRoot,
      "--input-data",
      sourcePath,
      "--response-data",
      resolve(input.responsePath),
      "--output",
      resolve(input.outputPath),
    ]),
    cacheRoot,
    inputPath: sourcePath,
    responsePath: resolve(input.responsePath),
    outputPath: resolve(input.outputPath),
  });
}
