import { isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";

import { stableDigest } from "./identity.ts";
import { putEvidence } from "./evidence.ts";
import { createTrialReceipt, type CandidateTransport, type PrivateArtifactRef, type TrackExecutionResult } from "./eval-core.ts";
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

export const IFEVAL_SMOKE_KEYS = Object.freeze(
  IFEVAL_PILOT_CASES.map((entry) => Number(entry.caseId)),
);

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
  readonly profile?: IfevalProfile;
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
      ...(input.profile === undefined ? [] : ["--profile", input.profile]),
      ...(input.profile === undefined || input.profile === "score"
        ? []
        : ["--keys", IFEVAL_SMOKE_KEYS.join(",")]),
    ]),
    cacheRoot,
    inputPath: sourcePath,
    responsePath: resolve(input.responsePath),
    outputPath: resolve(input.outputPath),
  });
}

const execFileAsync = promisify(execFile);

function artifactFromPath(root: string, path: string, mediaType: string): PrivateArtifactRef {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!isAbsolute(path) || (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`))) {
    throw new TypeError("IFEval artifact must be below EVIDENCE_ROOT");
  }
  const bytes = readFileSync(resolvedPath);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as Sha256Digest;
  return Object.freeze({ path: resolvedPath, digest, mediaType, bytes: bytes.byteLength });
}

function responseText(artifact: PrivateArtifactRef): string {
  const raw = readFileSync(artifact.path, "utf8");
  if (artifact.mediaType === "text/plain") return raw;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === "string") return value;
    if (value !== null && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (typeof record.output_text === "string") return record.output_text;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
    }
    return JSON.stringify(value);
  } catch {
    return raw;
  }
}

export interface IFEvalBridgeRunner {
  readonly run: (input: {
    readonly sourceRoot: string;
    readonly inputData: string;
    readonly responseData: string;
    readonly output: string;
    readonly profile: IfevalProfile;
    readonly keys: readonly number[];
  }) => Promise<void>;
}

function defaultIfevalBridgeRunner(): IFEvalBridgeRunner {
  return {
    run: async (input) => {
      await execFileAsync("python3", [
        "integrations/ifeval/bridge.py",
        "--source-root",
        input.sourceRoot,
        "--input-data",
        input.inputData,
        "--response-data",
        input.responseData,
        "--output",
        input.output,
        "--profile",
        input.profile,
        "--keys",
        input.keys.join(","),
      ]);
    },
  };
}

function metricFromNative(value: unknown, label: string): Readonly<{ numerator: number | null; denominator: number | null; value: number | null }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`IFEval native metric ${label} is invalid`);
  const record = value as Record<string, unknown>;
  const numerator = record.numerator as number;
  const denominator = record.denominator as number;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 0 || denominator < 0) throw new TypeError(`IFEval native metric ${label} counts are invalid`);
  if (numerator > denominator) throw new TypeError(`IFEval native metric ${label} numerator exceeds denominator`);
  const accuracy = record.accuracy;
  if (accuracy !== null && (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1)) throw new TypeError(`IFEval native metric ${label} accuracy is invalid`);
  return Object.freeze({ numerator, denominator, value: accuracy as number | null });
}

export function createIfevalTrackExecutor(input: { readonly bridge?: IFEvalBridgeRunner } = {}): (context: {
  readonly plan: { readonly profile: IfevalProfile; readonly evidenceRoot: string; readonly id: string; readonly trackId: "ifeval" };
  readonly source: { readonly sourceRoot: string };
  readonly candidate: CandidateTransport;
  readonly evidence: (input: { readonly value: unknown; readonly mediaType: string }) => PrivateArtifactRef;
}) => Promise<TrackExecutionResult> {
  return async (context) => {
    const bridge =
      input.bridge ??
      (context.plan.profile === "fixture"
        ? {
            run: async ({ output, keys }: { readonly output: string; readonly keys: readonly number[] }) => {
              mkdirSync(resolve(output, ".."), { recursive: true });
              writeFileSync(
                output,
                JSON.stringify({
                  source: { inputCount: keys.length, keys },
                  metrics: Object.fromEntries(
                    ["strictPrompt", "strictInstruction", "loosePrompt", "looseInstruction"].map((metric) => [metric, { numerator: 0, denominator: keys.length, accuracy: 0 }]),
                  ),
                }),
              );
            },
          }
        : defaultIfevalBridgeRunner());
    const inventory = createIfevalInventory(context.plan.profile);
    const inputData = resolve(context.source.sourceRoot, IFEVAL_SOURCE.dataPath);
    const sourceRows = readFileSync(inputData, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { readonly key: number; readonly prompt: string });
    const sourceByKey = new Map(sourceRows.map((row) => [row.key, row]));
    const responses: string[] = [];
    const trialReceipts = [];
    for (const item of inventory) {
      const sourceRow = sourceByKey.get(Number(item.caseId));
      if (sourceRow === undefined) throw new TypeError(`IFEval source key is missing: ${item.caseId}`);
      const candidate = await context.candidate.run({ caseId: item.caseId, prompt: sourceRow.prompt });
      if (candidate.state !== "measured") {
        return Object.freeze({
          executionStatus: candidate.state === "failed" ? "failed" : "unavailable",
          failureOwner: candidate.failureOwner ?? "candidate",
          trialReceipts: Object.freeze(trialReceipts),
          metrics: Object.freeze({ execution: Object.freeze({ numerator: null, denominator: null, value: null }) }),
          nativeEvidence: context.evidence({ value: { error: candidate.reason }, mediaType: "application/json" }),
          cleanupStatus: "complete" as const,
        });
      }
      if (candidate.output === undefined) throw new TypeError("candidate output artifact is required");
      const response = responseText(candidate.output);
      if (response.length === 0) throw new TypeError("empty IFEval candidate response is invalid");
      responses.push(JSON.stringify({ key: Number(item.caseId), prompt: sourceRow.prompt, response }));
      trialReceipts.push(
        createTrialReceipt({
          runId: context.plan.id,
          trackId: "ifeval",
          trialId: item.caseId,
          executionStatus: "measured",
          host: { id: "eval-owned-runner", isolationClass: "fixture", evidenceRef: stableDigest(context.plan.id) },
          artifacts: { output: candidate.output.digest },
          metrics: null,
          latencyMs: candidate.latencyMs,
          cleanupStatus: "complete",
        }),
      );
    }
    const responseArtifact = putEvidence(context.plan.evidenceRoot, `${responses.join("\n")}\n`, "private");
    const responsePath = responseArtifact.path;
    const nativePath = resolve(context.plan.evidenceRoot, context.plan.id, "ifeval-native.json");
    mkdirSync(resolve(nativePath, ".."), { recursive: true });
    await bridge.run({
      sourceRoot: context.source.sourceRoot,
      inputData,
      responseData: responsePath,
      output: nativePath,
      profile: context.plan.profile,
      keys: inventory.map((item) => Number(item.caseId)),
    });
    const nativeArtifact = artifactFromPath(context.plan.evidenceRoot, nativePath, "application/json");
    const native = JSON.parse(readFileSync(nativeArtifact.path, "utf8")) as Record<string, unknown>;
    const metricsRecord = native.metrics;
    if (metricsRecord === null || typeof metricsRecord !== "object" || Array.isArray(metricsRecord)) throw new TypeError("IFEval native metrics are missing");
    const metrics = Object.freeze({
      strictPrompt: metricFromNative((metricsRecord as Record<string, unknown>).strictPrompt, "strictPrompt"),
      strictInstruction: metricFromNative((metricsRecord as Record<string, unknown>).strictInstruction, "strictInstruction"),
      loosePrompt: metricFromNative((metricsRecord as Record<string, unknown>).loosePrompt, "loosePrompt"),
      looseInstruction: metricFromNative((metricsRecord as Record<string, unknown>).looseInstruction, "looseInstruction"),
    });
    const expectedKeys = inventory.map((item) => Number(item.caseId));
    if (native.source === null || typeof native.source !== "object" || (native.source as Record<string, unknown>).inputCount !== inventory.length) throw new TypeError("IFEval native input census does not match");
    if (JSON.stringify(native.source && (native.source as Record<string, unknown>).keys) !== JSON.stringify(expectedKeys)) throw new TypeError("IFEval native key census does not match");
    return Object.freeze({
      executionStatus: "measured" as const,
      trialReceipts: Object.freeze(trialReceipts),
      metrics,
      nativeEvidence: nativeArtifact,
      cleanupStatus: "complete" as const,
    });
  };
}
