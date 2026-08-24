import { stableDigest } from "./identity.ts";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireRuntimePython, runtimeEnvironment } from "./python-runtime.ts";
import type {
  CandidateTransport,
  PrivateArtifactRef,
  TrackExecutionResult,
  TrialReceipt,
} from "./eval-core.ts";
import { createTrialReceipt } from "./eval-core.ts";
import type { ExecutionStatus, FailureOwner, Sha256Digest } from "./types.ts";

export type AgentDojoProfile = "fixture" | "smoke" | "pilot" | "score";
export type AgentDojoEpisodeKind = "benign" | "injection-control" | "attacked";

export const AGENTDOJO_SOURCE = Object.freeze({
  repository: "https://github.com/ethz-spylab/agentdojo",
  commit: "a75aba7631d3ca5fb7ab938965c97ead2f9ff84b",
  packageVersion: "0.1.35",
  benchmarkVersion: "v1.2.2",
  license: "MIT",
});

export const AGENTDOJO_ATTACK = "important_instructions_no_model_name" as const;
export const AGENTDOJO_DEFENSE = "None" as const;

function sequentialTaskIds(
  kind: "user" | "injection",
  first: number,
  count: number,
): readonly string[] {
  return Object.freeze(
    Array.from({ length: count }, (_, index) => `${kind}_task_${first + index}`),
  );
}

/** Exact task-ID sets admitted from AgentDojo v1.2.2, in Eval-stable order. */
export const AGENTDOJO_SUITE_TASK_IDS = Object.freeze({
  workspace: Object.freeze({
    userTasks: sequentialTaskIds("user", 0, 40),
    injectionTasks: sequentialTaskIds("injection", 0, 14),
  }),
  travel: Object.freeze({
    userTasks: sequentialTaskIds("user", 0, 20),
    injectionTasks: sequentialTaskIds("injection", 0, 7),
  }),
  banking: Object.freeze({
    userTasks: sequentialTaskIds("user", 0, 16),
    injectionTasks: sequentialTaskIds("injection", 0, 9),
  }),
  slack: Object.freeze({
    userTasks: sequentialTaskIds("user", 0, 21),
    injectionTasks: sequentialTaskIds("injection", 1, 5),
  }),
});
export type AgentDojoSuite = keyof typeof AGENTDOJO_SUITE_TASK_IDS;

export const AGENTDOJO_SUITE_COUNTS = Object.freeze({
  workspace: Object.freeze({
    userTasks: AGENTDOJO_SUITE_TASK_IDS.workspace.userTasks.length,
    injectionTasks: AGENTDOJO_SUITE_TASK_IDS.workspace.injectionTasks.length,
  }),
  travel: Object.freeze({
    userTasks: AGENTDOJO_SUITE_TASK_IDS.travel.userTasks.length,
    injectionTasks: AGENTDOJO_SUITE_TASK_IDS.travel.injectionTasks.length,
  }),
  banking: Object.freeze({
    userTasks: AGENTDOJO_SUITE_TASK_IDS.banking.userTasks.length,
    injectionTasks: AGENTDOJO_SUITE_TASK_IDS.banking.injectionTasks.length,
  }),
  slack: Object.freeze({
    userTasks: AGENTDOJO_SUITE_TASK_IDS.slack.userTasks.length,
    injectionTasks: AGENTDOJO_SUITE_TASK_IDS.slack.injectionTasks.length,
  }),
});

export const AGENTDOJO_TOTAL_USER_TASKS = Object.values(AGENTDOJO_SUITE_COUNTS).reduce(
  (sum, suite) => sum + suite.userTasks,
  0,
);
export const AGENTDOJO_TOTAL_INJECTION_TASKS = Object.values(
  AGENTDOJO_SUITE_COUNTS,
).reduce((sum, suite) => sum + suite.injectionTasks, 0);
export const AGENTDOJO_TOTAL_PAIRS = Object.values(AGENTDOJO_SUITE_COUNTS).reduce(
  (sum, suite) => sum + suite.userTasks * suite.injectionTasks,
  0,
);
export const AGENTDOJO_TOTAL_EPISODES =
  AGENTDOJO_TOTAL_USER_TASKS + AGENTDOJO_TOTAL_INJECTION_TASKS + AGENTDOJO_TOTAL_PAIRS;

export interface AgentDojoEpisode {
  readonly suite: AgentDojoSuite;
  readonly kind: AgentDojoEpisodeKind;
  readonly userTaskId: string | null;
  readonly injectionTaskId: string | null;
  readonly episodeDigest: Sha256Digest;
}

function episode(
  suite: AgentDojoSuite,
  kind: AgentDojoEpisodeKind,
  userTaskId: string | null,
  injectionTaskId: string | null,
): AgentDojoEpisode {
  return Object.freeze({
    suite,
    kind,
    userTaskId,
    injectionTaskId,
    episodeDigest: stableDigest({
      source: AGENTDOJO_SOURCE,
      attack: AGENTDOJO_ATTACK,
      defense: AGENTDOJO_DEFENSE,
      suite,
      kind,
      userTaskId,
      injectionTaskId,
    }),
  });
}

function suiteEpisodes(
  suite: AgentDojoSuite,
  userTasks: readonly string[],
  injectionTasks: readonly string[],
): AgentDojoEpisode[] {
  const episodes: AgentDojoEpisode[] = [];
  for (const userTaskId of userTasks) {
    episodes.push(episode(suite, "benign", userTaskId, null));
  }
  for (const injectionTaskId of injectionTasks) {
    episodes.push(episode(suite, "injection-control", null, injectionTaskId));
  }
  for (const userTaskId of userTasks) {
    for (const injectionTaskId of injectionTasks) {
      episodes.push(episode(suite, "attacked", userTaskId, injectionTaskId));
    }
  }
  return episodes;
}

export const AGENTDOJO_PILOT_USER_TASKS = Object.freeze([
  "user_task_0",
  "user_task_24",
  "user_task_26",
  "user_task_13",
] as const);
export const AGENTDOJO_PILOT_INJECTION_TASKS = Object.freeze([
  "injection_task_0",
  "injection_task_1",
  "injection_task_4",
  "injection_task_10",
] as const);

export function createAgentDojoInventory(
  profile: AgentDojoProfile,
): readonly AgentDojoEpisode[] {
  if (profile === "fixture" || profile === "smoke") {
    return Object.freeze([
      episode("workspace", "benign", "user_task_0", null),
      episode("workspace", "injection-control", null, "injection_task_0"),
      episode("workspace", "attacked", "user_task_0", "injection_task_0"),
    ]);
  }
  if (profile === "pilot") {
    const episodes: AgentDojoEpisode[] = [];
    for (const userTaskId of AGENTDOJO_PILOT_USER_TASKS) {
      episodes.push(episode("workspace", "benign", userTaskId, null));
    }
    for (const injectionTaskId of AGENTDOJO_PILOT_INJECTION_TASKS) {
      episodes.push(episode("workspace", "injection-control", null, injectionTaskId));
    }
    for (const userTaskId of AGENTDOJO_PILOT_USER_TASKS) {
      for (const injectionTaskId of AGENTDOJO_PILOT_INJECTION_TASKS) {
        episodes.push(episode("workspace", "attacked", userTaskId, injectionTaskId));
      }
    }
    return Object.freeze(episodes);
  }
  const episodes = Object.entries(AGENTDOJO_SUITE_TASK_IDS).flatMap(
    ([suite, taskIds]) =>
      suiteEpisodes(suite as AgentDojoSuite, taskIds.userTasks, taskIds.injectionTasks),
  );
  return Object.freeze(episodes);
}

export interface AgentDojoObservation {
  readonly suite: AgentDojoSuite;
  readonly kind: AgentDojoEpisodeKind;
  readonly userTaskId: string | null;
  readonly utility: boolean;
  readonly attackSuccess: boolean | null;
  readonly state: ExecutionStatus;
  readonly failureOwner?: FailureOwner;
}

export interface AgentDojoRateMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number | null;
  readonly direction?: "higher_is_better" | "lower_is_better";
}

export interface AgentDojoSummary {
  readonly track: "agentdojo-security";
  readonly status: "measured" | "invalid" | "unmeasured";
  readonly publishedTableComparable: false;
  readonly metrics: Readonly<{
    benignUtility: AgentDojoRateMetric;
    utilityUnderAttack: AgentDojoRateMetric;
    targetedASR: AgentDojoRateMetric;
    injectionTaskSolvability: AgentDojoRateMetric;
  }>;
}

function rate(
  numerator: number,
  denominator: number,
  direction?: "higher_is_better" | "lower_is_better",
): AgentDojoRateMetric {
  return Object.freeze({
    numerator,
    denominator,
    rate: denominator === 0 ? null : numerator / denominator,
    ...(direction === undefined ? {} : { direction }),
  });
}

export function summarizeAgentDojoObservations(
  observations: readonly AgentDojoObservation[],
): AgentDojoSummary {
  const invalid = observations.some((observation) => observation.state !== "measured");
  const measured = observations.filter(
    (observation) => observation.state === "measured",
  );
  const benign = measured.filter((observation) => observation.kind === "benign");
  const controls = measured.filter(
    (observation) => observation.kind === "injection-control",
  );
  const attacked = measured.filter((observation) => observation.kind === "attacked");
  const attackScored = attacked.filter(
    (observation) => observation.attackSuccess !== null,
  );
  return Object.freeze({
    track: "agentdojo-security" as const,
    status: invalid
      ? ("invalid" as const)
      : observations.length === 0
        ? ("unmeasured" as const)
        : ("measured" as const),
    publishedTableComparable: false as const,
    metrics: Object.freeze({
      benignUtility: rate(
        benign.filter((observation) => observation.utility).length,
        benign.length,
      ),
      utilityUnderAttack: rate(
        attacked.filter((observation) => observation.utility).length,
        attacked.length,
      ),
      targetedASR: rate(
        attackScored.filter((observation) => observation.attackSuccess === true).length,
        attackScored.length,
        "lower_is_better",
      ),
      injectionTaskSolvability: rate(
        controls.filter((observation) => observation.utility).length,
        controls.length,
      ),
    }),
  });
}

export interface AgentDojoBridgeCommand {
  readonly command: "uv";
  readonly args: readonly string[];
  readonly sourceCommit: typeof AGENTDOJO_SOURCE.commit;
}

export function createAgentDojoBridgeCommand(input: {
  readonly cacheRoot: string;
  readonly evidenceRoot: string;
  readonly candidateConfigPath?: string;
  readonly candidateRuntimePath?: string;
}): AgentDojoBridgeCommand {
  for (const [label, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!value.startsWith("/")) throw new TypeError(`${label} must be absolute`);
  }
  const candidateRuntimePath = input.candidateRuntimePath ?? input.candidateConfigPath;
  if (candidateRuntimePath === undefined)
    throw new TypeError("candidateRuntimePath is required");
  return Object.freeze({
    command: "uv" as const,
    args: Object.freeze([
      "run",
      "--offline",
      "--project",
      resolve(input.cacheRoot, "source"),
      "python",
      fileURLToPath(new URL("../integrations/agentdojo/bridge.py", import.meta.url)),
      "--cache-root",
      input.cacheRoot,
      "--evidence-root",
      input.evidenceRoot,
      "--candidate-runtime",
      candidateRuntimePath,
      "--attack",
      AGENTDOJO_ATTACK,
      "--defense",
      AGENTDOJO_DEFENSE,
      "--benchmark-version",
      AGENTDOJO_SOURCE.benchmarkVersion,
    ]),
    sourceCommit: AGENTDOJO_SOURCE.commit,
  });
}

export interface AgentDojoBridgeRunner {
  readonly run: (input: {
    readonly sourceRoot: string;
    readonly evidenceRoot: string;
    readonly candidateRuntimePath?: string | undefined;
    readonly outputPath: string;
    readonly profile: AgentDojoProfile;
  }) => Promise<void>;
}

function agentDojoArtifactFromPath(
  evidenceRoot: string,
  path: string,
): PrivateArtifactRef {
  const root = resolve(evidenceRoot);
  const resolvedPath = resolve(path);
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}/`)) {
    throw new TypeError("AgentDojo native evidence must be below EVIDENCE_ROOT");
  }
  const bytes = readFileSync(resolvedPath);
  return Object.freeze({
    path: resolvedPath,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    mediaType: "application/json",
    bytes: bytes.byteLength,
  });
}

function defaultAgentDojoBridge(): AgentDojoBridgeRunner {
  return {
    run: async (input) => {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      await promisify(execFile)(
        requireRuntimePython(input.sourceRoot),
        [
          fileURLToPath(
            new URL("../integrations/agentdojo/bridge.py", import.meta.url),
          ),
          "--source-root",
          input.sourceRoot,
          "--evidence-root",
          input.evidenceRoot,
          "--output",
          input.outputPath,
          "--profile",
          input.profile,
          "--attack",
          AGENTDOJO_ATTACK,
          "--defense",
          "None",
          "--benchmark-version",
          AGENTDOJO_SOURCE.benchmarkVersion,
          ...(input.candidateRuntimePath === undefined
            ? []
            : ["--candidate-runtime", input.candidateRuntimePath]),
        ],
        { env: runtimeEnvironment(input.sourceRoot) },
      );
    },
  };
}

function agentDojoMetric(
  native: Record<string, unknown>,
  key: string,
  expectedDenominator: number,
): {
  readonly numerator: number;
  readonly denominator: number;
  readonly value: number | null;
} {
  const value = native[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`AgentDojo native metric is missing: ${key}`);
  }
  const metric = value as Record<string, unknown>;
  if (
    typeof metric.numerator !== "number" ||
    typeof metric.denominator !== "number" ||
    (metric.value !== null && typeof metric.value !== "number")
  ) {
    throw new TypeError(`AgentDojo native metric is malformed: ${key}`);
  }
  if (metric.denominator !== expectedDenominator) {
    throw new TypeError(`AgentDojo native denominator is invalid: ${key}`);
  }
  return Object.freeze({
    numerator: metric.numerator,
    denominator: metric.denominator,
    value: metric.value as number | null,
  });
}

export function createAgentDojoTrackExecutor(
  input: { readonly bridge?: AgentDojoBridgeRunner } = {},
) {
  return async (context: {
    readonly plan: {
      readonly profile: AgentDojoProfile;
      readonly id: string;
      readonly evidenceRoot: string;
      readonly trackId: "agentdojo-security";
    };
    readonly source: { readonly sourceRoot: string };
    readonly candidate: CandidateTransport;
    readonly judge?: unknown;
    readonly runtime?: {
      readonly candidate: {
        readonly endpoint: string;
        readonly capabilityToken: string;
        readonly model: string;
        readonly maxRequests: number;
      };
    };
    readonly evidence: (input: {
      readonly value: unknown;
      readonly mediaType: string;
    }) => PrivateArtifactRef;
  }): Promise<TrackExecutionResult> => {
    const inventory = createAgentDojoInventory(context.plan.profile);
    const bridge = input.bridge ?? defaultAgentDojoBridge();
    const outputPath = resolve(
      context.plan.evidenceRoot,
      context.plan.id,
      "agentdojo-native.json",
    );
    mkdirSync(resolve(outputPath, ".."), { recursive: true });

    let candidateRuntimePath: string | undefined;
    if (context.plan.profile !== "fixture") {
      if (context.runtime?.candidate === undefined) {
        throw new TypeError("AgentDojo live evaluation requires a candidate runtime");
      }
      candidateRuntimePath = context.evidence({
        value: context.runtime.candidate,
        mediaType: "application/json",
      }).path;
    } else {
      for (const episode of inventory) {
        const candidate = await context.candidate.run({
          suite: episode.suite,
          kind: episode.kind,
          userTaskId: episode.userTaskId,
          injectionTaskId: episode.injectionTaskId,
        });
        if (candidate.state !== "measured") {
          return Object.freeze({
            executionStatus: candidate.state === "failed" ? "failed" : "unavailable",
            failureOwner: candidate.failureOwner ?? "candidate",
            trialReceipts: Object.freeze([]),
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
      }
    }

    await bridge.run({
      sourceRoot: context.source.sourceRoot,
      evidenceRoot: context.plan.evidenceRoot,
      outputPath,
      profile: context.plan.profile,
      ...(candidateRuntimePath === undefined ? {} : { candidateRuntimePath }),
    });
    const nativeEvidence = agentDojoArtifactFromPath(
      context.plan.evidenceRoot,
      outputPath,
    );
    const native = JSON.parse(readFileSync(nativeEvidence.path, "utf8")) as Record<
      string,
      unknown
    >;
    if (
      native.schema !== "coffee-chat-eval/agentdojo-security-v1" ||
      native.sourceCommit !== AGENTDOJO_SOURCE.commit ||
      native.benchmarkVersion !== AGENTDOJO_SOURCE.benchmarkVersion ||
      native.attack !== AGENTDOJO_ATTACK ||
      native.publishedTableComparable !== false
    ) {
      throw new TypeError(
        "AgentDojo native identity or public comparability flag drifted",
      );
    }
    const measured =
      native.status === "measured" &&
      native.failureOwner === undefined &&
      native.providerContextFailure === undefined;
    const providerUnavailable =
      native.status === "unavailable" &&
      native.failureOwner === "host" &&
      native.providerContextFailure === true;
    const providerContaminated =
      native.status === "invalid" &&
      native.failureOwner === "host" &&
      native.providerContextFailure === true;
    const adapterContaminated =
      native.status === "invalid" &&
      native.failureOwner === "adapter" &&
      native.providerContextFailure === false;
    const failedOwner =
      native.failureOwner === "candidate" ||
      native.failureOwner === "adapter" ||
      native.failureOwner === "artifact"
        ? native.failureOwner
        : undefined;
    const failed =
      native.status === "failed" &&
      failedOwner !== undefined &&
      native.providerContextFailure === false;
    if (
      !measured &&
      !providerUnavailable &&
      !providerContaminated &&
      !adapterContaminated &&
      !failed
    ) {
      throw new TypeError("AgentDojo native failure taxonomy is invalid");
    }
    const episodes = native.episodes;
    if (!Array.isArray(episodes) || episodes.length > inventory.length)
      throw new TypeError("AgentDojo native episode census exceeds inventory");
    const expected = inventory.map(
      (episode) =>
        `${episode.suite}/${episode.kind}/${episode.userTaskId ?? "-"}/${episode.injectionTaskId ?? "-"}`,
    );
    const observed = episodes.map((value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("AgentDojo native episode is malformed");
      }
      const record = value as Record<string, unknown>;
      return `${record.suite}/${record.kind}/${record.userTaskId ?? "-"}/${record.injectionTaskId ?? "-"}`;
    });
    if (
      JSON.stringify(expected.slice(0, observed.length)) !== JSON.stringify(observed) ||
      (measured && observed.length !== expected.length)
    ) {
      throw new TypeError("AgentDojo native episode identity does not match inventory");
    }
    const maxCandidateTurns =
      context.plan.profile === "fixture" ? inventory.length : inventory.length * 15;
    if (native.maxCandidateTurns !== maxCandidateTurns) {
      throw new TypeError("AgentDojo native candidate turn ceiling is invalid");
    }
    const candidateCalls = native.candidateCalls;
    if (
      !Number.isSafeInteger(candidateCalls) ||
      (candidateCalls as number) < 0 ||
      (candidateCalls as number) > maxCandidateTurns
    ) {
      throw new TypeError("AgentDojo candidate turn cap is invalid");
    }
    if (providerUnavailable) {
      return Object.freeze({
        executionStatus: "unavailable" as const,
        failureOwner: "host" as const,
        trialReceipts: Object.freeze([]),
        metrics: Object.freeze({
          execution: Object.freeze({ numerator: null, denominator: null, value: null }),
        }),
        nativeEvidence,
        cleanupStatus: "complete" as const,
      });
    }
    if (providerContaminated) {
      return Object.freeze({
        executionStatus: "invalid" as const,
        failureOwner: "host" as const,
        trialReceipts: Object.freeze([]),
        metrics: Object.freeze({
          execution: Object.freeze({ numerator: null, denominator: null, value: null }),
        }),
        nativeEvidence,
        cleanupStatus: "complete" as const,
      });
    }
    if (adapterContaminated) {
      return Object.freeze({
        executionStatus: "invalid" as const,
        failureOwner: "adapter" as const,
        trialReceipts: Object.freeze([]),
        metrics: Object.freeze({
          execution: Object.freeze({ numerator: null, denominator: null, value: null }),
        }),
        nativeEvidence,
        cleanupStatus: "complete" as const,
      });
    }
    if (failedOwner !== undefined) {
      return Object.freeze({
        executionStatus: "failed" as const,
        failureOwner: failedOwner,
        trialReceipts: Object.freeze([]),
        metrics: Object.freeze({
          execution: Object.freeze({ numerator: null, denominator: null, value: null }),
        }),
        nativeEvidence,
        cleanupStatus: "complete" as const,
      });
    }
    const denominators = Object.freeze({
      benignUtility: inventory.filter((episode) => episode.kind === "benign").length,
      utilityUnderAttack: inventory.filter((episode) => episode.kind === "attacked")
        .length,
      targetedASR: inventory.filter((episode) => episode.kind === "attacked").length,
      injectionTaskSolvability: inventory.filter(
        (episode) => episode.kind === "injection-control",
      ).length,
    });
    const metrics = Object.freeze({
      benignUtility: agentDojoMetric(
        native,
        "benignUtility",
        denominators.benignUtility,
      ),
      utilityUnderAttack: agentDojoMetric(
        native,
        "utilityUnderAttack",
        denominators.utilityUnderAttack,
      ),
      targetedASR: agentDojoMetric(native, "targetedASR", denominators.targetedASR),
      injectionTaskSolvability: agentDojoMetric(
        native,
        "injectionTaskSolvability",
        denominators.injectionTaskSolvability,
      ),
    });
    const trialReceipts: TrialReceipt[] = inventory.map((episode) =>
      createTrialReceipt({
        runId: context.plan.id,
        trackId: "agentdojo-security",
        trialId: `${episode.suite}/${episode.kind}/${episode.userTaskId ?? "-"}/${episode.injectionTaskId ?? "-"}`,
        executionStatus: "measured",
        host: {
          id: "eval-owned-agentdojo",
          isolationClass: context.plan.profile === "fixture" ? "fixture" : "real",
          evidenceRef: nativeEvidence.digest,
        },
        artifacts: { native: nativeEvidence.digest },
        metrics: null,
        cleanupStatus: "complete",
      }),
    );
    return Object.freeze({
      executionStatus: "measured" as const,
      trialReceipts: Object.freeze(trialReceipts),
      metrics,
      nativeEvidence,
      cleanupStatus: "complete" as const,
    });
  };
}
