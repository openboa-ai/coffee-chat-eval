import { stableDigest } from "./identity.ts";
import type { Sha256Digest } from "./types.ts";

export type CandidateType =
  | "fixture"
  | "reference_model"
  | "agent_stack"
  | "coffee_chat_product";

export interface CandidateIdentityConfig {
  readonly schema: "candidate-config-v1";
  readonly candidateType: CandidateType;
  readonly harness: string;
  readonly model: string;
  readonly seed?: number;
}

export interface JudgeIdentityConfig {
  readonly schema: "judge-config-v1";
  readonly transport: "responses";
  readonly model: string;
}

export interface RuntimeCapabilityConfig {
  readonly schema: "runtime-capability-v1";
  readonly scope: "candidate" | "judge";
  readonly endpoint: string;
  readonly capabilityToken: string;
  readonly model: string;
  readonly expiresAt: string;
  readonly maxRequests: number;
}

export interface RuntimeBundleConfig {
  readonly schema: "runtime-bundle-v1";
  readonly candidate: RuntimeCapabilityConfig;
  readonly judge?: RuntimeCapabilityConfig;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must not be empty`);
  return value;
}

function exactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in record)) || Object.keys(record).some((key) => !allowed.has(key))) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}

function seed(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError("seed must be a non-negative integer");
  return value as number;
}

export function parseCandidateIdentityConfig(value: unknown): CandidateIdentityConfig {
  const record = object(value, "candidate config");
  exactKeys(record, ["schema", "candidateType", "harness", "model"], ["seed"], "candidate config");
  if (record.schema !== "candidate-config-v1") throw new TypeError("candidate config schema is unsupported");
  if (
    record.candidateType !== "fixture" &&
    record.candidateType !== "reference_model" &&
    record.candidateType !== "agent_stack" &&
    record.candidateType !== "coffee_chat_product"
  ) throw new TypeError("candidate config candidateType is unsupported");
  const parsedSeed = record.seed === undefined ? undefined : seed(record.seed);
  return Object.freeze({
    schema: "candidate-config-v1",
    candidateType: record.candidateType,
    harness: text(record.harness, "candidate harness"),
    model: text(record.model, "candidate model"),
    ...(parsedSeed === undefined ? {} : { seed: parsedSeed }),
  });
}

export function parseJudgeIdentityConfig(value: unknown): JudgeIdentityConfig {
  const record = object(value, "judge config");
  exactKeys(record, ["schema", "transport", "model"], [], "judge config");
  if (record.schema !== "judge-config-v1") throw new TypeError("judge config schema is unsupported");
  if (record.transport !== "responses") throw new TypeError("judge transport is unsupported");
  return Object.freeze({
    schema: "judge-config-v1",
    transport: "responses" as const,
    model: text(record.model, "judge model"),
  });
}

function localEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new TypeError("runtime endpoint must use HTTP or HTTPS");
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(endpoint.hostname)) throw new TypeError("runtime endpoint must be host-local");
  return endpoint.toString();
}

export function parseRuntimeCapabilityConfig(value: unknown): RuntimeCapabilityConfig {
  const record = object(value, "runtime capability");
  exactKeys(record, ["schema", "scope", "endpoint", "capabilityToken", "model", "expiresAt", "maxRequests"], [], "runtime capability");
  if (record.schema !== "runtime-capability-v1") throw new TypeError("runtime capability schema is unsupported");
  if (record.scope !== "candidate" && record.scope !== "judge") throw new TypeError("runtime capability scope is unsupported");
  const expiresAt = text(record.expiresAt, "runtime capability expiry");
  if (Number.isNaN(Date.parse(expiresAt))) throw new TypeError("runtime capability expiry must be an ISO date");
  if (!Number.isSafeInteger(record.maxRequests) || (record.maxRequests as number) < 1) throw new TypeError("runtime capability maxRequests must be a positive integer");
  return Object.freeze({
    schema: "runtime-capability-v1",
    scope: record.scope,
    endpoint: localEndpoint(text(record.endpoint, "runtime endpoint")),
    capabilityToken: text(record.capabilityToken, "capability token"),
    model: text(record.model, "runtime model"),
    expiresAt,
    maxRequests: record.maxRequests as number,
  });
}

export function parseRuntimeBundleConfig(value: unknown): RuntimeBundleConfig {
  const record = object(value, "runtime bundle");
  exactKeys(record, ["schema", "candidate"], ["judge"], "runtime bundle");
  if (record.schema !== "runtime-bundle-v1") throw new TypeError("runtime bundle schema is unsupported");
  const candidate = parseRuntimeCapabilityConfig(record.candidate);
  if (candidate.scope !== "candidate") throw new TypeError("runtime bundle candidate scope is invalid");
  const judge = record.judge === undefined ? undefined : parseRuntimeCapabilityConfig(record.judge);
  if (judge !== undefined && judge.scope !== "judge") throw new TypeError("runtime bundle judge scope is invalid");
  return Object.freeze({
    schema: "runtime-bundle-v1",
    candidate,
    ...(judge === undefined ? {} : { judge }),
  });
}

export function candidateIdentityDigest(config: CandidateIdentityConfig): Sha256Digest {
  return stableDigest(config);
}

export function judgeIdentityDigest(config: JudgeIdentityConfig): Sha256Digest {
  return stableDigest(config);
}

export function runtimeCapabilityDigest(config: RuntimeCapabilityConfig): Sha256Digest {
  return stableDigest({
    schema: config.schema,
    scope: config.scope,
    endpoint: config.endpoint,
    model: config.model,
    expiresAt: config.expiresAt,
    maxRequests: config.maxRequests,
  });
}
