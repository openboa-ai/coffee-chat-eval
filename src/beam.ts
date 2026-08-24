import { stableDigest } from "./identity.ts";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  createTrialReceipt,
  type CandidateTransport,
  type PrivateArtifactRef,
  type TrackExecutionResult,
  type TrialReceipt,
} from "./eval-core.ts";
import type { Sha256Digest } from "./types.ts";
import { fileURLToPath } from "node:url";
import {
  BEAM_RUNTIME_LOCK,
  requireRuntimePython,
  runtimeEnvironment,
} from "./python-runtime.ts";

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
  const questions =
    profile === "fixture" || profile === "smoke" ? [0 as const] : ([0, 1] as const);
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
  readonly command: "uv";
  readonly args: readonly string[];
  readonly codeCommit: typeof BEAM_SOURCE.codeCommit;
  readonly dataCommit: typeof BEAM_SOURCE.dataCommit;
}

export interface BeamBridgeRunner {
  readonly run: (input: {
    readonly sourceRoot: string;
    readonly dataRoot: string | undefined;
    readonly queryPath: string;
    readonly responsePath: string;
    readonly outputPath: string;
    readonly profile: BeamProfile;
    readonly judgeRuntimePath?: string | undefined;
  }) => Promise<void>;
}

export interface BeamConversationLoader {
  readonly load: (input: {
    readonly sourceRoot: string;
    readonly dataRoot?: string;
    readonly conversationId: string;
  }) => Promise<unknown>;
}

function artifactFromPath(
  root: string,
  path: string,
  mediaType: string,
): PrivateArtifactRef {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`))
    throw new TypeError("BEAM native evidence must be below EVIDENCE_ROOT");
  const bytes = readFileSync(resolvedPath);
  return Object.freeze({
    path: resolvedPath,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    mediaType,
    bytes: bytes.byteLength,
  });
}

function defaultBeamBridge(): BeamBridgeRunner {
  return {
    run: async (input) => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)(
        requireRuntimePython(input.sourceRoot),
        [
          fileURLToPath(new URL("../integrations/beam/bridge.py", import.meta.url)),
          "--source-root",
          input.sourceRoot,
          ...(input.dataRoot === undefined ? [] : ["--data-root", input.dataRoot]),
          "--query-path",
          input.queryPath,
          "--response-path",
          input.responsePath,
          "--output",
          input.outputPath,
          "--tier",
          BEAM_SOURCE.tier,
          "--profile",
          input.profile,
          ...(input.judgeRuntimePath === undefined
            ? []
            : ["--judge-runtime", input.judgeRuntimePath]),
        ],
        { env: runtimeEnvironment(input.sourceRoot) },
      );
    },
  };
}

function defaultBeamConversationLoader(sourceRoot: string): BeamConversationLoader {
  return {
    load: async (input) => {
      if (input.dataRoot === undefined) {
        throw new TypeError("BEAM live evaluation requires the pinned 100K data root");
      }
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const result = await promisify(execFile)(
        requireRuntimePython(sourceRoot),
        [
          fileURLToPath(new URL("../integrations/beam/bridge.py", import.meta.url)),
          "--source-root",
          sourceRoot,
          "--data-root",
          input.dataRoot,
          "--conversation-id",
          input.conversationId,
          "--extract-conversation",
        ],
        {
          env: runtimeEnvironment(sourceRoot),
          maxBuffer: 128 * 1024 * 1024,
        },
      );
      try {
        return JSON.parse(result.stdout) as unknown;
      } catch {
        throw new TypeError("BEAM conversation extractor returned invalid JSON");
      }
    },
  };
}

export function createBeamTrackExecutor(
  input: {
    readonly bridge?: BeamBridgeRunner;
    readonly conversationLoader?: BeamConversationLoader;
  } = {},
) {
  return async (context: {
    readonly plan: {
      readonly profile: BeamProfile;
      readonly id: string;
      readonly evidenceRoot: string;
      readonly trackId: "beam-record-core";
    };
    readonly source: { readonly sourceRoot: string; readonly dataRoot?: string };
    readonly candidate: CandidateTransport;
    readonly judge?: unknown;
    readonly runtime?:
      | {
          readonly judge?: {
            readonly endpoint: string;
            readonly capabilityToken: string;
            readonly model: string;
            readonly maxRequests: number;
          };
        }
      | undefined;
    readonly evidence: (input: {
      readonly value: unknown;
      readonly mediaType: string;
    }) => PrivateArtifactRef;
  }): Promise<TrackExecutionResult> => {
    const inventory = createBeamInventory(context.plan.profile);
    const liveBridge = input.bridge === undefined;
    if (
      context.plan.profile !== "fixture" &&
      liveBridge &&
      context.source.dataRoot === undefined
    ) {
      throw new TypeError("BEAM live evaluation requires the pinned 100K data root");
    }
    const conversationLoader =
      input.conversationLoader ??
      (liveBridge
        ? defaultBeamConversationLoader(context.source.sourceRoot)
        : undefined);
    const conversations = new Map<string, unknown>();
    const questionBanks = new Map<
      string,
      Record<
        string,
        readonly { readonly question: string; readonly rubric: readonly string[] }[]
      >
    >();
    const questionBankFor = (conversationId: string) => {
      const cached = questionBanks.get(conversationId);
      if (cached !== undefined) return cached;
      const questionsPath = resolve(
        context.source.sourceRoot,
        "chats",
        conversationId,
        "probing_questions/probing_questions.json",
      );
      const root = resolve(context.source.sourceRoot);
      if (questionsPath !== root && !questionsPath.startsWith(`${root}/`))
        throw new TypeError("BEAM probing questions escape source root");
      const loaded = JSON.parse(readFileSync(questionsPath, "utf8")) as Record<
        string,
        readonly { readonly question: string; readonly rubric: readonly string[] }[]
      >;
      questionBanks.set(conversationId, loaded);
      return loaded;
    };
    const queries: Array<Record<string, unknown>> = [];
    const responses: Record<string, Record<string, Array<Record<string, string>>>> = {};
    const trialReceipts: TrialReceipt[] = [];
    for (const item of inventory) {
      const questionBank = questionBankFor(item.conversationId);
      const entries = questionBank[item.category];
      const question = entries?.[item.questionOrdinal];
      if (question === undefined)
        throw new TypeError(
          `BEAM probing question is missing: ${item.category}/${item.questionOrdinal}`,
        );
      let conversation = conversations.get(item.conversationId);
      if (conversation === undefined) {
        conversation =
          conversationLoader === undefined
            ? { conversationId: item.conversationId }
            : await conversationLoader.load({
                sourceRoot: context.source.sourceRoot,
                ...(context.source.dataRoot === undefined
                  ? {}
                  : { dataRoot: context.source.dataRoot }),
                conversationId: item.conversationId,
              });
        conversations.set(item.conversationId, conversation);
      }
      const candidate = await context.candidate.run({
        conversation,
        question: question.question,
      });
      if (candidate.state !== "measured") {
        return Object.freeze({
          executionStatus: candidate.state === "failed" ? "failed" : "unavailable",
          failureOwner: candidate.failureOwner ?? "candidate",
          trialReceipts: Object.freeze(trialReceipts),
          metrics: Object.freeze({
            execution: Object.freeze({
              numerator: null,
              denominator: null,
              value: null,
            }),
          }),
          nativeEvidence: context.evidence({
            value: { reason: candidate.reason },
            mediaType: "application/json",
          }),
          cleanupStatus: "complete" as const,
        });
      }
      if (candidate.output === undefined)
        throw new TypeError("BEAM candidate output artifact is required");
      const response = readFileSync(candidate.output.path, "utf8");
      const normalized =
        candidate.output.mediaType === "text/plain"
          ? response
          : (() => {
              try {
                const value = JSON.parse(response) as unknown;
                return typeof value === "string" ? value : JSON.stringify(value);
              } catch {
                return response;
              }
            })();
      if (normalized.length === 0)
        throw new TypeError("empty BEAM candidate response is invalid");
      queries.push({
        conversationId: item.conversationId,
        category: item.category,
        questionOrdinal: item.questionOrdinal,
        question: question.question,
      });
      const conversationResponses = (responses[item.conversationId] ??= {});
      (conversationResponses[item.category] ??= []).push({
        question: question.question,
        llm_response: normalized,
      });
      trialReceipts.push(
        createTrialReceipt({
          runId: context.plan.id,
          trackId: "beam-record-core",
          trialId: `${item.conversationId}/${item.category}/${item.questionOrdinal}`,
          executionStatus: "measured",
          host: {
            id: "eval-owned-runner",
            isolationClass: context.plan.profile === "fixture" ? "fixture" : "real",
            evidenceRef: stableDigest(context.plan.id),
          },
          artifacts: { output: candidate.output.digest },
          metrics: null,
          cleanupStatus: "complete",
        }),
      );
    }
    const queryArtifact = context.evidence({
      value: queries,
      mediaType: "application/json",
    });
    const responseArtifact = context.evidence({
      value: responses,
      mediaType: "application/json",
    });
    const outputPath = resolve(
      context.plan.evidenceRoot,
      context.plan.id,
      "beam-native.json",
    );
    mkdirSync(resolve(outputPath, ".."), { recursive: true });
    const bridge = input.bridge ?? defaultBeamBridge();
    const judgeRuntimePath =
      context.runtime?.judge === undefined
        ? undefined
        : context.evidence({
            value: context.runtime.judge,
            mediaType: "application/json",
          }).path;
    if (
      context.plan.profile !== "fixture" &&
      liveBridge &&
      judgeRuntimePath === undefined
    ) {
      throw new TypeError("BEAM live evaluation requires a Judge runtime");
    }
    await bridge.run({
      sourceRoot: context.source.sourceRoot,
      dataRoot: context.source.dataRoot,
      queryPath: queryArtifact.path,
      responsePath: responseArtifact.path,
      outputPath,
      profile: context.plan.profile,
      ...(judgeRuntimePath === undefined ? {} : { judgeRuntimePath }),
    });
    const nativeArtifact = artifactFromPath(
      context.plan.evidenceRoot,
      outputPath,
      "application/json",
    );
    const native = JSON.parse(readFileSync(nativeArtifact.path, "utf8")) as Record<
      string,
      unknown
    >;
    const expectedJudgeCalls = inventory.reduce((count, item) => {
      const questionBank = questionBankFor(item.conversationId);
      return (
        count +
        (questionBank[item.category]?.[item.questionOrdinal]?.rubric.length ?? 0)
      );
    }, 0);
    if (
      native.queryCount !== inventory.length ||
      native.judgeCalls !== expectedJudgeCalls
    )
      throw new TypeError("BEAM native census does not match sampled inventory");
    if (
      native.unusedEmbeddingInitializationBypassed !== true ||
      native.paperComparable !== false
    )
      throw new TypeError("BEAM diagnostic flags are missing");
    if (context.source.dataRoot !== undefined && native.dataFileDigestVerified !== true)
      throw new TypeError("BEAM pinned data digest evidence is missing");
    const categories = native.categories;
    if (
      categories === null ||
      typeof categories !== "object" ||
      Array.isArray(categories)
    )
      throw new TypeError("BEAM native categories are missing");
    const metrics = Object.fromEntries(
      BEAM_CATEGORIES.map((category) => {
        const value = (categories as Record<string, unknown>)[category];
        if (value === null || typeof value !== "object" || Array.isArray(value))
          throw new TypeError(`BEAM category metric is missing: ${category}`);
        const metric = value as Record<string, unknown>;
        const expectedDenominator = inventory.filter(
          (item) => item.category === category,
        ).length;
        const accuracyValid =
          expectedDenominator === 0
            ? metric.accuracy === null
            : typeof metric.accuracy === "number";
        if (
          metric.denominator !== expectedDenominator ||
          typeof metric.numerator !== "number" ||
          !accuracyValid
        )
          throw new TypeError(`BEAM category denominator is invalid: ${category}`);
        return [
          category,
          {
            numerator: metric.numerator,
            denominator: metric.denominator,
            value: metric.accuracy,
          },
        ];
      }),
    ) as TrackExecutionResult["metrics"];
    return Object.freeze({
      executionStatus: "measured" as const,
      trialReceipts: Object.freeze(trialReceipts),
      metrics: Object.freeze(metrics),
      nativeEvidence: nativeArtifact,
      cleanupStatus: "complete" as const,
    });
  };
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
    command: "uv" as const,
    args: Object.freeze([
      "run",
      "--offline",
      "--no-project",
      "--with-requirements",
      BEAM_RUNTIME_LOCK,
      "python",
      fileURLToPath(new URL("../integrations/beam/bridge.py", import.meta.url)),
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
