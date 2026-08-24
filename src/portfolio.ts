import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ImmutableRunResult } from "./run-engine.ts";
import { executeImmutableRun, validateRuntimeForRun } from "./run-engine.ts";
import {
  parseRunSpec,
  parseSourceManifest,
  createRunPlan,
  parseProductCandidateBoundary,
  type CandidateTransport,
  type JudgeTransport,
  type ProductCandidateBoundary,
} from "./eval-core.ts";
import {
  candidateIdentityDigest,
  judgeIdentityDigest,
  parseCandidateIdentityConfig,
  parseJudgeIdentityConfig,
  parseRuntimeBundleConfig,
  type CandidateIdentityConfig,
  type CoffeeChatProductCandidateIdentityConfig,
  type JudgeIdentityConfig,
  type RuntimeBundleConfig,
} from "./runtime-config.ts";
import type { RunPlan, SourceManifest } from "./eval-core.ts";
import type { EvaluationTrackId } from "./track-registry.ts";
import type { Sha256Digest } from "./types.ts";
import { getSourceManifest } from "./source-manifests.ts";
import {
  createFixtureCandidateTransport,
  createFixtureJudgeTransport,
  createResponsesCandidateTransport,
  createResponsesJudgeTransport,
} from "./transports.ts";
import {
  startResponsesProxyProcess,
  validateResponsesUpstreamUrl,
} from "./responses-proxy-process.ts";
import {
  prepareCoffeeChatProductCandidateTransport,
  verifyCoffeeChatProductPackage,
} from "./product-host.ts";
import {
  IFEVAL_NATIVE_RUNTIME_RIGHTS,
  ifevalRightsRiskAcceptanceDigest,
  parseIfevalRightsRiskAcceptance,
  preflightIfevalRuntimeAsset,
  validateIfevalPrivateSmokeRiskAcceptance,
  type IfevalRightsRiskAcceptance,
} from "./ifeval.ts";
import { readBoundedJson } from "./resources.ts";
import {
  verifyMaterializedSource,
  type MaterializedSourceVerification,
} from "./source-cache.ts";
import { evalOwnedRuntimeLockForTrack } from "./python-runtime.ts";
import { verifySourceManifestPins } from "./source-manifests.ts";

const PORTFOLIO_JSON_BYTES = 256 * 1024;

export const PORTFOLIO_SMOKE_CAPS: Readonly<
  Record<EvaluationTrackId, Readonly<{ candidate: number; judge: number }>>
> = Object.freeze({
  "coffee-chat-taste": Object.freeze({ candidate: 3, judge: 21 }),
  "beam-record-core": Object.freeze({ candidate: 6, judge: 11 }),
  ifeval: Object.freeze({ candidate: 9, judge: 0 }),
  "agentdojo-security": Object.freeze({ candidate: 45, judge: 0 }),
});

export const PORTFOLIO_SMOKE_CENSUS: Readonly<
  Record<EvaluationTrackId, Readonly<Record<string, number>>>
> = Object.freeze({
  "coffee-chat-taste": Object.freeze({
    families: 1,
    submissions: 3,
    pointwiseCalls: 13,
    pairwiseCalls: 8,
  }),
  "beam-record-core": Object.freeze({ queries: 6, judgeCalls: 11 }),
  ifeval: Object.freeze({ prompts: 9 }),
  "agentdojo-security": Object.freeze({
    benign: 1,
    injectionControls: 1,
    attackedPairs: 1,
    episodes: 3,
  }),
});

export interface PortfolioTrackInput {
  readonly trackId: EvaluationTrackId;
  readonly plan: RunPlan;
  readonly manifest: SourceManifest;
  readonly candidate: CandidateTransport;
  readonly judge: JudgeTransport | undefined;
  readonly runtime?: RuntimeBundleConfig | undefined;
  readonly ifevalRightsRiskAcceptance?: IfevalRightsRiskAcceptance | undefined;
  readonly close?: (() => Promise<void>) | undefined;
}

export interface PortfolioTrackReceipt {
  readonly trackId: EvaluationTrackId;
  readonly runId: string;
  readonly executionStatus: string;
  readonly claimStatus: string;
  readonly expectedCensus: Readonly<Record<string, number>>;
  readonly observedCensus: Readonly<Record<string, number>>;
  readonly nativeEvidenceDigest?: Sha256Digest;
  readonly trackReportDigest?: Sha256Digest;
  readonly trialReceiptsDigest: Sha256Digest;
  readonly privateResultDigestsWithheld?: true;
  readonly cleanupStatus: string;
  readonly latencyMs: number | null;
  readonly tokenCount: number | null;
  readonly cost: "available" | "unavailable";
  readonly rightsRiskAcceptanceDigest?: Sha256Digest;
  readonly licenseCleared?: false;
  readonly rightsExecutionScope?: "private-internal-smoke-only";
  readonly candidateMode?: ProductCandidateBoundary["candidateMode"];
  readonly capabilitiesUsed?: ProductCandidateBoundary["capabilitiesUsed"];
  readonly productBehaviorExercised?: ProductCandidateBoundary["productBehaviorExercised"];
  readonly referenceHost?: ProductCandidateBoundary["referenceHost"];
  readonly productIdentity?: ProductCandidateBoundary["productIdentity"];
}

export interface PortfolioReceipt {
  readonly schema: "portfolio-smoke-receipt-v1";
  readonly status: "measured" | "failed";
  readonly claimStatus: "calibration" | "mixed";
  readonly officialMeasurementEligible: false;
  readonly tracks: readonly PortfolioTrackReceipt[];
  readonly publicReceiptPath: string;
}

export interface PortfolioBrokerConfig {
  readonly providerEnvFile: string;
  readonly providerKeyEnv: string;
  readonly upstreamUrl?: string;
  readonly ttlSeconds?: number;
}

function exactBrokerKeys(record: Record<string, unknown>): void {
  const allowed = new Set([
    "providerEnvFile",
    "providerKeyEnv",
    "upstreamUrl",
    "ttlSeconds",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new TypeError(
      "portfolio broker config rejects providerKey bytes or unknown fields",
    );
  }
}

export function parsePortfolioBrokerConfig(value: unknown): PortfolioBrokerConfig {
  const record = configRecord(value, "portfolio broker config");
  exactBrokerKeys(record);
  const providerEnvFile = absoluteConfigPath(
    record.providerEnvFile,
    "portfolio broker providerEnvFile",
  );
  const providerKeyEnv = record.providerKeyEnv;
  if (
    typeof providerKeyEnv !== "string" ||
    !/^[A-Z_][A-Z0-9_]*$/u.test(providerKeyEnv)
  ) {
    throw new TypeError(
      "portfolio broker providerKeyEnv must be an environment variable name",
    );
  }
  const upstreamUrl = record.upstreamUrl;
  if (upstreamUrl !== undefined) {
    if (typeof upstreamUrl !== "string" || upstreamUrl.length === 0) {
      throw new TypeError("portfolio broker upstreamUrl must be a non-empty URL");
    }
    validateResponsesUpstreamUrl(upstreamUrl);
  }
  const ttlSeconds = record.ttlSeconds;
  if (
    ttlSeconds !== undefined &&
    (!Number.isSafeInteger(ttlSeconds) || (ttlSeconds as number) < 60)
  ) {
    throw new TypeError("portfolio broker ttlSeconds must be at least 60");
  }
  return Object.freeze({
    providerEnvFile,
    providerKeyEnv,
    ...(upstreamUrl === undefined ? {} : { upstreamUrl }),
    ...(ttlSeconds === undefined ? {} : { ttlSeconds: ttlSeconds as number }),
  });
}

function digest(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(`${JSON.stringify(value)}\n`)
    .digest("hex")}`;
}

function nativeValue(result: ImmutableRunResult): Record<string, unknown> {
  const value = JSON.parse(readFileSync(result.nativeEvidence.path, "utf8")) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("portfolio native evidence must be an object");
  }
  return value as Record<string, unknown>;
}

function numberField(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`portfolio census field is invalid: ${label}`);
  }
  return value;
}

function observedCensus(
  trackId: EvaluationTrackId,
  result: ImmutableRunResult,
): Readonly<Record<string, number>> {
  const native = nativeValue(result);
  switch (trackId) {
    case "coffee-chat-taste": {
      const summary = native.summary;
      if (summary === null || typeof summary !== "object" || Array.isArray(summary))
        throw new TypeError("Taste native summary is missing");
      const record = summary as Record<string, unknown>;
      const candidates = record.candidateArtifacts;
      const judgeCalls = numberField(record.judgeCalls, "Taste judgeCalls");
      return Object.freeze({
        families: 1,
        submissions: Array.isArray(candidates) ? candidates.length : 0,
        pointwiseCalls: Math.min(judgeCalls, 13),
        pairwiseCalls: Math.max(0, judgeCalls - 13),
      });
    }
    case "beam-record-core":
      return Object.freeze({
        queries: numberField(native.queryCount, "BEAM queryCount"),
        judgeCalls: numberField(native.judgeCalls, "BEAM judgeCalls"),
      });
    case "ifeval": {
      const source = native.source;
      if (source === null || typeof source !== "object" || Array.isArray(source))
        throw new TypeError("IFEval native source is missing");
      const prompts = numberField(
        (source as Record<string, unknown>).inputCount,
        "IFEval inputCount",
      );
      return Object.freeze({ prompts });
    }
    case "agentdojo-security":
      return Object.freeze({
        benign: 1,
        injectionControls: 1,
        attackedPairs: 1,
        episodes: Array.isArray(native.episodes) ? native.episodes.length : 0,
      });
  }
}

function trialUsage(result: ImmutableRunResult): {
  readonly latencyMs: number | null;
  readonly tokenCount: number | null;
} {
  const value = JSON.parse(readFileSync(result.trialReceiptsPath, "utf8")) as unknown;
  if (!Array.isArray(value)) throw new TypeError("trial receipts must be an array");
  if (value.length === 0) return Object.freeze({ latencyMs: null, tokenCount: null });
  let latencyMs = 0;
  let tokenCount = 0;
  let hasLatency = true;
  let hasTokenCount = true;
  for (const [index, raw] of value.entries()) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError(`trial receipt is invalid at index ${index}`);
    }
    const receipt = raw as Record<string, unknown>;
    if (typeof receipt.latencyMs === "number" && Number.isFinite(receipt.latencyMs)) {
      latencyMs += receipt.latencyMs;
    } else {
      hasLatency = false;
    }
    if (typeof receipt.tokenCount === "number" && Number.isFinite(receipt.tokenCount)) {
      tokenCount += receipt.tokenCount;
    } else {
      hasTokenCount = false;
    }
  }
  return Object.freeze({
    latencyMs: hasLatency ? latencyMs : null,
    tokenCount: hasTokenCount ? tokenCount : null,
  });
}

function sameCensus(
  expected: Readonly<Record<string, number>>,
  observed: Readonly<Record<string, number>>,
): boolean {
  return JSON.stringify(expected) === JSON.stringify(observed);
}

interface PortfolioIfevalRightsBoundary {
  readonly rightsRiskAcceptanceDigest: Sha256Digest;
  readonly licenseCleared: false;
  readonly rightsExecutionScope: "private-internal-smoke-only";
}

function projectIfevalRightsBoundary(input: {
  readonly profile: RunPlan["profile"];
  readonly candidateType: CandidateTransport["kind"];
  readonly candidateDigest: Sha256Digest;
  readonly rightsRiskAcceptanceDigest?: Sha256Digest | undefined;
  readonly receipt: IfevalRightsRiskAcceptance;
}): PortfolioIfevalRightsBoundary {
  const receipt = validateIfevalPrivateSmokeRiskAcceptance({
    profile: input.profile,
    candidateType: input.candidateType,
    expectedDigest: input.rightsRiskAcceptanceDigest,
    expectedCandidateDigest: input.candidateDigest,
    receipt: input.receipt,
  });
  return Object.freeze({
    rightsRiskAcceptanceDigest: ifevalRightsRiskAcceptanceDigest(receipt),
    licenseCleared: false as const,
    rightsExecutionScope: "private-internal-smoke-only" as const,
  });
}

function rightsBoundaryForTrack(
  track: PortfolioTrackInput,
): PortfolioIfevalRightsBoundary | undefined {
  if (track.ifevalRightsRiskAcceptance === undefined) return undefined;
  const spec = track.plan.runSpec;
  if (spec === undefined) {
    throw new TypeError("IFEval rights risk acceptance requires an immutable RunSpec");
  }
  return projectIfevalRightsBoundary({
    profile: spec.profile,
    candidateType: spec.candidateType,
    candidateDigest: spec.candidateDigest,
    rightsRiskAcceptanceDigest: spec.rightsRiskAcceptanceDigest,
    receipt: track.ifevalRightsRiskAcceptance,
  });
}

function productBoundaryFromResult(
  result: ImmutableRunResult,
): ProductCandidateBoundary | undefined {
  const provenance = result.trackReport.provenance;
  if (provenance.candidateMode === undefined) return undefined;
  return parseProductCandidateBoundary({
    candidateMode: provenance.candidateMode,
    capabilitiesUsed: provenance.capabilitiesUsed,
    productBehaviorExercised: provenance.productBehaviorExercised,
    referenceHost: provenance.referenceHost,
    productIdentity: provenance.productIdentity,
  });
}

function projectPublicResultDigests(input: {
  readonly trackId: EvaluationTrackId;
  readonly productBoundary: ProductCandidateBoundary | undefined;
  readonly nativeEvidenceDigest: Sha256Digest;
  readonly trackReportDigest: Sha256Digest;
  readonly trialReceiptsDigest: Sha256Digest;
}): Readonly<{
  readonly nativeEvidenceDigest?: Sha256Digest;
  readonly trackReportDigest?: Sha256Digest;
  readonly trialReceiptsDigest: Sha256Digest;
  readonly privateResultDigestsWithheld?: true;
}> {
  const withholdPrivateResults =
    input.trackId === "coffee-chat-taste" ||
    (input.productBoundary?.candidateMode === "connectivity_only" &&
      input.productBoundary.productBehaviorExercised === false);
  if (withholdPrivateResults) {
    return Object.freeze({
      trialReceiptsDigest: input.trialReceiptsDigest,
      privateResultDigestsWithheld: true as const,
    });
  }
  return Object.freeze({
    nativeEvidenceDigest: input.nativeEvidenceDigest,
    trackReportDigest: input.trackReportDigest,
    trialReceiptsDigest: input.trialReceiptsDigest,
  });
}

async function executePortfolioTrack(
  track: PortfolioTrackInput,
  closeTrack: () => Promise<"complete" | "failed">,
): Promise<PortfolioTrackReceipt> {
  let result: ImmutableRunResult | undefined;
  let proxyCleanupStatus: "complete" | "failed" = "complete";
  try {
    result = await executeImmutableRun({
      plan: track.plan,
      manifest: track.manifest,
      candidate: track.candidate,
      judge: track.judge,
      runtime: track.runtime,
      ...(track.ifevalRightsRiskAcceptance === undefined
        ? {}
        : { ifevalRightsRiskAcceptance: track.ifevalRightsRiskAcceptance }),
    });
  } finally {
    proxyCleanupStatus = await closeTrack();
  }
  const cleanupStatus =
    proxyCleanupStatus === "complete" ? result.cleanupStatus : "failed";
  const executionStatus =
    cleanupStatus === "complete" ? result.trackReport.executionStatus : "invalid";
  const observed =
    executionStatus === "measured"
      ? observedCensus(track.trackId, result)
      : Object.freeze({});
  const usage = trialUsage(result);
  const productBoundary = productBoundaryFromResult(result);
  const rightsBoundary = rightsBoundaryForTrack(track);
  const resultDigests = projectPublicResultDigests({
    trackId: track.trackId,
    productBoundary,
    nativeEvidenceDigest: result.nativeEvidence.digest,
    trackReportDigest: digest(result.trackReport),
    trialReceiptsDigest: digest(
      JSON.parse(readFileSync(result.trialReceiptsPath, "utf8")) as unknown,
    ),
  });
  return Object.freeze({
    trackId: track.trackId,
    runId: result.plan.id,
    executionStatus,
    claimStatus: result.trackReport.claimStatus,
    expectedCensus: PORTFOLIO_SMOKE_CENSUS[track.trackId],
    observedCensus: observed,
    ...resultDigests,
    cleanupStatus,
    latencyMs: usage.latencyMs,
    tokenCount: usage.tokenCount,
    cost: "unavailable" as const,
    ...(rightsBoundary === undefined ? {} : rightsBoundary),
    ...(productBoundary === undefined ? {} : productBoundary),
  });
}

function writePortfolioReceipt(input: {
  readonly receipts: readonly PortfolioTrackReceipt[];
  readonly evidenceRoot: string;
  readonly productPortfolio: boolean;
  readonly productTransportSetIsCoherent: boolean;
}): PortfolioReceipt {
  const passed =
    input.productTransportSetIsCoherent &&
    input.receipts.length === 4 &&
    input.receipts.every(
      (receipt) =>
        receipt.executionStatus === "measured" &&
        receipt.claimStatus === "calibration" &&
        sameCensus(receipt.expectedCensus, receipt.observedCensus) &&
        receipt.cleanupStatus === "complete",
    ) &&
    (!input.productPortfolio ||
      (input.receipts.every(
        (receipt) =>
          receipt.candidateMode === "connectivity_only" &&
          receipt.capabilitiesUsed?.length === 0 &&
          receipt.productBehaviorExercised === false &&
          receipt.productIdentity !== undefined,
      ) &&
        new Set(
          input.receipts.map((receipt) => JSON.stringify(receipt.productIdentity)),
        ).size === 1));
  const publicValue = Object.freeze({
    schema: "portfolio-smoke-receipt-v1" as const,
    status: passed ? ("measured" as const) : ("failed" as const),
    claimStatus: passed ? ("calibration" as const) : ("mixed" as const),
    officialMeasurementEligible: false as const,
    tracks: Object.freeze([...input.receipts]),
  });
  const root = resolve(input.evidenceRoot);
  const outputPath = join(root, "portfolio-smoke", "public-receipt.json");
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  const serialized = `${JSON.stringify(publicValue, null, 2)}\n`;
  try {
    writeFileSync(outputPath, serialized, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
      throw error;
    if (readFileSync(outputPath, "utf8") !== serialized)
      throw new TypeError("portfolio receipt already contains different bytes");
  }
  return Object.freeze({ ...publicValue, publicReceiptPath: outputPath });
}

export async function executePortfolioSmoke(input: {
  readonly tracks: readonly PortfolioTrackInput[];
  readonly evidenceRoot: string;
}): Promise<PortfolioReceipt> {
  if ("runTrack" in input) {
    throw new TypeError("portfolio runTrack override is not supported");
  }
  if (input.tracks.some((track) => "executor" in track)) {
    throw new TypeError("portfolio track executor override is not supported");
  }
  const receipts: PortfolioTrackReceipt[] = [];
  const cleanupByTrack = new Map<PortfolioTrackInput, "complete" | "failed">();
  const closeTrack = async (
    track: PortfolioTrackInput,
  ): Promise<"complete" | "failed"> => {
    const recorded = cleanupByTrack.get(track);
    if (recorded !== undefined) return recorded;
    let cleanupStatus: "complete" | "failed" = "complete";
    try {
      await track.close?.();
    } catch {
      cleanupStatus = "failed";
    }
    cleanupByTrack.set(track, cleanupStatus);
    return cleanupStatus;
  };
  try {
    const expectedTracks = Object.keys(PORTFOLIO_SMOKE_CENSUS).sort();
    const suppliedTracks = input.tracks.map((track) => track.trackId).sort();
    if (JSON.stringify(expectedTracks) !== JSON.stringify(suppliedTracks)) {
      throw new TypeError("portfolio must contain exactly the four admitted tracks");
    }
    const productPortfolio = input.tracks.some(
      (track) => track.candidate.kind === "coffee_chat_product",
    );
    const productTransportSetIsCoherent =
      !productPortfolio ||
      input.tracks.every(
        (track) =>
          track.candidate.kind === "coffee_chat_product" &&
          track.candidate.productBoundary !== undefined,
      );
    for (const track of input.tracks) {
      receipts.push(await executePortfolioTrack(track, () => closeTrack(track)));
    }
    return writePortfolioReceipt({
      receipts,
      evidenceRoot: input.evidenceRoot,
      productPortfolio,
      productTransportSetIsCoherent,
    });
  } catch (error) {
    for (const track of input.tracks) await closeTrack(track);
    throw error;
  }
}

export function getPortfolioManifest(trackId: EvaluationTrackId): SourceManifest {
  return getSourceManifest(trackId);
}

function configRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function absoluteConfigPath(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return resolve(value);
}

interface PortfolioTrackBrokerInput {
  readonly config: PortfolioBrokerConfig;
  readonly candidateModel: string;
  readonly judgeModel: string;
  readonly caps: Readonly<{ candidate: number; judge: number }>;
  readonly productPackageRoot?: string;
}

interface PortfolioTrackBrokerHandle {
  readonly runtime: RuntimeBundleConfig;
  readonly close: () => Promise<void>;
}

export interface PortfolioSmokeConfigDependencies {
  readonly startBroker?:
    | ((input: PortfolioTrackBrokerInput) => Promise<PortfolioTrackBrokerHandle>)
    | undefined;
}

async function startTrackBroker(
  input: PortfolioTrackBrokerInput,
): Promise<PortfolioTrackBrokerHandle> {
  return startResponsesProxyProcess({
    providerEnvFile: input.config.providerEnvFile,
    providerKeyEnv: input.config.providerKeyEnv,
    ...(input.config.upstreamUrl === undefined
      ? {}
      : { upstreamUrl: input.config.upstreamUrl }),
    candidateModel: input.candidateModel,
    judgeModel: input.judgeModel,
    candidateMaxRequests: input.caps.candidate,
    judgeMaxRequests: input.caps.judge,
    ttlSeconds: input.config.ttlSeconds ?? 900,
    ...(input.productPackageRoot === undefined
      ? {}
      : { productPackageRoot: input.productPackageRoot }),
  });
}

function exactConfigKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in record)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}

interface PreflightedPortfolioTrack {
  readonly trackId: EvaluationTrackId;
  readonly plan: RunPlan;
  readonly manifest: SourceManifest;
  readonly candidateIdentity: CandidateIdentityConfig;
  readonly judgeIdentity: JudgeIdentityConfig;
  readonly caps: Readonly<{ candidate: number; judge: number }>;
  readonly source: MaterializedSourceVerification;
  readonly runtime?: RuntimeBundleConfig | undefined;
  readonly ifevalRightsRiskAcceptance?: IfevalRightsRiskAcceptance | undefined;
}

interface PreflightedPortfolio {
  readonly evidenceRoot: string;
  readonly productPackageRoot?: string | undefined;
  readonly brokerConfig?: PortfolioBrokerConfig | undefined;
  readonly candidateType: CandidateIdentityConfig["candidateType"];
  readonly tracks: readonly PreflightedPortfolioTrack[];
}

function validatePortfolioRuntime(input: {
  readonly track: Pick<
    PreflightedPortfolioTrack,
    "trackId" | "plan" | "candidateIdentity" | "judgeIdentity" | "caps"
  >;
  readonly runtime: RuntimeBundleConfig | undefined;
  readonly productPackageRoot: string | undefined;
}): void {
  const { track, runtime } = input;
  const spec = track.plan.runSpec!;
  if (spec.candidateType !== "fixture" && runtime === undefined) {
    throw new TypeError(`${track.trackId} requires a private runtime bundle`);
  }
  if (
    track.candidateIdentity.candidateType === "coffee_chat_product" &&
    runtime?.productHost === undefined
  ) {
    throw new TypeError(`${track.trackId} requires a private Product reference host`);
  }
  if (
    track.candidateIdentity.candidateType !== "coffee_chat_product" &&
    runtime?.productHost !== undefined
  ) {
    throw new TypeError(`${track.trackId} must not receive a Product reference host`);
  }
  if (
    runtime?.productHost !== undefined &&
    input.productPackageRoot !== undefined &&
    runtime.productHost.packageRoot !== input.productPackageRoot
  ) {
    throw new TypeError(
      `${track.trackId} Product package root does not match portfolio`,
    );
  }
  if (runtime !== undefined) {
    if (runtime.candidate.model !== track.candidateIdentity.model) {
      throw new TypeError(
        `${track.trackId} candidate runtime model does not match identity`,
      );
    }
    if (
      runtime.judge !== undefined &&
      runtime.judge.model !== track.judgeIdentity.model
    ) {
      throw new TypeError(
        `${track.trackId} Judge runtime model does not match identity`,
      );
    }
    if (runtime.candidate.maxRequests !== track.caps.candidate) {
      throw new TypeError(
        `${track.trackId} candidate cap must be ${track.caps.candidate}`,
      );
    }
    if (track.caps.judge === 0 && runtime.judge !== undefined) {
      throw new TypeError(`${track.trackId} must not receive a Judge capability`);
    }
    if (
      track.caps.judge > 0 &&
      (runtime.judge === undefined || runtime.judge.maxRequests !== track.caps.judge)
    ) {
      throw new TypeError(`${track.trackId} Judge cap must be ${track.caps.judge}`);
    }
  }
  const runtimeFailure = validateRuntimeForRun({ plan: track.plan, runtime });
  if (runtimeFailure !== undefined) {
    throw new TypeError(`${track.trackId} runtime preflight: ${runtimeFailure.reason}`);
  }
}

function rightsHold(error: unknown): TypeError {
  const reason = error instanceof Error ? error.message : String(error);
  return new TypeError(`rights_hold/rights: ${reason}`);
}

async function preflightPortfolioSmokeConfig(
  configPath: string,
): Promise<PreflightedPortfolio> {
  const config = configRecord(
    readBoundedJson(
      absoluteConfigPath(configPath, "configPath"),
      PORTFOLIO_JSON_BYTES,
      "portfolio config",
    ),
    "portfolio config",
  );
  exactConfigKeys(
    config,
    ["schema", "evidenceRoot", "cacheRoot", "tracks"],
    ["broker", "productPackageRoot", "ifevalRightsRiskAcceptanceReceipt"],
    "portfolio config",
  );
  if (config.schema !== "portfolio-smoke-config-v1") {
    throw new TypeError("portfolio config schema is unsupported");
  }
  const evidenceRoot = absoluteConfigPath(config.evidenceRoot, "evidenceRoot");
  const cacheRoot = absoluteConfigPath(config.cacheRoot, "cacheRoot");
  const productPackageRoot =
    config.productPackageRoot === undefined
      ? undefined
      : absoluteConfigPath(config.productPackageRoot, "productPackageRoot");
  const acceptancePath =
    config.ifevalRightsRiskAcceptanceReceipt === undefined
      ? undefined
      : absoluteConfigPath(
          config.ifevalRightsRiskAcceptanceReceipt,
          "ifevalRightsRiskAcceptanceReceipt",
        );
  let acceptance: IfevalRightsRiskAcceptance | undefined;
  if (acceptancePath !== undefined) {
    try {
      acceptance = parseIfevalRightsRiskAcceptance(
        readBoundedJson(
          acceptancePath,
          PORTFOLIO_JSON_BYTES,
          "IFEval rights risk acceptance receipt",
        ),
      );
    } catch (error) {
      throw rightsHold(error);
    }
  }
  const brokerConfig =
    config.broker === undefined ? undefined : parsePortfolioBrokerConfig(config.broker);
  if (!Array.isArray(config.tracks) || config.tracks.length !== 4) {
    throw new TypeError("portfolio config must contain four tracks");
  }
  const entries = config.tracks.map((rawTrack) => {
    const entry = configRecord(rawTrack, "portfolio track");
    exactConfigKeys(entry, ["trackId", "planPath"], ["runtimePath"], "portfolio track");
    const trackId = entry.trackId as EvaluationTrackId;
    if (!(trackId in PORTFOLIO_SMOKE_CAPS)) {
      throw new TypeError(`portfolio track is unsupported: ${String(trackId)}`);
    }
    return Object.freeze({
      trackId,
      planPath: absoluteConfigPath(entry.planPath, `${trackId}.planPath`),
      runtimePath:
        entry.runtimePath === undefined
          ? undefined
          : absoluteConfigPath(entry.runtimePath, `${trackId}.runtimePath`),
    });
  });
  const expectedTracks = Object.keys(PORTFOLIO_SMOKE_CAPS).sort();
  const suppliedTracks = entries.map((entry) => entry.trackId).sort();
  if (JSON.stringify(expectedTracks) !== JSON.stringify(suppliedTracks)) {
    throw new TypeError("portfolio must contain exactly the four admitted tracks");
  }

  let portfolioCandidateType: CandidateIdentityConfig["candidateType"] | undefined;
  let portfolioProductIdentityDigest: Sha256Digest | undefined;
  let portfolioProductIdentity: CoffeeChatProductCandidateIdentityConfig | undefined;
  const parsedTracks = entries.map((entry) => {
    const { trackId } = entry;
    const envelope = configRecord(
      readBoundedJson(entry.planPath, PORTFOLIO_JSON_BYTES, `${trackId} plan`),
      `${trackId} plan`,
    );
    const manifest = parseSourceManifest(
      envelope.sourceManifest ?? getSourceManifest(trackId),
    );
    const spec = parseRunSpec(envelope.runSpec);
    if (
      spec.trackId !== trackId ||
      (spec.profile !== "smoke" && spec.profile !== "fixture")
    ) {
      throw new TypeError(`${trackId} must use smoke or fixture profile`);
    }
    const plan = createRunPlan({ manifest, spec, evidenceRoot, cacheRoot });
    const candidateIdentity = parseCandidateIdentityConfig(
      envelope.candidateIdentity ?? {
        schema: "candidate-config-v1",
        candidateType: spec.candidateType ?? "fixture",
        harness: "portfolio-v1",
        model: spec.candidateType === "fixture" ? "fixture" : "gpt-5.6-luna",
      },
    );
    if (candidateIdentity.candidateType !== spec.candidateType) {
      throw new TypeError(
        `${trackId} candidate identity type does not match run spec candidateType`,
      );
    }
    if (candidateIdentityDigest(candidateIdentity) !== spec.candidateDigest) {
      throw new TypeError(`${trackId} candidate identity digest mismatch`);
    }
    if (portfolioCandidateType === undefined) {
      portfolioCandidateType = candidateIdentity.candidateType;
    } else if (portfolioCandidateType !== candidateIdentity.candidateType) {
      throw new TypeError("portfolio tracks must use one candidate type");
    }
    if (candidateIdentity.candidateType === "coffee_chat_product") {
      const productDigest = digest(candidateIdentity.product);
      if (portfolioProductIdentityDigest === undefined) {
        portfolioProductIdentityDigest = productDigest;
        portfolioProductIdentity = candidateIdentity;
      } else if (portfolioProductIdentityDigest !== productDigest) {
        throw new TypeError("portfolio tracks must pin one Product identity");
      }
    }
    const judgeIdentity = parseJudgeIdentityConfig(
      envelope.judgeIdentity ?? {
        schema: "judge-config-v1",
        transport: "responses",
        model: "gpt-5.6-luna",
      },
    );
    if (judgeIdentityDigest(judgeIdentity) !== spec.judgeDigest) {
      throw new TypeError(`${trackId} Judge identity digest mismatch`);
    }
    if (brokerConfig !== undefined && entry.runtimePath !== undefined) {
      throw new TypeError(`${trackId} cannot combine broker config and runtimePath`);
    }
    if (
      candidateIdentity.candidateType === "coffee_chat_product" &&
      brokerConfig !== undefined &&
      productPackageRoot === undefined
    ) {
      throw new TypeError(`${trackId} broker runtime requires productPackageRoot`);
    }
    const runtime =
      entry.runtimePath === undefined
        ? undefined
        : parseRuntimeBundleConfig(
            readBoundedJson(
              entry.runtimePath,
              PORTFOLIO_JSON_BYTES,
              `${trackId} runtime bundle`,
            ),
          );
    return Object.freeze({
      trackId,
      plan,
      manifest,
      candidateIdentity,
      judgeIdentity,
      caps: PORTFOLIO_SMOKE_CAPS[trackId],
      runtime,
    });
  });

  if (portfolioCandidateType === undefined) {
    throw new TypeError("portfolio candidate type is missing");
  }
  if (
    productPackageRoot !== undefined &&
    portfolioCandidateType !== "coffee_chat_product"
  ) {
    throw new TypeError(
      "productPackageRoot is only valid for a coffee_chat_product portfolio",
    );
  }

  const ifevalTrack = parsedTracks.find((track) => track.trackId === "ifeval")!;
  let ifevalRightsRiskAcceptance: IfevalRightsRiskAcceptance | undefined;
  if (ifevalTrack.plan.profile === "fixture") {
    if (acceptance !== undefined) {
      throw rightsHold(
        new TypeError(
          "IFEval rights risk acceptance is outside its admitted run scope",
        ),
      );
    }
  } else {
    if (acceptance === undefined) {
      throw rightsHold(
        new TypeError(`${IFEVAL_NATIVE_RUNTIME_RIGHTS.asset} license is unclarified`),
      );
    }
    try {
      projectIfevalRightsBoundary({
        profile: ifevalTrack.plan.profile,
        candidateType: ifevalTrack.candidateIdentity.candidateType,
        candidateDigest: ifevalTrack.plan.runSpec!.candidateDigest,
        rightsRiskAcceptanceDigest:
          ifevalTrack.plan.runSpec!.rightsRiskAcceptanceDigest,
        receipt: acceptance,
      });
      ifevalRightsRiskAcceptance = acceptance;
    } catch (error) {
      throw rightsHold(error);
    }
  }

  for (const track of parsedTracks) {
    if (brokerConfig === undefined || track.plan.runSpec!.candidateType === "fixture") {
      validatePortfolioRuntime({
        track,
        runtime: track.runtime,
        productPackageRoot,
      });
    }
  }

  const tracksWithSources: PreflightedPortfolioTrack[] = [];
  for (const track of parsedTracks) {
    if (track.plan.runSpec!.candidateType !== "fixture") {
      const manifestDigest = verifySourceManifestPins(track.manifest);
      if (manifestDigest !== track.plan.sourceManifestDigest) {
        throw new TypeError(`${track.trackId} source manifest digest mismatch`);
      }
    }
    const expectedRuntimeLockPath = evalOwnedRuntimeLockForTrack(track.trackId);
    const source = verifyMaterializedSource({
      manifest: track.manifest,
      cacheRoot,
      ...(expectedRuntimeLockPath === undefined ? {} : { expectedRuntimeLockPath }),
    });
    tracksWithSources.push(
      Object.freeze({
        ...track,
        source,
        ...(track.trackId === "ifeval" && ifevalRightsRiskAcceptance !== undefined
          ? { ifevalRightsRiskAcceptance }
          : {}),
      }),
    );
  }

  if (ifevalRightsRiskAcceptance !== undefined) {
    await preflightIfevalRuntimeAsset(
      tracksWithSources.find((track) => track.trackId === "ifeval")!.source.sourceRoot,
    );
  }

  if (portfolioCandidateType === "coffee_chat_product") {
    if (productPackageRoot === undefined || portfolioProductIdentity === undefined) {
      throw new TypeError("coffee_chat_product portfolio requires productPackageRoot");
    }
    const verification = await verifyCoffeeChatProductPackage({
      packageRoot: productPackageRoot,
      identity: portfolioProductIdentity.product,
    });
    if (verification.state !== "verified") {
      throw new TypeError(`Product package preflight failed: ${verification.reason}`);
    }
  }

  return Object.freeze({
    evidenceRoot,
    ...(productPackageRoot === undefined ? {} : { productPackageRoot }),
    ...(brokerConfig === undefined ? {} : { brokerConfig }),
    candidateType: portfolioCandidateType,
    tracks: Object.freeze(tracksWithSources),
  });
}

async function createPortfolioTrackInput(input: {
  readonly track: PreflightedPortfolioTrack;
  readonly runtime: RuntimeBundleConfig | undefined;
  readonly evidenceRoot: string;
  readonly close?: (() => Promise<void>) | undefined;
}): Promise<PortfolioTrackInput> {
  const { track, runtime } = input;
  const spec = track.plan.runSpec!;
  const baseCandidate =
    spec.candidateType === "fixture"
      ? createFixtureCandidateTransport(
          (value) =>
            track.trackId === "coffee-chat-taste"
              ? {
                  artifact: {
                    mediaType: "text/plain",
                    content: JSON.stringify(value),
                  },
                  decisionRecord: {
                    decision: "fixture",
                    evidenceUse: [],
                    tradeoffs: [],
                    constraints: [],
                    uncertainty: null,
                  },
                }
              : { value },
          { evidenceRoot: input.evidenceRoot },
        )
      : createResponsesCandidateTransport({
          kind:
            track.candidateIdentity.candidateType === "reference_model"
              ? "reference_model"
              : "agent_stack",
          endpoint: runtime!.candidate.endpoint,
          capability: runtime!.candidate.capabilityToken,
          model: runtime!.candidate.model,
          evidenceRoot: input.evidenceRoot,
        });
  const candidate =
    track.candidateIdentity.candidateType !== "coffee_chat_product" ||
    runtime?.productHost === undefined
      ? baseCandidate
      : (
          await prepareCoffeeChatProductCandidateTransport({
            packageRoot: runtime.productHost.packageRoot,
            identity: track.candidateIdentity.product,
            delegate: baseCandidate,
          })
        ).transport;
  const judge =
    runtime?.judge === undefined
      ? track.trackId === "coffee-chat-taste" || track.trackId === "beam-record-core"
        ? createFixtureJudgeTransport(() => ({ score: 1 }), {
            evidenceRoot: input.evidenceRoot,
          })
        : undefined
      : createResponsesJudgeTransport({
          endpoint: runtime.judge.endpoint,
          capability: runtime.judge.capabilityToken,
          model: runtime.judge.model,
          evidenceRoot: input.evidenceRoot,
        });
  return Object.freeze({
    trackId: track.trackId,
    plan: track.plan,
    manifest: track.manifest,
    candidate,
    judge,
    runtime,
    ...(track.ifevalRightsRiskAcceptance === undefined
      ? {}
      : { ifevalRightsRiskAcceptance: track.ifevalRightsRiskAcceptance }),
    ...(input.close === undefined ? {} : { close: input.close }),
  });
}

/** Execute an operator-owned private portfolio config. */
export async function runPortfolioSmokeConfig(
  configPath: string,
  dependencies: PortfolioSmokeConfigDependencies = {},
): Promise<PortfolioReceipt> {
  const preflight = await preflightPortfolioSmokeConfig(configPath);
  const receipts: PortfolioTrackReceipt[] = [];
  for (const staticTrack of preflight.tracks) {
    let broker: PortfolioTrackBrokerHandle | undefined;
    let closeStatus: "complete" | "failed" | undefined;
    const closeCurrent = async (): Promise<"complete" | "failed"> => {
      if (closeStatus !== undefined) return closeStatus;
      try {
        await broker?.close();
        closeStatus = "complete";
      } catch {
        closeStatus = "failed";
      }
      return closeStatus;
    };
    try {
      broker =
        preflight.brokerConfig === undefined ||
        staticTrack.plan.runSpec!.candidateType === "fixture"
          ? undefined
          : await (dependencies.startBroker ?? startTrackBroker)({
              config: preflight.brokerConfig,
              candidateModel: staticTrack.candidateIdentity.model,
              judgeModel: staticTrack.judgeIdentity.model,
              caps: staticTrack.caps,
              ...(staticTrack.candidateIdentity.candidateType ===
                "coffee_chat_product" && preflight.productPackageRoot !== undefined
                ? { productPackageRoot: preflight.productPackageRoot }
                : {}),
            });
      const runtime = broker?.runtime ?? staticTrack.runtime;
      validatePortfolioRuntime({
        track: staticTrack,
        runtime,
        productPackageRoot: preflight.productPackageRoot,
      });
      const track = await createPortfolioTrackInput({
        track: staticTrack,
        runtime,
        evidenceRoot: preflight.evidenceRoot,
        close: broker === undefined ? undefined : broker.close,
      });
      receipts.push(await executePortfolioTrack(track, closeCurrent));
    } catch (error) {
      const cleanupStatus = await closeCurrent();
      if (cleanupStatus === "failed") {
        const message = error instanceof Error ? error.message : String(error);
        throw new AggregateError([error], `${message}; broker cleanup also failed`);
      }
      throw error;
    }
  }
  return writePortfolioReceipt({
    receipts,
    evidenceRoot: preflight.evidenceRoot,
    productPortfolio: preflight.candidateType === "coffee_chat_product",
    productTransportSetIsCoherent: true,
  });
}

/** Narrow test surface for validating the public-safe projection only. */
export const portfolioTestOnly = Object.freeze({
  projectIfevalRightsBoundary,
  projectPublicResultDigests,
});
