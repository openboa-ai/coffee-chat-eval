import { stableDigest } from "./identity.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { CandidateTransport, JudgeTransport, PrivateArtifactRef, TrackExecutionResult, TrialReceipt } from "./eval-core.ts";
import { createTrialReceipt } from "./eval-core.ts";
import type { Sha256Digest } from "./types.ts";

export type TasteProfile = "fixture" | "smoke" | "pilot" | "score";
export type TasteCondition = "unconditioned" | "target_a" | "target_b";

export const TASTE_SOURCE = Object.freeze({
  repository: "https://github.com/openboa-ai/coffee-chat-bench",
  commit: "43d3350be9e7aa2498b7843dad3a956728fe5d54",
  license: "MIT",
});

export const TASTE_FAMILY_COUNT = 32;
export const TASTE_CONDITIONS = Object.freeze([
  "unconditioned",
  "target_a",
  "target_b",
] as const);
export const TASTE_SUBMISSION_COUNT = TASTE_FAMILY_COUNT * TASTE_CONDITIONS.length;
export const TASTE_POINTWISE_CALLS_PER_FAMILY = 13;
export const TASTE_PAIRWISE_CALLS_PER_FAMILY = 8;
export const TASTE_JUDGE_CALLS =
  TASTE_FAMILY_COUNT *
  (TASTE_POINTWISE_CALLS_PER_FAMILY + TASTE_PAIRWISE_CALLS_PER_FAMILY);

export interface TasteFamily {
  readonly familyId: string;
  readonly ordinal: number;
  readonly familyDigest: Sha256Digest;
}

export interface TasteSubmission {
  readonly submissionId: string;
  readonly familyId: string;
  readonly condition: TasteCondition;
  readonly candidateInputDigest: Sha256Digest;
}

export interface TasteInventory {
  readonly families: readonly TasteFamily[];
  readonly conditions: readonly TasteCondition[];
  readonly submissions: readonly TasteSubmission[];
  readonly judgeCalls: number;
  readonly pointwiseCalls: number;
  readonly pairwiseCalls: number;
  readonly claimStatus: "calibration" | "pilot" | "provisional_internal";
  readonly benchmarkStatus: "not_active";
}

function familiesFor(profile: TasteProfile): readonly TasteFamily[] {
  const count = profile === "fixture" || profile === "smoke" || profile === "pilot" ? 1 : TASTE_FAMILY_COUNT;
  return Object.freeze(
    Array.from({ length: count }, (_, ordinal) => {
      const familyId = `family-${String(ordinal).padStart(2, "0")}`;
      return Object.freeze({
        familyId,
        ordinal,
        familyDigest: stableDigest({ source: TASTE_SOURCE, familyId }),
      });
    }),
  );
}

export function createTasteInventory(profile: TasteProfile): TasteInventory {
  const families = familiesFor(profile);
  const conditions = TASTE_CONDITIONS;
  const submissions = families.flatMap((family) =>
    conditions.map((condition) =>
      Object.freeze({
        submissionId: `${family.familyId}/${condition}`,
        familyId: family.familyId,
        condition,
        candidateInputDigest: stableDigest({
          source: TASTE_SOURCE,
          familyId: family.familyId,
          condition,
        }),
      }),
    ),
  );
  const familyCount = families.length;
  const pointwiseCalls = familyCount * TASTE_POINTWISE_CALLS_PER_FAMILY;
  const pairwiseCalls = familyCount * TASTE_PAIRWISE_CALLS_PER_FAMILY;
  return Object.freeze({
    families,
    conditions,
    submissions: Object.freeze(submissions),
    judgeCalls: pointwiseCalls + pairwiseCalls,
    pointwiseCalls,
    pairwiseCalls,
    claimStatus:
      profile === "fixture" || profile === "smoke"
        ? "calibration"
        : profile === "pilot"
          ? "pilot"
          : "provisional_internal",
    benchmarkStatus: "not_active" as const,
  });
}

export interface TasteJudgePlan {
  readonly familyId: string;
  readonly pointwiseCalls: readonly string[];
  readonly pairwiseCalls: readonly string[];
  readonly totalCalls: 21;
}

export function createTasteJudgePlan(familyId: string): TasteJudgePlan {
  if (familyId.length === 0) throw new TypeError("familyId must not be empty");
  return Object.freeze({
    familyId,
    pointwiseCalls: Object.freeze(
      Array.from(
        { length: TASTE_POINTWISE_CALLS_PER_FAMILY },
        (_, index) => `${familyId}/pointwise-${String(index).padStart(2, "0")}`,
      ),
    ),
    pairwiseCalls: Object.freeze(
      Array.from(
        { length: TASTE_PAIRWISE_CALLS_PER_FAMILY },
        (_, index) => `${familyId}/pairwise-${String(index).padStart(2, "0")}`,
      ),
    ),
    totalCalls: 21 as const,
  });
}

export const TASTE_JUDGE_MODEL = "gpt-5.6-luna" as const;

export interface TasteBenchApi {
  readonly getBenchmarkInput: (
    manifest: unknown,
    condition: TasteCondition,
  ) => unknown;
  readonly evaluateSubmission: (input: {
    readonly input: unknown;
    readonly submission: CandidateSubmission;
    readonly transport: TasteNativeJudgeTransport;
  }) => Promise<unknown>;
  readonly evaluateCaseFamily: (input: {
    readonly manifest: unknown;
    readonly submissions: Readonly<
      Partial<Record<TasteCondition, CandidateSubmission>>
    >;
    readonly transport: TasteNativeJudgeTransport;
  }) => Promise<unknown>;
}

export interface TasteNativeJudgeTransport {
  readonly complete: (request: unknown) => Promise<{
    readonly raw: string;
    readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  }>;
}

export interface CandidateArtifact {
  readonly mediaType: "text/plain";
  readonly content: string;
}

export interface DecisionRecord {
  readonly decision: string;
  readonly evidenceUse: readonly { readonly sourceId: string; readonly use: string }[];
  readonly tradeoffs: readonly { readonly factors: readonly [string, string]; readonly resolution: string }[];
  readonly constraints: readonly { readonly constraint: string; readonly handling: string }[];
  readonly uncertainty: string | null;
}

export interface CandidateSubmission {
  readonly artifact: CandidateArtifact;
  readonly decisionRecord: DecisionRecord;
}

function readArtifactText(artifact: PrivateArtifactRef): string {
  return readFileSync(artifact.path, "utf8");
}

function parseCandidateSubmission(artifact: PrivateArtifactRef): CandidateSubmission {
  const raw = readArtifactText(artifact);
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("Taste candidate output must be structured CandidateSubmission JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Taste candidate submission must be an object");
  const record = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(["artifact", "decisionRecord"])) throw new TypeError("Taste candidate submission has unexpected fields");
  const rawArtifact = record.artifact;
  const rawDecision = record.decisionRecord;
  if (rawArtifact === null || typeof rawArtifact !== "object" || Array.isArray(rawArtifact)) throw new TypeError("Taste candidate artifact is invalid");
  const artifactRecord = rawArtifact as Record<string, unknown>;
  if (artifactRecord.mediaType !== "text/plain" || typeof artifactRecord.content !== "string" || artifactRecord.content.trim().length === 0) throw new TypeError("Taste candidate artifact is invalid");
  if (rawDecision === null || typeof rawDecision !== "object" || Array.isArray(rawDecision)) throw new TypeError("Taste decision record is invalid");
  const decisionRecord = rawDecision as Record<string, unknown>;
  if (JSON.stringify(Object.keys(decisionRecord).sort()) !== JSON.stringify(["constraints", "decision", "evidenceUse", "tradeoffs", "uncertainty"])) throw new TypeError("Taste decision record has unexpected fields");
  if (typeof decisionRecord.decision !== "string" || decisionRecord.decision.trim().length === 0) throw new TypeError("Taste decision is invalid");
  if (decisionRecord.uncertainty !== null && typeof decisionRecord.uncertainty !== "string") throw new TypeError("Taste uncertainty is invalid");
  const evidenceUse = decisionRecord.evidenceUse;
  const tradeoffs = decisionRecord.tradeoffs;
  const constraints = decisionRecord.constraints;
  if (!Array.isArray(evidenceUse) || !Array.isArray(tradeoffs) || !Array.isArray(constraints)) throw new TypeError("Taste decision arrays are invalid");
  return Object.freeze({
    artifact: Object.freeze({ mediaType: "text/plain" as const, content: artifactRecord.content }),
    decisionRecord: Object.freeze({
      decision: decisionRecord.decision,
      evidenceUse: Object.freeze(evidenceUse.map((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Taste evidenceUse entry is invalid");
        const value = entry as Record<string, unknown>;
        if (typeof value.sourceId !== "string" || typeof value.use !== "string") throw new TypeError("Taste evidenceUse entry is invalid");
        return Object.freeze({ sourceId: value.sourceId, use: value.use });
      })),
      tradeoffs: Object.freeze(tradeoffs.map((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Taste tradeoff is invalid");
        const value = entry as Record<string, unknown>;
        if (!Array.isArray(value.factors) || value.factors.length !== 2 || value.factors.some((factor) => typeof factor !== "string") || typeof value.resolution !== "string") throw new TypeError("Taste tradeoff is invalid");
        return Object.freeze({ factors: Object.freeze([value.factors[0] as string, value.factors[1] as string]) as readonly [string, string], resolution: value.resolution });
      })),
      constraints: Object.freeze(constraints.map((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Taste constraint is invalid");
        const value = entry as Record<string, unknown>;
        if (typeof value.constraint !== "string" || typeof value.handling !== "string") throw new TypeError("Taste constraint is invalid");
        return Object.freeze({ constraint: value.constraint, handling: value.handling });
      })),
      uncertainty: decisionRecord.uncertainty as string | null,
    }),
  });
}

export interface TasteExecutionSummary {
  readonly track: "coffee-chat-taste";
  readonly executionStatus:
    "measured" | "unmeasured" | "unavailable" | "failed" | "invalid";
  readonly failureOwner?: "source" | "candidate" | "adapter" | "judge";
  readonly claimStatus: "calibration" | "pilot" | "provisional_internal";
  readonly benchmarkStatus: "not_active";
  readonly submissions: number;
  readonly judgeCalls: number;
  readonly score: null;
  readonly nativeEvaluation?: unknown;
  readonly candidateArtifacts?: readonly PrivateArtifactRef[];
}

function executionClaimStatus(
  profile: "fixture" | "smoke" | "pilot" | "score",
): "calibration" | "pilot" | "provisional_internal" {
  return profile === "fixture" || profile === "smoke"
    ? "calibration"
    : profile === "pilot"
      ? "pilot"
      : "provisional_internal";
}

export async function executeTasteBench(input: {
  readonly profile: "fixture" | "smoke" | "pilot" | "score";
  readonly manifest: unknown;
  readonly api: TasteBenchApi;
  readonly candidate: CandidateTransport;
  readonly judge: JudgeTransport;
}): Promise<TasteExecutionSummary> {
  const inventory = createTasteInventory(input.profile);
  const families = inventory.families;
  if (input.judge === undefined) {
    return Object.freeze({
      track: "coffee-chat-taste" as const,
      executionStatus: "unavailable" as const,
      failureOwner: "judge" as const,
      claimStatus: executionClaimStatus(input.profile),
      benchmarkStatus: "not_active" as const,
      submissions: 0,
      judgeCalls: 0,
      score: null,
    });
  }
  let submissionCount = 0;
  let judgeCalls = 0;
  let phase: "source" | "candidate" | "adapter" | "judge" = "source";
  const candidateArtifacts: PrivateArtifactRef[] = [];
  let nativeEvaluation: unknown;
  try {
    for (const family of families) {
      const submissions: Partial<Record<TasteCondition, CandidateSubmission>> = {};
      for (const condition of TASTE_CONDITIONS) {
        phase = "source";
        const benchmarkInput = input.api.getBenchmarkInput(input.manifest, condition);
        phase = "candidate";
        const output = await input.candidate.run({ familyId: family.familyId, condition, benchmarkInput });
        if (output.state !== "measured") {
          return Object.freeze({
            track: "coffee-chat-taste" as const,
            executionStatus: output.state === "failed" ? "failed" : "unavailable",
            failureOwner: output.failureOwner === "source" ? "source" : "candidate",
            claimStatus: executionClaimStatus(input.profile),
            benchmarkStatus: "not_active" as const,
            submissions: submissionCount,
            judgeCalls,
            score: null,
          });
        }
        const parsed = parseCandidateSubmission(output.output);
        submissions[condition] = parsed;
        candidateArtifacts.push(output.output);
        submissionCount += 1;
      }
      // The family-level native API owns rubric/oracle construction. Its
      // return value is deliberately discarded; only the sealed Judge broker
      // receives opaque output digests below.
      phase = "adapter";
      const judgeTransport: TasteNativeJudgeTransport = {
        complete: async (request) => {
          phase = "judge";
          const verdict = await input.judge.evaluate(request);
          if (verdict.state !== "measured" || verdict.verdict === undefined) {
            throw new Error(verdict.state === "measured" ? "judge returned no private verdict artifact" : verdict.reason);
          }
          judgeCalls += 1;
          return { raw: readArtifactText(verdict.verdict), metadata: { digest: verdict.verdict.digest } };
        },
      };
      nativeEvaluation = await input.api.evaluateCaseFamily({ manifest: input.manifest, submissions, transport: judgeTransport });
      if (judgeCalls !== 21 * (family.ordinal + 1)) {
        // The native evaluator must own the exact 13 pointwise + 8 mirrored
        // pairwise call count; any other count is an adapter error.
        throw new TypeError("Taste native Judge call census does not match 13+8");
      }
    }
  } catch (error) {
    const owner = phase;
    return Object.freeze({
      track: "coffee-chat-taste" as const,
      executionStatus:
        owner === "candidate" || owner === "adapter"
          ? ("failed" as const)
          : ("unavailable" as const),
      failureOwner: owner,
      claimStatus: executionClaimStatus(input.profile),
      benchmarkStatus: "not_active" as const,
      submissions: submissionCount,
      judgeCalls,
      score: null,
      candidateArtifacts: Object.freeze(candidateArtifacts),
      nativeEvaluation,
    });
  }
  return Object.freeze({
    track: "coffee-chat-taste" as const,
    executionStatus: "measured" as const,
    claimStatus: executionClaimStatus(input.profile),
    benchmarkStatus: "not_active" as const,
    submissions: submissionCount,
    judgeCalls,
    score: null,
    candidateArtifacts: Object.freeze(candidateArtifacts),
    nativeEvaluation,
  });
}

export function createTasteTrackExecutor(options: { readonly api?: TasteBenchApi } = {}) {
  return async (context: {
    readonly plan: { readonly profile: TasteProfile; readonly id: string; readonly evidenceRoot: string; readonly trackId: "coffee-chat-taste" };
    readonly manifest: unknown;
    readonly source: { readonly sourceRoot: string };
    readonly candidate: CandidateTransport;
    readonly judge: JudgeTransport | undefined;
    readonly evidence: (input: { readonly value: unknown; readonly mediaType: string }) => PrivateArtifactRef;
  }): Promise<TrackExecutionResult> => {
    if (context.judge === undefined) {
      return Object.freeze({
        executionStatus: "unavailable" as const,
        failureOwner: "judge" as const,
        trialReceipts: Object.freeze([]),
        metrics: Object.freeze({ pointwiseCalls: Object.freeze({ numerator: null, denominator: null, value: null }), pairwiseCalls: Object.freeze({ numerator: null, denominator: null, value: null }) }),
        nativeEvidence: context.evidence({ value: { reason: "Taste Judge capability is missing" }, mediaType: "application/json" }),
        cleanupStatus: "complete" as const,
      });
    }
    let api = options.api;
    if (api === undefined && context.plan.profile === "fixture") {
      api = {
        getBenchmarkInput: (_manifest, condition) => ({ condition, fixture: true }),
        evaluateSubmission: async () => ({ state: "measured" }),
        evaluateCaseFamily: async ({ transport }) => {
          for (let index = 0; index < 21; index += 1) await transport.complete({ kind: index < 13 ? "pointwise" : "pairwise", index });
          return { state: "measured", replay: true };
        },
      };
    }
    if (api === undefined) {
      api = (await import(resolve(context.source.sourceRoot, "src/evaluator.ts"))) as TasteBenchApi;
    }
    const summary = await executeTasteBench({ profile: context.plan.profile, manifest: context.manifest, api, candidate: context.candidate, judge: context.judge });
    const metrics = Object.freeze({
      pointwiseCalls: Object.freeze({ numerator: summary.judgeCalls >= 13 ? 13 : summary.judgeCalls, denominator: 13, value: null }),
      pairwiseCalls: Object.freeze({ numerator: summary.judgeCalls >= 21 ? 8 : Math.max(0, summary.judgeCalls - 13), denominator: 8, value: null }),
    });
    const trialReceipts: TrialReceipt[] = [];
    for (const [index, artifact] of (summary.candidateArtifacts ?? []).entries()) {
      trialReceipts.push(createTrialReceipt({
        runId: context.plan.id,
        trackId: "coffee-chat-taste",
        trialId: `family-00/${TASTE_CONDITIONS[index % 3]}`,
        executionStatus: summary.executionStatus === "measured" ? "measured" : summary.executionStatus,
        ...(summary.executionStatus === "measured" ? {} : { failureOwner: summary.failureOwner === "judge" ? "judge" as const : "candidate" as const }),
        host: { id: "eval-owned-runner", isolationClass: "fixture", evidenceRef: stableDigest(context.plan.id) },
        artifacts: { output: artifact.digest },
        metrics: null,
        cleanupStatus: "complete",
      }));
    }
    return Object.freeze({
      executionStatus: summary.executionStatus,
      ...(summary.failureOwner === undefined ? {} : { failureOwner: summary.failureOwner }),
      trialReceipts: Object.freeze(trialReceipts),
      metrics,
      nativeEvidence: context.evidence({ value: { schema: "coffee-chat-eval/taste-native-v1", summary }, mediaType: "application/json" }),
      cleanupStatus: "complete" as const,
    });
  };
}

export interface TasteBridgeCommand {
  readonly command: "node";
  readonly args: readonly string[];
  readonly sourceCommit: typeof TASTE_SOURCE.commit;
  readonly judgeModel: typeof TASTE_JUDGE_MODEL;
}

export function createTasteBridgeCommand(input: {
  readonly cacheRoot: string;
  readonly evidenceRoot: string;
  readonly candidateConfigPath: string;
}): TasteBridgeCommand {
  for (const [label, value] of Object.entries(input)) {
    if (!value.startsWith("/")) throw new TypeError(`${label} must be absolute`);
  }
  return Object.freeze({
    command: "node" as const,
    args: Object.freeze([
      "--experimental-strip-types",
      "integrations/bench/bridge.ts",
      "--cache-root",
      input.cacheRoot,
      "--evidence-root",
      input.evidenceRoot,
      "--candidate-config",
      input.candidateConfigPath,
      "--bench-commit",
      TASTE_SOURCE.commit,
      "--judge-model",
      TASTE_JUDGE_MODEL,
    ]),
    sourceCommit: TASTE_SOURCE.commit,
    judgeModel: TASTE_JUDGE_MODEL,
  });
}
