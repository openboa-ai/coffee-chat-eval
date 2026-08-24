import { isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { stableDigest } from "./identity.ts";
import { putEvidence } from "./evidence.ts";
import {
  createTrialReceipt,
  type CandidateTransport,
  type PrivateArtifactRef,
  type TrackExecutionResult,
} from "./eval-core.ts";
import type { Sha256Digest } from "./types.ts";
import {
  IFEVAL_RUNTIME_LOCK,
  requireRuntimePython,
  runtimeEnvironment,
} from "./python-runtime.ts";

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

/**
 * The pinned native checker for smoke key 1040 calls NLTK's `punkt_tab` data.
 * The pinned nltk_data metadata does not declare a package license and its own
 * license inventory classifies this package as unclarified. Repository-level
 * Apache-2.0 therefore is not treated as permission for the data package.
 */
export const IFEVAL_NATIVE_RUNTIME_RIGHTS = Object.freeze({
  asset: "nltk_data/tokenizers/punkt_tab.zip",
  repository: "https://github.com/nltk/nltk_data",
  revision: "550b6625bcef1f2abff2ff770a5a0d272c9c6b2a",
  digest:
    "sha256:e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106" as Sha256Digest,
  licenseStatus: "unclarified" as const,
  policyResult: "rights_hold" as const,
});

export const IFEVAL_NATIVE_RUNTIME_RIGHTS_HOLD_REASON = `native IFEval runtime dependency ${IFEVAL_NATIVE_RUNTIME_RIGHTS.asset} has unclarified license permission`;

export interface IfevalRightsRiskAcceptance {
  readonly schema: "ifeval-rights-risk-acceptance-v1";
  readonly trackId: "ifeval";
  readonly profile: "smoke";
  readonly candidateType: "coffee_chat_product";
  readonly candidateDigest: Sha256Digest;
  readonly ifevalSourceCommit: typeof IFEVAL_SOURCE.commit;
  readonly assetRepository: typeof IFEVAL_NATIVE_RUNTIME_RIGHTS.repository;
  readonly assetRevision: typeof IFEVAL_NATIVE_RUNTIME_RIGHTS.revision;
  readonly asset: typeof IFEVAL_NATIVE_RUNTIME_RIGHTS.asset;
  readonly assetDigest: typeof IFEVAL_NATIVE_RUNTIME_RIGHTS.digest;
  readonly licenseStatus: "unclarified";
  readonly licenseCleared: false;
  readonly scope: "private-internal-smoke-only";
  readonly acceptedBy: "workspace-owner";
  readonly acceptedAt: string;
  /** Operator-generated 256-bit private nonce that makes the public digest hiding. */
  readonly privateNonce: string;
  readonly acknowledgesNoLicenseGrant: true;
  readonly acknowledgesNoRedistribution: true;
  readonly acknowledgesNoPublicNumericClaim: true;
}

export function parseIfevalRightsRiskAcceptance(
  value: unknown,
): IfevalRightsRiskAcceptance {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("IFEval rights risk acceptance must be an object");
  }
  const receipt = value as Record<string, unknown>;
  const expectedKeys = [
    "acknowledgesNoLicenseGrant",
    "acknowledgesNoPublicNumericClaim",
    "acknowledgesNoRedistribution",
    "acceptedBy",
    "acceptedAt",
    "asset",
    "assetDigest",
    "assetRepository",
    "assetRevision",
    "candidateType",
    "candidateDigest",
    "ifevalSourceCommit",
    "licenseCleared",
    "licenseStatus",
    "profile",
    "privateNonce",
    "schema",
    "scope",
    "trackId",
  ].sort();
  if (JSON.stringify(Object.keys(receipt).sort()) !== JSON.stringify(expectedKeys)) {
    throw new TypeError("IFEval rights risk acceptance has unexpected fields");
  }
  if (
    receipt.schema !== "ifeval-rights-risk-acceptance-v1" ||
    receipt.trackId !== "ifeval" ||
    receipt.profile !== "smoke" ||
    receipt.scope !== "private-internal-smoke-only"
  ) {
    throw new TypeError("IFEval rights risk acceptance is limited to private smoke");
  }
  if (receipt.candidateType !== "coffee_chat_product") {
    throw new TypeError(
      "IFEval rights risk acceptance is limited to the Coffee Chat Product candidate",
    );
  }
  if (
    typeof receipt.candidateDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(receipt.candidateDigest)
  ) {
    throw new TypeError("IFEval rights risk acceptance candidate digest is invalid");
  }
  if (receipt.ifevalSourceCommit !== IFEVAL_SOURCE.commit) {
    throw new TypeError("IFEval rights risk acceptance source identity drifted");
  }
  if (
    receipt.assetRepository !== IFEVAL_NATIVE_RUNTIME_RIGHTS.repository ||
    receipt.assetRevision !== IFEVAL_NATIVE_RUNTIME_RIGHTS.revision ||
    receipt.asset !== IFEVAL_NATIVE_RUNTIME_RIGHTS.asset ||
    receipt.assetDigest !== IFEVAL_NATIVE_RUNTIME_RIGHTS.digest ||
    receipt.licenseStatus !== "unclarified"
  ) {
    throw new TypeError("IFEval rights risk acceptance asset identity drifted");
  }
  if (receipt.licenseCleared !== false) {
    throw new TypeError("IFEval rights risk acceptance licenseCleared must be false");
  }
  if (
    receipt.acknowledgesNoLicenseGrant !== true ||
    receipt.acknowledgesNoRedistribution !== true ||
    receipt.acknowledgesNoPublicNumericClaim !== true
  ) {
    throw new TypeError("IFEval rights risk acceptance acknowledgements are required");
  }
  if (
    receipt.acceptedBy !== "workspace-owner" ||
    typeof receipt.acceptedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      receipt.acceptedAt,
    ) ||
    !Number.isFinite(Date.parse(receipt.acceptedAt))
  ) {
    throw new TypeError(
      "IFEval rights risk acceptance operator or acceptedAt is invalid",
    );
  }
  if (
    typeof receipt.privateNonce !== "string" ||
    !/^[0-9a-f]{64}$/u.test(receipt.privateNonce)
  ) {
    throw new TypeError(
      "IFEval rights risk acceptance private nonce must be 256-bit lowercase hex",
    );
  }
  return Object.freeze(receipt) as unknown as IfevalRightsRiskAcceptance;
}

export function ifevalRightsRiskAcceptanceDigest(
  value: IfevalRightsRiskAcceptance,
): Sha256Digest {
  return stableDigest(parseIfevalRightsRiskAcceptance(value));
}

export function validateIfevalPrivateSmokeRiskAcceptance(input: {
  readonly profile: IfevalProfile;
  readonly candidateType: CandidateTransport["kind"];
  readonly expectedDigest?: Sha256Digest | undefined;
  readonly expectedCandidateDigest?: Sha256Digest | undefined;
  readonly receipt?: IfevalRightsRiskAcceptance | undefined;
}): IfevalRightsRiskAcceptance {
  if (input.receipt === undefined || input.expectedDigest === undefined) {
    throw new TypeError(IFEVAL_NATIVE_RUNTIME_RIGHTS_HOLD_REASON);
  }
  if (input.profile !== "smoke" || input.candidateType !== "coffee_chat_product") {
    throw new TypeError(
      "IFEval rights risk acceptance is limited to the Coffee Chat Product smoke",
    );
  }
  const receipt = parseIfevalRightsRiskAcceptance(input.receipt);
  if (receipt.candidateDigest !== input.expectedCandidateDigest) {
    throw new TypeError(
      "IFEval rights risk acceptance does not match the Product candidate identity",
    );
  }
  if (ifevalRightsRiskAcceptanceDigest(receipt) !== input.expectedDigest) {
    throw new TypeError("IFEval rights risk acceptance digest does not match RunSpec");
  }
  return receipt;
}

export function ifevalNativeRuntimeRequiresRightsHold(
  candidateType: CandidateTransport["kind"],
): boolean {
  return (
    candidateType !== "fixture" &&
    IFEVAL_NATIVE_RUNTIME_RIGHTS.policyResult === "rights_hold"
  );
}

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
  readonly command: "uv";
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
    command: "uv" as const,
    args: Object.freeze([
      "run",
      "--offline",
      "--no-project",
      "--with-requirements",
      IFEVAL_RUNTIME_LOCK,
      "python",
      fileURLToPath(new URL("../integrations/ifeval/bridge.py", import.meta.url)),
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

function artifactFromPath(
  root: string,
  path: string,
  mediaType: string,
): PrivateArtifactRef {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (
    !isAbsolute(path) ||
    (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}/`))
  ) {
    throw new TypeError("IFEval artifact must be below EVIDENCE_ROOT");
  }
  const bytes = readFileSync(resolvedPath);
  const digest =
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` as Sha256Digest;
  return Object.freeze({
    path: resolvedPath,
    digest,
    mediaType,
    bytes: bytes.byteLength,
  });
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
  readonly preflight?: (input: {
    readonly sourceRoot: string;
  }) => Promise<Readonly<Record<string, unknown>>>;
  readonly run: (input: {
    readonly sourceRoot: string;
    readonly inputData: string;
    readonly responseData: string;
    readonly output: string;
    readonly profile: IfevalProfile;
    readonly keys: readonly number[];
  }) => Promise<void>;
}

const IFEVAL_BRIDGE_PATH = fileURLToPath(
  new URL("../integrations/ifeval/bridge.py", import.meta.url),
);

export async function preflightIfevalRuntimeAsset(
  sourceRoot: string,
): Promise<Readonly<Record<string, unknown>>> {
  const { stdout } = await execFileAsync(
    requireRuntimePython(sourceRoot),
    ["-B", IFEVAL_BRIDGE_PATH, "--preflight-only"],
    {
      env: runtimeEnvironment(sourceRoot),
      maxBuffer: 64 * 1024,
    },
  );
  const value = JSON.parse(stdout) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("IFEval runtime asset preflight output is invalid");
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== "coffee-chat-eval/ifeval-runtime-asset-preflight-v1" ||
    record.status !== "verified" ||
    record.asset !== IFEVAL_NATIVE_RUNTIME_RIGHTS.asset ||
    record.assetBytes !== 4_319_076 ||
    record.assetDigest !== IFEVAL_NATIVE_RUNTIME_RIGHTS.digest ||
    record.integrityOnly !== true ||
    record.rightsCleared !== false
  ) {
    throw new TypeError("IFEval runtime asset preflight identity drifted");
  }
  return Object.freeze({ ...record });
}

function defaultIfevalBridgeRunner(): IFEvalBridgeRunner {
  return {
    preflight: async ({ sourceRoot }) => preflightIfevalRuntimeAsset(sourceRoot),
    run: async (input) => {
      await execFileAsync(
        requireRuntimePython(input.sourceRoot),
        [
          IFEVAL_BRIDGE_PATH,
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
        ],
        { env: runtimeEnvironment(input.sourceRoot) },
      );
    },
  };
}

function metricFromNative(
  value: unknown,
  label: string,
): Readonly<{
  numerator: number | null;
  denominator: number | null;
  value: number | null;
}> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`IFEval native metric ${label} is invalid`);
  const record = value as Record<string, unknown>;
  const numerator = record.numerator as number;
  const denominator = record.denominator as number;
  if (
    !Number.isSafeInteger(numerator) ||
    !Number.isSafeInteger(denominator) ||
    numerator < 0 ||
    denominator < 0
  )
    throw new TypeError(`IFEval native metric ${label} counts are invalid`);
  if (numerator > denominator)
    throw new TypeError(`IFEval native metric ${label} numerator exceeds denominator`);
  const accuracy = record.accuracy;
  if (
    accuracy !== null &&
    (typeof accuracy !== "number" ||
      !Number.isFinite(accuracy) ||
      accuracy < 0 ||
      accuracy > 1)
  )
    throw new TypeError(`IFEval native metric ${label} accuracy is invalid`);
  return Object.freeze({ numerator, denominator, value: accuracy as number | null });
}

function runtimePreflightFailureOwner(error: unknown): "host" | "source" {
  return error !== null &&
    typeof error === "object" &&
    (error as { readonly failureOwner?: unknown }).failureOwner === "host"
    ? "host"
    : "source";
}

export function createIfevalTrackExecutor(
  input: { readonly bridge?: IFEvalBridgeRunner } = {},
): (context: {
  readonly plan: {
    readonly profile: IfevalProfile;
    readonly evidenceRoot: string;
    readonly id: string;
    readonly trackId: "ifeval";
    readonly runSpec?: {
      readonly candidateType: CandidateTransport["kind"];
      readonly candidateDigest: Sha256Digest;
      readonly rightsRiskAcceptanceDigest?: Sha256Digest;
    };
  };
  readonly source: { readonly sourceRoot: string };
  readonly candidate: CandidateTransport;
  readonly ifevalRightsRiskAcceptance?: IfevalRightsRiskAcceptance;
  readonly evidence: (input: {
    readonly value: unknown;
    readonly mediaType: string;
  }) => PrivateArtifactRef;
}) => Promise<TrackExecutionResult> {
  return async (context) => {
    if (ifevalNativeRuntimeRequiresRightsHold(context.candidate.kind)) {
      try {
        validateIfevalPrivateSmokeRiskAcceptance({
          profile: context.plan.profile,
          candidateType: context.candidate.kind,
          expectedDigest: context.plan.runSpec?.rightsRiskAcceptanceDigest,
          expectedCandidateDigest: context.plan.runSpec?.candidateDigest,
          receipt: context.ifevalRightsRiskAcceptance,
        });
      } catch {
        const metric = Object.freeze({
          numerator: null,
          denominator: null,
          value: null,
        });
        return Object.freeze({
          executionStatus: "rights_hold" as const,
          failureOwner: "rights" as const,
          trialReceipts: Object.freeze([]),
          metrics: Object.freeze({
            strictPrompt: metric,
            strictInstruction: metric,
            loosePrompt: metric,
            looseInstruction: metric,
          }),
          nativeEvidence: context.evidence({
            value: {
              reason: IFEVAL_NATIVE_RUNTIME_RIGHTS_HOLD_REASON,
              dependency: IFEVAL_NATIVE_RUNTIME_RIGHTS,
            },
            mediaType: "application/json",
          }),
          cleanupStatus: "complete" as const,
        });
      }
    }
    const bridge =
      input.bridge ??
      (context.plan.profile === "fixture"
        ? {
            run: async ({
              output,
              keys,
            }: {
              readonly output: string;
              readonly keys: readonly number[];
            }) => {
              mkdirSync(resolve(output, ".."), { recursive: true });
              writeFileSync(
                output,
                JSON.stringify({
                  source: { inputCount: keys.length, keys },
                  metrics: Object.fromEntries(
                    [
                      "strictPrompt",
                      "strictInstruction",
                      "loosePrompt",
                      "looseInstruction",
                    ].map((metric) => [
                      metric,
                      { numerator: 0, denominator: keys.length, accuracy: 0 },
                    ]),
                  ),
                }),
              );
            },
          }
        : defaultIfevalBridgeRunner());
    if (context.candidate.kind !== "fixture") {
      try {
        if (bridge.preflight === undefined) {
          throw new TypeError("IFEval live bridge is missing runtime-asset preflight");
        }
        const preflight = await bridge.preflight({
          sourceRoot: context.source.sourceRoot,
        });
        context.evidence({ value: preflight, mediaType: "application/json" });
      } catch (error) {
        const failureOwner = runtimePreflightFailureOwner(error);
        const metric = Object.freeze({
          numerator: null,
          denominator: null,
          value: null,
        });
        return Object.freeze({
          executionStatus: "unavailable" as const,
          failureOwner,
          trialReceipts: Object.freeze([]),
          metrics: Object.freeze({
            strictPrompt: metric,
            strictInstruction: metric,
            loosePrompt: metric,
            looseInstruction: metric,
          }),
          nativeEvidence: context.evidence({
            value: {
              error:
                error instanceof Error
                  ? error.message
                  : "IFEval runtime asset preflight failed",
            },
            mediaType: "application/json",
          }),
          cleanupStatus: "complete" as const,
        });
      }
    }
    const inventory = createIfevalInventory(context.plan.profile);
    const inputData = resolve(context.source.sourceRoot, IFEVAL_SOURCE.dataPath);
    const sourceRows = readFileSync(inputData, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map(
        (line) => JSON.parse(line) as { readonly key: number; readonly prompt: string },
      );
    const sourceByKey = new Map(sourceRows.map((row) => [row.key, row]));
    const sourceRowsForInventory = inventory.map((item) => {
      // The score inventory is source-independent and uses stable ordinal
      // identities. Resolve those identities against the pinned input here;
      // smoke/pilot retain their explicit official keys.
      const row = item.caseId.startsWith("official-index-")
        ? sourceRows[item.ordinal]
        : sourceByKey.get(Number(item.caseId));
      if (row === undefined)
        throw new TypeError(`IFEval source key is missing: ${item.caseId}`);
      return row;
    });
    const selectedKeys = sourceRowsForInventory.map((row) => row.key);
    const responses: string[] = [];
    const trialReceipts = [];
    for (const [index, item] of inventory.entries()) {
      const sourceRow = sourceRowsForInventory[index]!;
      const candidate = await context.candidate.run({
        caseId: item.caseId,
        prompt: sourceRow.prompt,
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
            value: { error: candidate.reason },
            mediaType: "application/json",
          }),
          cleanupStatus: "complete" as const,
        });
      }
      if (candidate.output === undefined)
        throw new TypeError("candidate output artifact is required");
      const response = responseText(candidate.output);
      if (response.length === 0)
        throw new TypeError("empty IFEval candidate response is invalid");
      responses.push(
        JSON.stringify({
          key: sourceRow.key,
          prompt: sourceRow.prompt,
          response,
        }),
      );
      trialReceipts.push(
        createTrialReceipt({
          runId: context.plan.id,
          trackId: "ifeval",
          trialId: item.caseId,
          executionStatus: "measured",
          host: {
            id: "eval-owned-runner",
            isolationClass: context.plan.profile === "fixture" ? "fixture" : "real",
            evidenceRef: stableDigest(context.plan.id),
          },
          artifacts: { output: candidate.output.digest },
          metrics: null,
          latencyMs: candidate.latencyMs,
          cleanupStatus: "complete",
        }),
      );
    }
    const responseArtifact = putEvidence(
      context.plan.evidenceRoot,
      `${responses.join("\n")}\n`,
      "private",
    );
    const responsePath = responseArtifact.path;
    const nativePath = resolve(
      context.plan.evidenceRoot,
      context.plan.id,
      "ifeval-native.json",
    );
    mkdirSync(resolve(nativePath, ".."), { recursive: true });
    await bridge.run({
      sourceRoot: context.source.sourceRoot,
      inputData,
      responseData: responsePath,
      output: nativePath,
      profile: context.plan.profile,
      keys: selectedKeys,
    });
    const nativeArtifact = artifactFromPath(
      context.plan.evidenceRoot,
      nativePath,
      "application/json",
    );
    const native = JSON.parse(readFileSync(nativeArtifact.path, "utf8")) as Record<
      string,
      unknown
    >;
    const metricsRecord = native.metrics;
    if (
      metricsRecord === null ||
      typeof metricsRecord !== "object" ||
      Array.isArray(metricsRecord)
    )
      throw new TypeError("IFEval native metrics are missing");
    const metrics = Object.freeze({
      strictPrompt: metricFromNative(
        (metricsRecord as Record<string, unknown>).strictPrompt,
        "strictPrompt",
      ),
      strictInstruction: metricFromNative(
        (metricsRecord as Record<string, unknown>).strictInstruction,
        "strictInstruction",
      ),
      loosePrompt: metricFromNative(
        (metricsRecord as Record<string, unknown>).loosePrompt,
        "loosePrompt",
      ),
      looseInstruction: metricFromNative(
        (metricsRecord as Record<string, unknown>).looseInstruction,
        "looseInstruction",
      ),
    });
    const expectedKeys = selectedKeys;
    if (
      native.source === null ||
      typeof native.source !== "object" ||
      (native.source as Record<string, unknown>).inputCount !== inventory.length
    )
      throw new TypeError("IFEval native input census does not match");
    if (
      JSON.stringify(
        native.source && (native.source as Record<string, unknown>).keys,
      ) !== JSON.stringify(expectedKeys)
    )
      throw new TypeError("IFEval native key census does not match");
    return Object.freeze({
      executionStatus: "measured" as const,
      trialReceipts: Object.freeze(trialReceipts),
      metrics,
      nativeEvidence: nativeArtifact,
      cleanupStatus: "complete" as const,
    });
  };
}
