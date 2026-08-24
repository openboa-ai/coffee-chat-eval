import { isAbsolute, resolve } from "node:path";

import { stableDigest } from "./identity.ts";
import type { Sha256Digest } from "./types.ts";

export type CandidateType =
  "fixture" | "reference_model" | "agent_stack" | "coffee_chat_product";

export const COFFEE_CHAT_PRODUCT_REPOSITORY =
  "https://github.com/openboa-ai/coffee-chat" as const;
export const COFFEE_CHAT_PRODUCT_COMMIT =
  "e1ac82de77ab12b9b2499771a194ef3db356b3a6" as const;
export const COFFEE_CHAT_PRODUCT_CALVER = "2026.8.23" as const;
export const COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST =
  "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41" as const;
export const COFFEE_CHAT_PRODUCT_HARNESS = "eval-skills-reference-host-v1" as const;
export const COFFEE_CHAT_PRODUCT_MODEL = "gpt-5.6-luna" as const;
export const COFFEE_CHAT_PRODUCT_SEED = 7 as const;
export const RESPONSES_AGENT_STACK_HARNESS = "responses-agent-stack-v1" as const;
export const RESPONSES_REFERENCE_MODEL_HARNESS =
  "responses-reference-model-v1" as const;

export function responsesCandidateHarnessForKind(
  candidateType: "reference_model" | "agent_stack",
): typeof RESPONSES_REFERENCE_MODEL_HARNESS | typeof RESPONSES_AGENT_STACK_HARNESS {
  if (candidateType === "reference_model") return RESPONSES_REFERENCE_MODEL_HARNESS;
  if (candidateType === "agent_stack") return RESPONSES_AGENT_STACK_HARNESS;
  throw new TypeError("Responses candidate kind has no admitted harness");
}

interface CandidateIdentityBase {
  readonly schema: "candidate-config-v1";
  readonly harness: string;
  readonly model: string;
  readonly seed?: number;
}

export interface CoffeeChatProductIdentity {
  readonly repository: typeof COFFEE_CHAT_PRODUCT_REPOSITORY;
  readonly commit: string;
  readonly calver: string;
  readonly packageDigest: Sha256Digest;
  readonly mode: "connectivity_only";
}

export interface CoffeeChatProductCandidateIdentityConfig extends CandidateIdentityBase {
  readonly candidateType: "coffee_chat_product";
  readonly harness: typeof COFFEE_CHAT_PRODUCT_HARNESS;
  readonly model: typeof COFFEE_CHAT_PRODUCT_MODEL;
  readonly seed: typeof COFFEE_CHAT_PRODUCT_SEED;
  readonly product: CoffeeChatProductIdentity;
}

export interface StandardCandidateIdentityConfig extends CandidateIdentityBase {
  readonly candidateType: Exclude<CandidateType, "coffee_chat_product">;
  readonly product?: never;
}

export type CandidateIdentityConfig =
  CoffeeChatProductCandidateIdentityConfig | StandardCandidateIdentityConfig;

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

export interface ProductHostRuntimeConfig {
  readonly schema: "product-host-runtime-v1";
  readonly host: "eval-skills-reference-host-v1";
  readonly packageRoot: string;
}

export interface RuntimeBundleConfig {
  readonly schema: "runtime-bundle-v1";
  readonly candidate: RuntimeCapabilityConfig;
  readonly judge?: RuntimeCapabilityConfig;
  readonly productHost?: ProductHostRuntimeConfig;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError(`${label} must not be empty`);
  return value;
}

function exactKeys(
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

function seed(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new TypeError("seed must be a non-negative integer");
  return value as number;
}

function coffeeChatProduct(value: unknown): CoffeeChatProductIdentity {
  const record = object(value, "candidate product");
  exactKeys(
    record,
    ["repository", "commit", "calver", "packageDigest", "mode"],
    [],
    "candidate product",
  );
  if (record.repository !== COFFEE_CHAT_PRODUCT_REPOSITORY)
    throw new TypeError("candidate product repository is unsupported");
  const commit = text(record.commit, "candidate product commit");
  if (commit !== COFFEE_CHAT_PRODUCT_COMMIT)
    throw new TypeError("candidate product commit does not match the admitted pin");
  const calver = text(record.calver, "candidate product CalVer");
  if (calver !== COFFEE_CHAT_PRODUCT_CALVER)
    throw new TypeError("candidate product CalVer does not match the admitted pin");
  const packageDigest = text(record.packageDigest, "candidate product package digest");
  if (packageDigest !== COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST)
    throw new TypeError(
      "candidate product package digest does not match the admitted pin",
    );
  if (record.mode !== "connectivity_only")
    throw new TypeError("candidate product mode is unsupported");
  return Object.freeze({
    repository: COFFEE_CHAT_PRODUCT_REPOSITORY,
    commit: COFFEE_CHAT_PRODUCT_COMMIT,
    calver: COFFEE_CHAT_PRODUCT_CALVER,
    packageDigest: COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
    mode: "connectivity_only" as const,
  });
}

export function parseCandidateIdentityConfig(value: unknown): CandidateIdentityConfig {
  const record = object(value, "candidate config");
  if (record.schema !== "candidate-config-v1")
    throw new TypeError("candidate config schema is unsupported");
  if (
    record.candidateType !== "fixture" &&
    record.candidateType !== "reference_model" &&
    record.candidateType !== "agent_stack" &&
    record.candidateType !== "coffee_chat_product"
  )
    throw new TypeError("candidate config candidateType is unsupported");
  const parsedSeed = record.seed === undefined ? undefined : seed(record.seed);
  if (record.candidateType === "coffee_chat_product") {
    exactKeys(
      record,
      ["schema", "candidateType", "harness", "model", "product"],
      ["seed"],
      "candidate config",
    );
    if (record.harness !== COFFEE_CHAT_PRODUCT_HARNESS)
      throw new TypeError("candidate harness does not match the admitted Product host");
    if (record.model !== COFFEE_CHAT_PRODUCT_MODEL)
      throw new TypeError("candidate model does not match the admitted Product model");
    if (parsedSeed !== COFFEE_CHAT_PRODUCT_SEED)
      throw new TypeError("candidate seed does not match the admitted Product seed");
    return Object.freeze({
      schema: "candidate-config-v1",
      candidateType: "coffee_chat_product" as const,
      harness: COFFEE_CHAT_PRODUCT_HARNESS,
      model: COFFEE_CHAT_PRODUCT_MODEL,
      seed: COFFEE_CHAT_PRODUCT_SEED,
      product: coffeeChatProduct(record.product),
    });
  }
  exactKeys(
    record,
    ["schema", "candidateType", "harness", "model"],
    ["seed"],
    "candidate config",
  );
  const harness = text(record.harness, "candidate harness");
  if (
    (record.candidateType === "reference_model" ||
      record.candidateType === "agent_stack") &&
    harness !== responsesCandidateHarnessForKind(record.candidateType)
  ) {
    throw new TypeError(
      `candidate harness does not match the admitted ${record.candidateType} implementation`,
    );
  }
  return Object.freeze({
    schema: "candidate-config-v1",
    candidateType: record.candidateType,
    harness,
    model: text(record.model, "candidate model"),
    ...(parsedSeed === undefined ? {} : { seed: parsedSeed }),
  });
}

export function parseJudgeIdentityConfig(value: unknown): JudgeIdentityConfig {
  const record = object(value, "judge config");
  exactKeys(record, ["schema", "transport", "model"], [], "judge config");
  if (record.schema !== "judge-config-v1")
    throw new TypeError("judge config schema is unsupported");
  if (record.transport !== "responses")
    throw new TypeError("judge transport is unsupported");
  return Object.freeze({
    schema: "judge-config-v1",
    transport: "responses" as const,
    model: text(record.model, "judge model"),
  });
}

function localEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:")
    throw new TypeError("runtime endpoint must use HTTP or HTTPS");
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(endpoint.hostname))
    throw new TypeError("runtime endpoint must be host-local");
  return endpoint.toString();
}

export function parseRuntimeCapabilityConfig(value: unknown): RuntimeCapabilityConfig {
  const record = object(value, "runtime capability");
  exactKeys(
    record,
    [
      "schema",
      "scope",
      "endpoint",
      "capabilityToken",
      "model",
      "expiresAt",
      "maxRequests",
    ],
    [],
    "runtime capability",
  );
  if (record.schema !== "runtime-capability-v1")
    throw new TypeError("runtime capability schema is unsupported");
  if (record.scope !== "candidate" && record.scope !== "judge")
    throw new TypeError("runtime capability scope is unsupported");
  const expiresAt = text(record.expiresAt, "runtime capability expiry");
  if (Number.isNaN(Date.parse(expiresAt)))
    throw new TypeError("runtime capability expiry must be an ISO date");
  if (!Number.isSafeInteger(record.maxRequests) || (record.maxRequests as number) < 1)
    throw new TypeError("runtime capability maxRequests must be a positive integer");
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

export function parseProductHostRuntimeConfig(
  value: unknown,
): ProductHostRuntimeConfig {
  const record = object(value, "runtime product host");
  exactKeys(record, ["schema", "host", "packageRoot"], [], "runtime product host");
  if (record.schema !== "product-host-runtime-v1")
    throw new TypeError("runtime product host schema is unsupported");
  if (record.host !== "eval-skills-reference-host-v1")
    throw new TypeError("runtime product host is unsupported");
  const packageRoot = text(record.packageRoot, "runtime product packageRoot");
  if (!isAbsolute(packageRoot))
    throw new TypeError("runtime product packageRoot must be an absolute path");
  return Object.freeze({
    schema: "product-host-runtime-v1" as const,
    host: "eval-skills-reference-host-v1" as const,
    packageRoot: resolve(packageRoot),
  });
}

export function parseRuntimeBundleConfig(value: unknown): RuntimeBundleConfig {
  const record = object(value, "runtime bundle");
  exactKeys(
    record,
    ["schema", "candidate"],
    ["judge", "productHost"],
    "runtime bundle",
  );
  if (record.schema !== "runtime-bundle-v1")
    throw new TypeError("runtime bundle schema is unsupported");
  const candidate = parseRuntimeCapabilityConfig(record.candidate);
  if (candidate.scope !== "candidate")
    throw new TypeError("runtime bundle candidate scope is invalid");
  const judge =
    record.judge === undefined ? undefined : parseRuntimeCapabilityConfig(record.judge);
  if (judge !== undefined && judge.scope !== "judge")
    throw new TypeError("runtime bundle judge scope is invalid");
  const productHost =
    record.productHost === undefined
      ? undefined
      : parseProductHostRuntimeConfig(record.productHost);
  return Object.freeze({
    schema: "runtime-bundle-v1",
    candidate,
    ...(judge === undefined ? {} : { judge }),
    ...(productHost === undefined ? {} : { productHost }),
  });
}

export function candidateIdentityDigest(config: CandidateIdentityConfig): Sha256Digest {
  return stableDigest(config);
}

function canonicalCoffeeChatProductCandidateIdentity(): CoffeeChatProductCandidateIdentityConfig {
  const identity = parseCandidateIdentityConfig({
    schema: "candidate-config-v1",
    candidateType: "coffee_chat_product",
    harness: COFFEE_CHAT_PRODUCT_HARNESS,
    model: COFFEE_CHAT_PRODUCT_MODEL,
    seed: COFFEE_CHAT_PRODUCT_SEED,
    product: {
      repository: COFFEE_CHAT_PRODUCT_REPOSITORY,
      commit: COFFEE_CHAT_PRODUCT_COMMIT,
      calver: COFFEE_CHAT_PRODUCT_CALVER,
      packageDigest: COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
      mode: "connectivity_only",
    },
  });
  if (identity.candidateType !== "coffee_chat_product") {
    throw new TypeError("canonical Product candidate identity is invalid");
  }
  return identity;
}

/** Exact immutable identity admitted for Product connectivity-only smoke runs. */
export const COFFEE_CHAT_PRODUCT_CANDIDATE_IDENTITY =
  canonicalCoffeeChatProductCandidateIdentity();
export const COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST = candidateIdentityDigest(
  COFFEE_CHAT_PRODUCT_CANDIDATE_IDENTITY,
);

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
