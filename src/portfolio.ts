import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ImmutableRunResult } from "./run-engine.ts";
import { executeImmutableRun, type TrackExecutor } from "./run-engine.ts";
import {
  parseRunSpec,
  parseSourceManifest,
  createRunPlan,
  type CandidateTransport,
  type JudgeTransport,
} from "./eval-core.ts";
import {
  candidateIdentityDigest,
  judgeIdentityDigest,
  parseCandidateIdentityConfig,
  parseJudgeIdentityConfig,
  parseRuntimeBundleConfig,
  type RuntimeBundleConfig,
} from "./runtime-config.ts";
import type { RunPlan, SourceManifest } from "./eval-core.ts";
import type { EvaluationTrackId } from "./track-registry.ts";
import type { Sha256Digest } from "./types.ts";
import { getSourceManifest } from "./source-manifests.ts";
import { getNativeTrackExecutor } from "./native-executors.ts";
import {
  createFixtureCandidateTransport,
  createFixtureJudgeTransport,
  createResponsesCandidateTransport,
  createResponsesJudgeTransport,
} from "./transports.ts";
import { startResponsesProxy, type ResponsesProxyHandle } from "./responses-proxy.ts";

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
  readonly executor?: TrackExecutor;
  readonly close?: (() => Promise<void>) | undefined;
}

export interface PortfolioTrackReceipt {
  readonly trackId: EvaluationTrackId;
  readonly runId: string;
  readonly executionStatus: string;
  readonly claimStatus: string;
  readonly expectedCensus: Readonly<Record<string, number>>;
  readonly observedCensus: Readonly<Record<string, number>>;
  readonly nativeEvidenceDigest: Sha256Digest;
  readonly trackReportDigest: Sha256Digest;
  readonly trialReceiptsDigest: Sha256Digest;
  readonly cleanupStatus: string;
  readonly latencyMs: number | null;
  readonly tokenCount: number | null;
  readonly cost: "available" | "unavailable";
}

export interface PortfolioReceipt {
  readonly schema: "portfolio-smoke-receipt-v1";
  readonly status: "measured" | "failed";
  readonly claimStatus: "calibration" | "mixed";
  readonly tracks: readonly PortfolioTrackReceipt[];
  readonly publicReceiptPath: string;
}

export interface PortfolioBrokerConfig {
  readonly providerKeyEnv: string;
  readonly upstreamUrl?: string;
  readonly ttlSeconds?: number;
}

function exactBrokerKeys(record: Record<string, unknown>): void {
  const allowed = new Set(["providerKeyEnv", "upstreamUrl", "ttlSeconds"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new TypeError(
      "portfolio broker config rejects providerKey bytes or unknown fields",
    );
  }
}

export function parsePortfolioBrokerConfig(value: unknown): PortfolioBrokerConfig {
  const record = configRecord(value, "portfolio broker config");
  exactBrokerKeys(record);
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
    const parsed = new URL(upstreamUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError("portfolio broker upstreamUrl must use HTTP or HTTPS");
    }
  }
  const ttlSeconds = record.ttlSeconds;
  if (
    ttlSeconds !== undefined &&
    (!Number.isSafeInteger(ttlSeconds) || (ttlSeconds as number) < 60)
  ) {
    throw new TypeError("portfolio broker ttlSeconds must be at least 60");
  }
  return Object.freeze({
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

export async function executePortfolioSmoke(input: {
  readonly tracks: readonly PortfolioTrackInput[];
  readonly evidenceRoot: string;
  readonly runTrack?:
    ((track: PortfolioTrackInput) => Promise<ImmutableRunResult>) | undefined;
}): Promise<PortfolioReceipt> {
  const expectedTracks = Object.keys(PORTFOLIO_SMOKE_CENSUS).sort();
  const suppliedTracks = input.tracks.map((track) => track.trackId).sort();
  if (JSON.stringify(expectedTracks) !== JSON.stringify(suppliedTracks)) {
    throw new TypeError("portfolio must contain exactly the four admitted tracks");
  }
  const receipts: PortfolioTrackReceipt[] = [];
  for (const track of input.tracks) {
    let result: ImmutableRunResult | undefined;
    let cleanupStatus: string = "complete";
    try {
      result = await (input.runTrack === undefined
        ? executeImmutableRun({
            plan: track.plan,
            manifest: track.manifest,
            candidate: track.candidate,
            judge: track.judge,
            runtime: track.runtime,
            executor:
              track.executor ??
              (async () => {
                throw new TypeError("portfolio track executor is not registered");
              }),
          })
        : input.runTrack(track));
    } finally {
      try {
        await track.close?.();
      } catch {
        cleanupStatus = "failed";
      }
    }
    if (result !== undefined) {
      cleanupStatus = cleanupStatus === "complete" ? result.cleanupStatus : "failed";
      const executionStatus =
        cleanupStatus === "complete" ? result.trackReport.executionStatus : "invalid";
      const observed =
        executionStatus === "measured"
          ? observedCensus(track.trackId, result)
          : Object.freeze({});
      const usage = trialUsage(result);
      receipts.push(
        Object.freeze({
          trackId: track.trackId,
          runId: result.plan.id,
          executionStatus,
          claimStatus: result.trackReport.claimStatus,
          expectedCensus: PORTFOLIO_SMOKE_CENSUS[track.trackId],
          observedCensus: observed,
          nativeEvidenceDigest: result.nativeEvidence.digest,
          trackReportDigest: digest(result.trackReport),
          trialReceiptsDigest: digest(
            JSON.parse(readFileSync(result.trialReceiptsPath, "utf8")) as unknown,
          ),
          cleanupStatus,
          latencyMs: usage.latencyMs,
          tokenCount: usage.tokenCount,
          cost: "unavailable",
        }),
      );
    }
  }
  const passed =
    receipts.length === 4 &&
    receipts.every(
      (receipt) =>
        receipt.executionStatus === "measured" &&
        receipt.claimStatus === "calibration" &&
        sameCensus(receipt.expectedCensus, receipt.observedCensus) &&
        receipt.cleanupStatus === "complete",
    );
  const publicValue = Object.freeze({
    schema: "portfolio-smoke-receipt-v1" as const,
    status: passed ? ("measured" as const) : ("failed" as const),
    claimStatus: passed ? ("calibration" as const) : ("mixed" as const),
    tracks: Object.freeze(receipts),
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

async function startTrackBroker(input: {
  readonly config: PortfolioBrokerConfig;
  readonly candidateModel: string;
  readonly judgeModel: string;
  readonly caps: Readonly<{ candidate: number; judge: number }>;
}): Promise<{
  readonly runtime: RuntimeBundleConfig;
  readonly close: () => Promise<void>;
}> {
  const providerKey = process.env[input.config.providerKeyEnv];
  if (providerKey === undefined || providerKey.length === 0) {
    throw new TypeError(
      `host broker environment variable is missing: ${input.config.providerKeyEnv}`,
    );
  }
  const allowedUpstream =
    input.config.upstreamUrl === undefined ? undefined : input.config.upstreamUrl;
  const handles: ResponsesProxyHandle[] = [];
  try {
    const candidate = await startResponsesProxy({
      apiKey: providerKey,
      allowedModels: [input.candidateModel],
      ...(allowedUpstream === undefined ? {} : { upstreamUrl: allowedUpstream }),
      bindHost: "127.0.0.1",
      advertisedHost: "127.0.0.1",
      maxRequests: input.caps.candidate,
    });
    handles.push(candidate);
    let judge: ResponsesProxyHandle | undefined;
    if (input.caps.judge > 0) {
      judge = await startResponsesProxy({
        apiKey: providerKey,
        allowedModels: [input.judgeModel],
        ...(allowedUpstream === undefined ? {} : { upstreamUrl: allowedUpstream }),
        bindHost: "127.0.0.1",
        advertisedHost: "127.0.0.1",
        maxRequests: input.caps.judge,
      });
      handles.push(judge);
    }
    const ttlSeconds = input.config.ttlSeconds ?? 900;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const runtime = parseRuntimeBundleConfig({
      schema: "runtime-bundle-v1",
      candidate: {
        schema: "runtime-capability-v1",
        scope: "candidate",
        endpoint: `${candidate.baseUrl}/responses`,
        capabilityToken: candidate.capabilityToken,
        model: input.candidateModel,
        expiresAt,
        maxRequests: input.caps.candidate,
      },
      ...(judge === undefined
        ? {}
        : {
            judge: {
              schema: "runtime-capability-v1",
              scope: "judge" as const,
              endpoint: `${judge.baseUrl}/responses`,
              capabilityToken: judge.capabilityToken,
              model: input.judgeModel,
              expiresAt,
              maxRequests: input.caps.judge,
            },
          }),
    });
    return Object.freeze({
      runtime,
      close: async () => {
        let firstError: unknown;
        for (const handle of handles.reverse()) {
          try {
            await handle.close();
          } catch (error) {
            firstError ??= error;
          }
        }
        if (firstError !== undefined) throw firstError;
      },
    });
  } catch (error) {
    for (const handle of handles.reverse()) await handle.close();
    throw error;
  }
}

/** Execute an operator-owned private portfolio config. */
export async function runPortfolioSmokeConfig(
  configPath: string,
): Promise<PortfolioReceipt> {
  const config = configRecord(
    JSON.parse(readFileSync(absoluteConfigPath(configPath, "configPath"), "utf8")),
    "portfolio config",
  );
  if (config.schema !== "portfolio-smoke-config-v1") {
    throw new TypeError("portfolio config schema is unsupported");
  }
  const evidenceRoot = absoluteConfigPath(config.evidenceRoot, "evidenceRoot");
  const cacheRoot = absoluteConfigPath(config.cacheRoot, "cacheRoot");
  if (!Array.isArray(config.tracks) || config.tracks.length !== 4) {
    throw new TypeError("portfolio config must contain four tracks");
  }
  const tracks: PortfolioTrackInput[] = [];
  for (const rawTrack of config.tracks) {
    const entry = configRecord(rawTrack, "portfolio track");
    const trackId = entry.trackId as EvaluationTrackId;
    if (!(trackId in PORTFOLIO_SMOKE_CAPS)) {
      throw new TypeError(`portfolio track is unsupported: ${String(trackId)}`);
    }
    const planPath = absoluteConfigPath(entry.planPath, `${trackId}.planPath`);
    const envelope = configRecord(
      JSON.parse(readFileSync(planPath, "utf8")),
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
    if (candidateIdentityDigest(candidateIdentity) !== spec.candidateDigest) {
      throw new TypeError(`${trackId} candidate identity digest mismatch`);
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
    const caps = PORTFOLIO_SMOKE_CAPS[trackId];
    const brokerConfig =
      config.broker === undefined
        ? undefined
        : parsePortfolioBrokerConfig(config.broker);
    const runtimePath =
      entry.runtimePath === undefined
        ? undefined
        : absoluteConfigPath(entry.runtimePath, `${trackId}.runtimePath`);
    if (brokerConfig !== undefined && runtimePath !== undefined) {
      throw new TypeError(`${trackId} cannot combine broker config and runtimePath`);
    }
    const broker =
      brokerConfig === undefined || spec.candidateType === "fixture"
        ? undefined
        : await startTrackBroker({
            config: brokerConfig,
            candidateModel: candidateIdentity.model,
            judgeModel: judgeIdentity.model,
            caps,
          });
    const runtime =
      broker?.runtime ??
      (runtimePath === undefined
        ? undefined
        : parseRuntimeBundleConfig(JSON.parse(readFileSync(runtimePath, "utf8"))));
    if (spec.candidateType !== "fixture" && runtime === undefined) {
      throw new TypeError(`${trackId} requires a private runtime bundle`);
    }
    if (runtime !== undefined) {
      if (runtime.candidate.model !== candidateIdentity.model) {
        throw new TypeError(
          `${trackId} candidate runtime model does not match identity`,
        );
      }
      if (runtime.judge !== undefined && runtime.judge.model !== judgeIdentity.model) {
        throw new TypeError(`${trackId} Judge runtime model does not match identity`);
      }
      if (runtime.candidate.maxRequests !== caps.candidate) {
        throw new TypeError(`${trackId} candidate cap must be ${caps.candidate}`);
      }
      if (caps.judge === 0 && runtime.judge !== undefined) {
        throw new TypeError(`${trackId} must not receive a Judge capability`);
      }
      if (
        caps.judge > 0 &&
        (runtime.judge === undefined || runtime.judge.maxRequests !== caps.judge)
      ) {
        throw new TypeError(`${trackId} Judge cap must be ${caps.judge}`);
      }
    }
    const candidate =
      spec.candidateType === "fixture"
        ? createFixtureCandidateTransport(
            (value) =>
              trackId === "coffee-chat-taste"
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
            { evidenceRoot },
          )
        : runtime === undefined
          ? createResponsesCandidateTransport({
              endpoint: "http://127.0.0.1:1",
              capability: "missing",
              model: candidateIdentity.model,
              evidenceRoot,
            })
          : createResponsesCandidateTransport({
              endpoint: runtime.candidate.endpoint,
              capability: runtime.candidate.capabilityToken,
              model: runtime.candidate.model,
              evidenceRoot,
            });
    const judge =
      runtime?.judge === undefined
        ? trackId === "coffee-chat-taste" || trackId === "beam-record-core"
          ? createFixtureJudgeTransport(() => ({ score: 1 }), { evidenceRoot })
          : undefined
        : createResponsesJudgeTransport({
            endpoint: runtime.judge.endpoint,
            capability: runtime.judge.capabilityToken,
            model: runtime.judge.model,
            evidenceRoot,
          });
    tracks.push({
      trackId,
      plan,
      manifest,
      candidate,
      judge,
      runtime,
      executor: getNativeTrackExecutor(trackId),
      close: broker?.close,
    });
  }
  return executePortfolioSmoke({ tracks, evidenceRoot });
}
