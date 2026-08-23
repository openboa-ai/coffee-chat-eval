import { stableDigest } from "./identity.ts";
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
    familyId: string,
    condition: TasteCondition,
  ) => Promise<unknown>;
  readonly evaluateSubmission: (input: unknown) => Promise<unknown>;
  /** Materializes the sealed family oracle without returning rubric bytes. */
  readonly evaluateCaseFamily: (
    familyId: string,
    submissionDigests: readonly Sha256Digest[],
  ) => Promise<unknown>;
}

export interface TasteJudge {
  readonly model: string;
  readonly evaluate: (request: {
    readonly familyDigest: Sha256Digest;
    readonly kind: "pointwise" | "pairwise";
    readonly submissionDigests: readonly Sha256Digest[];
  }) => Promise<
    | { readonly state: "measured"; readonly verdict: string }
    | {
        readonly state: Exclude<
          "unmeasured" | "unavailable" | "failed" | "invalid",
          "measured"
        >;
        readonly reason: string;
      }
  >;
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
  readonly api: TasteBenchApi;
  readonly judge: TasteJudge;
}): Promise<TasteExecutionSummary> {
  const inventory = createTasteInventory(input.profile);
  const families = inventory.families;
  if (input.judge.model.length === 0) {
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
  let submissions = 0;
  let judgeCalls = 0;
  let phase: "source" | "candidate" | "adapter" | "judge" = "source";
  try {
    for (const family of families) {
      const outputs: Sha256Digest[] = [];
      for (const condition of TASTE_CONDITIONS) {
        phase = "source";
        const benchmarkInput = await input.api.getBenchmarkInput(
          family.familyId,
          condition,
        );
        phase = "candidate";
        const output = await input.api.evaluateSubmission(benchmarkInput);
        outputs.push(stableDigest(output));
        submissions += 1;
      }
      // The family-level native API owns rubric/oracle construction. Its
      // return value is deliberately discarded; only the sealed Judge broker
      // receives opaque output digests below.
      phase = "adapter";
      await input.api.evaluateCaseFamily(family.familyId, outputs);
      const plan = createTasteJudgePlan(family.familyId);
      for (const kind of [
        ...plan.pointwiseCalls.map(() => "pointwise" as const),
        ...plan.pairwiseCalls.map(() => "pairwise" as const),
      ]) {
        // Candidate prose, condition labels, and rubric bytes remain sealed in
        // the adapter/Judge broker. Only opaque output digests cross this API.
        phase = "judge";
        const verdict = await input.judge.evaluate({
          familyDigest: family.familyDigest,
          kind,
          submissionDigests: outputs,
        });
        if (verdict.state !== "measured") {
          return Object.freeze({
            track: "coffee-chat-taste" as const,
            executionStatus:
              verdict.state === "failed"
                ? ("failed" as const)
                : verdict.state === "invalid"
                  ? ("invalid" as const)
                  : verdict.state === "unmeasured"
                    ? ("unmeasured" as const)
                    : ("unavailable" as const),
            failureOwner: "judge" as const,
            claimStatus: executionClaimStatus(input.profile),
            benchmarkStatus: "not_active" as const,
            submissions,
            judgeCalls,
            score: null,
          });
        }
        judgeCalls += 1;
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
      submissions,
      judgeCalls,
      score: null,
    });
  }
  return Object.freeze({
    track: "coffee-chat-taste" as const,
    executionStatus: "measured" as const,
    claimStatus: executionClaimStatus(input.profile),
    benchmarkStatus: "not_active" as const,
    submissions,
    judgeCalls,
    score: null,
  });
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
