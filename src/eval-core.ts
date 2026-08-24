import { isAbsolute, resolve } from "node:path";

import { stableDigest } from "./identity.ts";
import type { CandidateType } from "./runtime-config.ts";
import { getEvaluationTrack, type EvaluationTrackId } from "./track-registry.ts";
import type {
  ClaimStatus,
  ExecutionStatus,
  FailureOwner,
  IsolationClass,
  Sha256Digest,
} from "./types.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const CALVER = /^[0-9]{4}\.(?:[1-9]|1[0-2])\.(?:[1-9]|[12][0-9]|3[01])$/u;
const COFFEE_CHAT_REPOSITORY = "https://github.com/openboa-ai/coffee-chat";
const PRODUCT_BOUNDARY_KEYS = Object.freeze([
  "candidateMode",
  "capabilitiesUsed",
  "productBehaviorExercised",
  "referenceHost",
  "productIdentity",
] as const);
const RIGHTS_RISK_PROVENANCE_KEYS = Object.freeze([
  "rightsRiskAcceptanceDigest",
  "licenseCleared",
  "rightsExecutionScope",
] as const);
const CLAIM_STATUSES: readonly ClaimStatus[] = [
  "calibration",
  "pilot",
  "provisional_internal",
  "reportable",
  "not_active",
];
const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  "measured",
  "unmeasured",
  "skipped",
  "unavailable",
  "invalid",
  "failed",
  "missing",
  "not_implemented",
  "rights_hold",
];

export type RunProfile = "fixture" | "smoke" | "pilot" | "score";

export interface ProductCandidateBoundary {
  readonly candidateMode: "connectivity_only";
  readonly capabilitiesUsed: readonly [];
  readonly productBehaviorExercised: false;
  readonly referenceHost: "eval-skills-reference-host-v1";
  readonly productIdentity: Readonly<{
    repository: "https://github.com/openboa-ai/coffee-chat";
    commit: string;
    calver: string;
    packageDigest: Sha256Digest;
  }>;
}

export interface ProductHostPreflight {
  readonly state: "verified" | "unavailable";
  readonly reason?: string;
}

export interface PrivateArtifactRef {
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly mediaType: string;
  readonly bytes: number;
}

export type CandidateRunResult =
  | {
      readonly state: "measured";
      readonly output: PrivateArtifactRef;
      readonly latencyMs: number;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      /** Backward-compatible digest projection for existing callers. */
      readonly outputDigest: Sha256Digest;
    }
  | {
      readonly state: Exclude<ExecutionStatus, "measured">;
      readonly reason: string;
      readonly failureOwner?: FailureOwner;
    };

export interface CandidateTransport {
  readonly kind: CandidateType;
  readonly productBoundary?: ProductCandidateBoundary;
  readonly productHostPreflight?: ProductHostPreflight;
  readonly run: (input: unknown) => Promise<CandidateRunResult>;
}

export interface InteractiveAgentSession {
  readonly send: (message: unknown) => Promise<unknown>;
  readonly close: () => Promise<void>;
}

export interface InteractiveAgentTransport extends CandidateTransport {
  readonly kind: "agent_stack" | "coffee_chat_product";
  readonly openSession: (input: unknown) => Promise<InteractiveAgentSession>;
}

export interface JudgeTransport {
  readonly kind: "sealed-judge";
  readonly evaluate: (input: unknown) => Promise<
    | {
        readonly state: "measured";
        readonly verdict: PrivateArtifactRef;
        readonly latencyMs: number;
        readonly inputTokens: number | null;
        readonly outputTokens: number | null;
        readonly verdictDigest: Sha256Digest;
      }
    | {
        readonly state: "measured";
        readonly verdictDigest: Sha256Digest;
        readonly verdict?: PrivateArtifactRef;
        readonly latencyMs?: number;
        readonly inputTokens?: number | null;
        readonly outputTokens?: number | null;
      }
    | {
        readonly state: Exclude<ExecutionStatus, "measured">;
        readonly reason: string;
        readonly failureOwner?: FailureOwner;
      }
  >;
}

export interface TrackAdapter {
  readonly id: EvaluationTrackId;
  readonly nativeMetricIds: readonly string[];
  readonly samplingUnit:
    "family" | "conversation" | "prompt" | "suite_user_task_cluster";
  readonly inventory: (profile: RunProfile) => readonly unknown[];
  /** Returns candidate-visible material only; sealed rubric/oracle stays evaluator-side. */
  readonly candidateVisibleInput: (
    caseRef: unknown,
  ) => Readonly<Record<string, unknown>>;
}

export interface TrackReport {
  readonly trackId: EvaluationTrackId;
  readonly claimStatus: ClaimStatus;
  readonly executionStatus: ExecutionStatus;
  readonly nativeMetricIds: readonly string[];
  readonly denominators: Readonly<Record<string, number | null>>;
  readonly metrics: Readonly<
    Record<
      string,
      Readonly<{
        numerator: number | null;
        denominator: number | null;
        value: number | null;
      }>
    >
  >;
  readonly provenance: Readonly<
    {
      sourceManifestDigest: Sha256Digest;
      runId: string;
      nativeEvidenceDigest?: Sha256Digest;
      rightsRiskAcceptanceDigest?: Sha256Digest;
      licenseCleared?: false;
      rightsExecutionScope?: "private-internal-smoke-only";
    } & Partial<ProductCandidateBoundary>
  >;
}

export interface TrackExecutionResult {
  readonly executionStatus: ExecutionStatus;
  readonly failureOwner?: FailureOwner;
  readonly trialReceipts: readonly TrialReceipt[];
  readonly metrics: TrackReport["metrics"];
  readonly nativeEvidence: PrivateArtifactRef;
  readonly cleanupStatus: "complete" | "failed" | "unavailable";
}

export interface TrialReceipt {
  readonly id: string;
  readonly runId: string;
  readonly trialId: string;
  readonly trackId: EvaluationTrackId;
  readonly executionStatus: ExecutionStatus;
  readonly failureOwner?: FailureOwner;
  readonly host: Readonly<{
    id: string;
    isolationClass: IsolationClass;
    evidenceRef: Sha256Digest;
  }>;
  readonly artifacts: Readonly<Record<string, Sha256Digest>>;
  readonly metrics: Readonly<Record<string, number | null>> | null;
  readonly latencyMs?: number;
  readonly tokenCount?: number;
  readonly cost?: number;
  readonly cleanupStatus?: "complete" | "failed" | "unavailable";
  readonly candidateMode?: ProductCandidateBoundary["candidateMode"];
  readonly capabilitiesUsed?: ProductCandidateBoundary["capabilitiesUsed"];
  readonly productBehaviorExercised?: ProductCandidateBoundary["productBehaviorExercised"];
  readonly referenceHost?: ProductCandidateBoundary["referenceHost"];
  readonly productIdentity?: ProductCandidateBoundary["productIdentity"];
}

export interface SourceManifest {
  readonly schema: "source-manifest-v1";
  readonly trackId: EvaluationTrackId;
  readonly source: Readonly<{
    repository: string;
    commit: string;
    license: string;
    readonly licenseDigest?: Sha256Digest;
  }>;
  readonly data?: Readonly<{
    repository: string;
    revision: string;
    license: string;
    licenseDigest?: Sha256Digest;
    allowlist?: readonly string[];
    licenseEvidencePath?: string;
    fileDigests?: Readonly<Record<string, Sha256Digest>>;
  }>;
  readonly allowlist: readonly string[];
  readonly excludedPaths: readonly string[];
  readonly notices?: readonly string[];
  readonly retention?: Readonly<{
    source: "cache-only";
    evidence: "private-content-addressed";
    public: "aggregate-provenance-only";
  }>;
  readonly providerTermsPolicy?: "receipt-required";
  readonly providerTermsDigest?: Sha256Digest;
  readonly nativeMetric?: string;
  readonly caseCensus?: Readonly<Record<string, number>>;
  readonly publicArtifactPolicy: "receipt-redacted";
}

export interface RunSpec {
  readonly schema: "run-spec-v1";
  readonly trackId: EvaluationTrackId;
  readonly profile: RunProfile;
  readonly sourceManifestDigest: Sha256Digest;
  readonly candidateDigest: Sha256Digest;
  readonly judgeDigest: Sha256Digest;
  readonly attackDigest: Sha256Digest;
  readonly defenseDigest: Sha256Digest;
  readonly configurationDigest: Sha256Digest;
  /** Digest of the provider-terms receipt used for this run, when required by the source. */
  readonly providerTermsDigest?: Sha256Digest;
  /** Content digest of the current provider-terms receipt, never the receipt bytes. */
  readonly providerTermsReceiptDigest?: Sha256Digest;
  /** Explicit private-smoke risk acceptance for IFEval's unclarified Punkt asset. */
  readonly rightsRiskAcceptanceDigest?: Sha256Digest;
  readonly candidateType: CandidateType;
  readonly samplingUnit?:
    "family" | "conversation" | "prompt" | "suite_user_task_cluster";
  /** Profile-specific census; kept in the immutable spec, not inferred later. */
  readonly caseCensus?: Readonly<Record<string, number>>;
  /** Host receipt digest proving the candidate was isolated from secrets. */
  readonly isolationEvidenceDigest?: Sha256Digest;
  readonly seed?: number;
  readonly budgets?: Readonly<Record<string, number>>;
  readonly sourceCondition?: string;
  readonly sourceConditionDigest?: Sha256Digest;
  readonly coffeeCondition?: string;
  readonly coffeeConditionDigest?: Sha256Digest;
}

export interface RunPlan {
  readonly id: string;
  readonly trackId: EvaluationTrackId;
  readonly profile: RunProfile;
  readonly sourceManifestDigest: Sha256Digest;
  readonly runSpecDigest: Sha256Digest;
  readonly claimStatus: ClaimStatus;
  readonly executionStatus: Extract<ExecutionStatus, "unmeasured">;
  readonly evidenceRoot: string;
  readonly cacheRoot: string;
  readonly runSpec?: RunSpec;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}

function exactKeysAllowed(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}

export function parseProductCandidateBoundary(
  value: unknown,
  label = "product candidate boundary",
): ProductCandidateBoundary {
  const boundary = object(value, label);
  exactKeys(boundary, PRODUCT_BOUNDARY_KEYS, label);
  if (boundary.candidateMode !== "connectivity_only") {
    throw new TypeError(`${label} candidateMode is unsupported`);
  }
  if (
    !Array.isArray(boundary.capabilitiesUsed) ||
    boundary.capabilitiesUsed.length !== 0
  ) {
    throw new TypeError(`${label} capabilitiesUsed must be an empty array`);
  }
  if (boundary.productBehaviorExercised !== false) {
    throw new TypeError(`${label} productBehaviorExercised must be false`);
  }
  if (boundary.referenceHost !== "eval-skills-reference-host-v1") {
    throw new TypeError(`${label} referenceHost is unsupported`);
  }
  const identity = object(boundary.productIdentity, `${label} productIdentity`);
  exactKeys(
    identity,
    ["repository", "commit", "calver", "packageDigest"],
    `${label} productIdentity`,
  );
  if (identity.repository !== COFFEE_CHAT_REPOSITORY) {
    throw new TypeError(`${label} product repository is unsupported`);
  }
  if (typeof identity.commit !== "string" || !COMMIT.test(identity.commit)) {
    throw new TypeError(`${label} product commit must be a full SHA`);
  }
  if (typeof identity.calver !== "string" || !CALVER.test(identity.calver)) {
    throw new TypeError(`${label} product CalVer must use YYYY.M.D`);
  }
  const packageDigest = digest(identity.packageDigest, `${label} package digest`);
  return Object.freeze({
    candidateMode: "connectivity_only" as const,
    capabilitiesUsed: Object.freeze([]) as readonly [],
    productBehaviorExercised: false as const,
    referenceHost: "eval-skills-reference-host-v1" as const,
    productIdentity: Object.freeze({
      repository: COFFEE_CHAT_REPOSITORY,
      commit: identity.commit,
      calver: identity.calver,
      packageDigest,
    }),
  });
}

function boundaryFromFields(
  value: Record<string, unknown>,
  label: string,
): ProductCandidateBoundary | undefined {
  const present = PRODUCT_BOUNDARY_KEYS.filter((key) => value[key] !== undefined);
  if (present.length === 0) return undefined;
  if (present.length !== PRODUCT_BOUNDARY_KEYS.length) {
    throw new TypeError(`${label} has an incomplete product candidate boundary`);
  }
  return parseProductCandidateBoundary(
    Object.fromEntries(PRODUCT_BOUNDARY_KEYS.map((key) => [key, value[key]])),
    label,
  );
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  return value;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return value as Sha256Digest;
}

function trackId(value: unknown, label: string): EvaluationTrackId {
  const id = text(value, label);
  if (getEvaluationTrack(id) === undefined) {
    throw new TypeError(`${label} is unsupported`);
  }
  return id as EvaluationTrackId;
}

function sourcePath(value: unknown, label: string): string {
  const path = text(value, label);
  if (isAbsolute(path) || path.split("/").includes("..")) {
    throw new TypeError(`${label} must be a relative contained path`);
  }
  return path;
}

function hasOverlap(left: string, right: string): boolean {
  const leftBase = left.endsWith("/**") ? left.slice(0, -3) : left;
  const rightBase = right.endsWith("/**") ? right.slice(0, -3) : right;
  return (
    leftBase === rightBase ||
    leftBase.startsWith(`${rightBase}/`) ||
    rightBase.startsWith(`${leftBase}/`)
  );
}

function absoluteRoot(value: string, label: "evidenceRoot" | "cacheRoot"): string {
  if (!isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
  return resolve(value);
}

function claimStatus(profile: RunProfile): ClaimStatus {
  switch (profile) {
    case "fixture":
    case "smoke":
      return "calibration";
    case "pilot":
      return "pilot";
    case "score":
      return "provisional_internal";
  }
}

export function runProfileCandidateCompatibilityError(
  profile: RunProfile,
  candidateType: CandidateType | undefined,
): string | undefined {
  if (candidateType === undefined) return "run candidateType is required";
  if (profile === "fixture" && candidateType !== "fixture") {
    return "profile fixture requires candidateType fixture";
  }
  if (profile !== "fixture" && candidateType === "fixture") {
    return "fixture candidateType requires profile fixture";
  }
  if (candidateType === "coffee_chat_product" && profile !== "smoke") {
    return "coffee_chat_product candidateType requires profile smoke";
  }
  return undefined;
}

export function parseSourceManifest(value: unknown): SourceManifest {
  const manifest = object(value, "source manifest");
  exactKeysAllowed(
    manifest,
    [
      "schema",
      "trackId",
      "source",
      "allowlist",
      "excludedPaths",
      "publicArtifactPolicy",
    ],
    [
      "data",
      "notices",
      "retention",
      "providerTermsPolicy",
      "providerTermsDigest",
      "nativeMetric",
      "caseCensus",
    ],
    "source manifest",
  );
  if (manifest.schema !== "source-manifest-v1") {
    throw new TypeError("source manifest schema is unsupported");
  }
  const source = object(manifest.source, "source");
  exactKeysAllowed(
    source,
    ["repository", "commit", "license"],
    ["licenseDigest"],
    "source",
  );
  const commit = text(source.commit, "source commit");
  if (!COMMIT.test(commit)) throw new TypeError("source commit must be a full SHA");
  if (!Array.isArray(manifest.allowlist) || !Array.isArray(manifest.excludedPaths)) {
    throw new TypeError("source paths must be arrays");
  }
  const allowlist = manifest.allowlist.map((path) =>
    sourcePath(path, "allowlist path"),
  );
  const excludedPaths = manifest.excludedPaths.map((path) =>
    sourcePath(path, "excluded path"),
  );
  if (allowlist.length === 0 || excludedPaths.length === 0) {
    throw new TypeError("source allowlist and excludedPaths must not be empty");
  }
  if (
    allowlist.some((allowed) =>
      excludedPaths.some((excluded) => hasOverlap(allowed, excluded)),
    )
  ) {
    throw new TypeError("allowlist must not overlap excludedPaths");
  }
  if (manifest.publicArtifactPolicy !== "receipt-redacted") {
    throw new TypeError("public artifact policy is unsupported");
  }
  const dataValue = manifest.data;
  let data: SourceManifest["data"];
  if (dataValue !== undefined) {
    const dataRecord = object(dataValue, "data");
    exactKeysAllowed(
      dataRecord,
      ["repository", "revision", "license"],
      ["licenseDigest", "allowlist", "licenseEvidencePath", "fileDigests"],
      "data",
    );
    const revision = text(dataRecord.revision, "data revision");
    if (!COMMIT.test(revision) && !/^v[0-9]/u.test(revision)) {
      throw new TypeError("data revision must be an immutable commit or release");
    }
    let dataAllowlist: readonly string[] | undefined;
    if (dataRecord.allowlist !== undefined) {
      if (!Array.isArray(dataRecord.allowlist) || dataRecord.allowlist.length === 0) {
        throw new TypeError("data allowlist must be a non-empty array");
      }
      dataAllowlist = Object.freeze(
        dataRecord.allowlist.map((path) => sourcePath(path, "data allowlist path")),
      );
    }
    let dataFileDigests: Readonly<Record<string, Sha256Digest>> | undefined;
    if (dataRecord.fileDigests !== undefined) {
      const digestRecord = object(dataRecord.fileDigests, "data fileDigests");
      const entries: Record<string, Sha256Digest> = {};
      for (const [path, value] of Object.entries(digestRecord)) {
        entries[sourcePath(path, "data file digest path")] = digest(
          value,
          "data file digest",
        );
      }
      if (Object.keys(entries).length === 0)
        throw new TypeError("data fileDigests must not be empty");
      dataFileDigests = Object.freeze(entries);
    }
    data = Object.freeze({
      repository: text(dataRecord.repository, "data repository"),
      revision,
      license: text(dataRecord.license, "data license"),
      ...(dataRecord.licenseDigest === undefined
        ? {}
        : { licenseDigest: digest(dataRecord.licenseDigest, "data license digest") }),
      ...(dataAllowlist === undefined ? {} : { allowlist: dataAllowlist }),
      ...(dataRecord.licenseEvidencePath === undefined
        ? {}
        : {
            licenseEvidencePath: sourcePath(
              dataRecord.licenseEvidencePath,
              "data license evidence path",
            ),
          }),
      ...(dataFileDigests === undefined ? {} : { fileDigests: dataFileDigests }),
    });
  }
  const noticesValue = manifest.notices;
  let notices: readonly string[] | undefined;
  if (noticesValue !== undefined) {
    if (!Array.isArray(noticesValue)) throw new TypeError("notices must be an array");
    notices = Object.freeze(
      noticesValue.map((notice: unknown) => text(notice, "notice")),
    );
  }
  const retentionValue = manifest.retention;
  let retention: SourceManifest["retention"];
  if (retentionValue !== undefined) {
    const retentionRecord = object(retentionValue, "retention");
    exactKeys(retentionRecord, ["source", "evidence", "public"], "retention");
    if (
      retentionRecord.source !== "cache-only" ||
      retentionRecord.evidence !== "private-content-addressed" ||
      retentionRecord.public !== "aggregate-provenance-only"
    ) {
      throw new TypeError("retention policy is unsupported");
    }
    retention = Object.freeze({
      source: "cache-only" as const,
      evidence: "private-content-addressed" as const,
      public: "aggregate-provenance-only" as const,
    });
  }
  const censusValue = manifest.caseCensus;
  let caseCensus: Readonly<Record<string, number>> | undefined;
  if (censusValue !== undefined) {
    const censusRecord = object(censusValue, "caseCensus");
    const entries: Record<string, number> = {};
    for (const [key, count] of Object.entries(censusRecord)) {
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
        throw new TypeError("caseCensus counts must be non-negative integers");
      }
      entries[key] = count;
    }
    caseCensus = Object.freeze(entries);
  }
  if (
    manifest.providerTermsPolicy !== undefined &&
    manifest.providerTermsPolicy !== "receipt-required"
  ) {
    throw new TypeError("provider terms policy is unsupported");
  }
  if (
    manifest.providerTermsPolicy === "receipt-required" &&
    manifest.providerTermsDigest === undefined
  ) {
    throw new TypeError("provider terms policy requires a terms digest");
  }
  return Object.freeze({
    schema: "source-manifest-v1",
    trackId: trackId(manifest.trackId, "source manifest trackId"),
    source: Object.freeze({
      repository: text(source.repository, "source repository"),
      commit,
      license: text(source.license, "source license"),
      ...(source.licenseDigest === undefined
        ? {}
        : { licenseDigest: digest(source.licenseDigest, "source license digest") }),
    }),
    ...(data === undefined ? {} : { data }),
    allowlist: Object.freeze([...allowlist]),
    excludedPaths: Object.freeze([...excludedPaths]),
    ...(notices === undefined ? {} : { notices }),
    ...(retention === undefined ? {} : { retention }),
    ...(manifest.providerTermsPolicy === undefined
      ? {}
      : { providerTermsPolicy: "receipt-required" as const }),
    ...(manifest.providerTermsDigest === undefined
      ? {}
      : {
          providerTermsDigest: digest(
            manifest.providerTermsDigest,
            "provider terms digest",
          ),
        }),
    ...(manifest.nativeMetric === undefined
      ? {}
      : { nativeMetric: text(manifest.nativeMetric, "native metric") }),
    ...(caseCensus === undefined ? {} : { caseCensus }),
    publicArtifactPolicy: "receipt-redacted",
  });
}

export function parseRunSpec(value: unknown): RunSpec {
  const spec = object(value, "run spec");
  exactKeysAllowed(
    spec,
    [
      "schema",
      "trackId",
      "profile",
      "sourceManifestDigest",
      "candidateDigest",
      "judgeDigest",
      "attackDigest",
      "defenseDigest",
      "configurationDigest",
    ],
    [
      "candidateType",
      "samplingUnit",
      "caseCensus",
      "isolationEvidenceDigest",
      "seed",
      "budgets",
      "sourceCondition",
      "sourceConditionDigest",
      "coffeeCondition",
      "coffeeConditionDigest",
      "providerTermsDigest",
      "providerTermsReceiptDigest",
      "rightsRiskAcceptanceDigest",
    ],
    "run spec",
  );
  if (spec.schema !== "run-spec-v1")
    throw new TypeError("run spec schema is unsupported");
  if (
    spec.profile !== "fixture" &&
    spec.profile !== "smoke" &&
    spec.profile !== "pilot" &&
    spec.profile !== "score"
  ) {
    throw new TypeError("run profile is unsupported");
  }
  const candidateType = spec.candidateType;
  if (
    candidateType !== undefined &&
    candidateType !== "fixture" &&
    candidateType !== "reference_model" &&
    candidateType !== "agent_stack" &&
    candidateType !== "coffee_chat_product"
  ) {
    throw new TypeError("candidate type is unsupported");
  }
  if (candidateType === undefined) {
    throw new TypeError("run candidateType is required");
  }
  const compatibilityError = runProfileCandidateCompatibilityError(
    spec.profile,
    candidateType,
  );
  if (compatibilityError !== undefined) throw new TypeError(compatibilityError);
  const samplingUnit = spec.samplingUnit;
  if (
    samplingUnit !== undefined &&
    samplingUnit !== "family" &&
    samplingUnit !== "conversation" &&
    samplingUnit !== "prompt" &&
    samplingUnit !== "suite_user_task_cluster"
  ) {
    throw new TypeError("sampling unit is unsupported");
  }
  let caseCensus: Readonly<Record<string, number>> | undefined;
  if (spec.caseCensus !== undefined) {
    const censusRecord = object(spec.caseCensus, "caseCensus");
    const normalized: Record<string, number> = {};
    for (const [key, count] of Object.entries(censusRecord)) {
      if (
        key.length === 0 ||
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) {
        throw new TypeError("caseCensus counts must be non-negative integers");
      }
      normalized[key] = count;
    }
    if (Object.keys(normalized).length === 0) {
      throw new TypeError("caseCensus must not be empty");
    }
    caseCensus = Object.freeze(normalized);
  }
  if (
    spec.seed !== undefined &&
    (typeof spec.seed !== "number" || !Number.isSafeInteger(spec.seed) || spec.seed < 0)
  ) {
    throw new TypeError("seed must be a non-negative integer");
  }
  if (
    (spec.sourceCondition !== undefined) !==
    (spec.sourceConditionDigest !== undefined)
  ) {
    throw new TypeError("source condition and digest must be supplied together");
  }
  if (
    (spec.coffeeCondition !== undefined) !==
    (spec.coffeeConditionDigest !== undefined)
  ) {
    throw new TypeError("coffee condition and digest must be supplied together");
  }
  if (
    spec.rightsRiskAcceptanceDigest !== undefined &&
    (spec.trackId !== "ifeval" || spec.profile !== "smoke")
  ) {
    throw new TypeError("rights risk acceptance is limited to IFEval smoke");
  }
  if (
    spec.rightsRiskAcceptanceDigest !== undefined &&
    candidateType !== "coffee_chat_product"
  ) {
    throw new TypeError(
      "rights risk acceptance is limited to the Coffee Chat Product candidate",
    );
  }
  let budgets: Readonly<Record<string, number>> | undefined;
  if (spec.budgets !== undefined) {
    const budgetRecord = object(spec.budgets, "budgets");
    const normalized: Record<string, number> = {};
    for (const [key, budget] of Object.entries(budgetRecord)) {
      if (typeof budget !== "number" || !Number.isFinite(budget) || budget < 0)
        throw new TypeError("budgets must be non-negative numbers");
      normalized[key] = budget;
    }
    budgets = Object.freeze(normalized);
  }
  return Object.freeze({
    schema: "run-spec-v1",
    trackId: trackId(spec.trackId, "run spec trackId"),
    profile: spec.profile,
    sourceManifestDigest: digest(spec.sourceManifestDigest, "source manifest digest"),
    candidateDigest: digest(spec.candidateDigest, "candidate digest"),
    judgeDigest: digest(spec.judgeDigest, "judge digest"),
    attackDigest: digest(spec.attackDigest, "attack digest"),
    defenseDigest: digest(spec.defenseDigest, "defense digest"),
    configurationDigest: digest(spec.configurationDigest, "configuration digest"),
    ...(spec.providerTermsDigest === undefined
      ? {}
      : {
          providerTermsDigest: digest(
            spec.providerTermsDigest,
            "provider terms digest",
          ),
        }),
    ...(spec.providerTermsReceiptDigest === undefined
      ? {}
      : {
          providerTermsReceiptDigest: digest(
            spec.providerTermsReceiptDigest,
            "provider terms receipt digest",
          ),
        }),
    ...(spec.rightsRiskAcceptanceDigest === undefined
      ? {}
      : {
          rightsRiskAcceptanceDigest: digest(
            spec.rightsRiskAcceptanceDigest,
            "rights risk acceptance digest",
          ),
        }),
    candidateType,
    ...(samplingUnit === undefined ? {} : { samplingUnit }),
    ...(caseCensus === undefined ? {} : { caseCensus }),
    ...(spec.isolationEvidenceDigest === undefined
      ? {}
      : {
          isolationEvidenceDigest: digest(
            spec.isolationEvidenceDigest,
            "isolation evidence digest",
          ),
        }),
    ...(typeof spec.seed !== "number" ? {} : { seed: spec.seed }),
    ...(budgets === undefined ? {} : { budgets }),
    ...(spec.sourceCondition === undefined
      ? {}
      : { sourceCondition: text(spec.sourceCondition, "source condition") }),
    ...(spec.sourceConditionDigest === undefined
      ? {}
      : {
          sourceConditionDigest: digest(
            spec.sourceConditionDigest,
            "source condition digest",
          ),
        }),
    ...(spec.coffeeCondition === undefined
      ? {}
      : { coffeeCondition: text(spec.coffeeCondition, "coffee condition") }),
    ...(spec.coffeeConditionDigest === undefined
      ? {}
      : {
          coffeeConditionDigest: digest(
            spec.coffeeConditionDigest,
            "coffee condition digest",
          ),
        }),
  });
}

export function createRunPlan(input: {
  readonly manifest: SourceManifest;
  readonly spec: RunSpec;
  readonly evidenceRoot: string;
  readonly cacheRoot: string;
}): RunPlan {
  const sourceManifestDigest = stableDigest(input.manifest);
  if (input.spec.trackId !== input.manifest.trackId) {
    throw new TypeError("run spec and source manifest track ids must match");
  }
  if (input.spec.sourceManifestDigest !== sourceManifestDigest) {
    throw new TypeError(
      "run spec source manifest digest does not match source manifest",
    );
  }
  if (
    input.manifest.providerTermsDigest !== undefined &&
    input.spec.providerTermsDigest !== input.manifest.providerTermsDigest
  ) {
    throw new TypeError(
      "run spec provider terms digest does not match source manifest",
    );
  }
  const evidenceRoot = absoluteRoot(input.evidenceRoot, "evidenceRoot");
  const cacheRoot = absoluteRoot(input.cacheRoot, "cacheRoot");
  const runSpecDigest = stableDigest(input.spec);
  return Object.freeze({
    id: `run-${stableDigest({ sourceManifestDigest, runSpecDigest }).slice("sha256:".length)}`,
    trackId: input.spec.trackId,
    profile: input.spec.profile,
    sourceManifestDigest,
    runSpecDigest,
    claimStatus: claimStatus(input.spec.profile),
    executionStatus: "unmeasured",
    evidenceRoot,
    cacheRoot,
    runSpec: input.spec,
  });
}

const TRIAL_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const FAILURE_OWNERS: readonly FailureOwner[] = [
  "source",
  "rights",
  "host",
  "candidate",
  "adapter",
  "judge",
  "verifier",
  "artifact",
  "cleanup",
];

export function createTrialReceipt(input: {
  readonly runId: string;
  readonly trackId: EvaluationTrackId;
  readonly trialId: string;
  readonly executionStatus: ExecutionStatus;
  readonly failureOwner?: FailureOwner;
  readonly host: TrialReceipt["host"];
  readonly artifacts: TrialReceipt["artifacts"];
  readonly metrics: TrialReceipt["metrics"];
  readonly latencyMs?: number;
  readonly tokenCount?: number;
  readonly cost?: number;
  readonly cleanupStatus?: TrialReceipt["cleanupStatus"];
  readonly productBoundary?: ProductCandidateBoundary;
}): TrialReceipt {
  if (input.runId.length === 0 || input.trialId.length === 0) {
    throw new TypeError("runId and trialId must not be empty");
  }
  if (
    (input.executionStatus === "failed" ||
      input.executionStatus === "invalid" ||
      input.executionStatus === "unavailable" ||
      input.executionStatus === "rights_hold") &&
    input.failureOwner === undefined
  ) {
    throw new TypeError(`${input.executionStatus} trial requires a failure owner`);
  }
  if (input.executionStatus === "rights_hold" && input.failureOwner !== "rights") {
    throw new TypeError("rights_hold trial requires rights as the failure owner");
  }
  if (
    input.failureOwner !== undefined &&
    !FAILURE_OWNERS.includes(input.failureOwner)
  ) {
    throw new TypeError("unsupported trial failure owner");
  }
  if (input.host.id.length === 0) throw new TypeError("host id must not be empty");
  if (input.host.isolationClass !== "fixture" && input.host.isolationClass !== "real") {
    throw new TypeError("unsupported host isolation class");
  }
  if (!TRIAL_DIGEST.test(input.host.evidenceRef)) {
    throw new TypeError("host evidenceRef must be a sha256 digest");
  }
  for (const [name, digest] of Object.entries(input.artifacts)) {
    if (name.length === 0 || !TRIAL_DIGEST.test(digest)) {
      throw new TypeError("trial artifact hashes must be sha256 digests");
    }
  }
  if (input.metrics !== null) {
    for (const [name, value] of Object.entries(input.metrics)) {
      if (
        name.length === 0 ||
        (value !== null && (!Number.isFinite(value) || value < 0))
      ) {
        throw new TypeError(
          "trial metric values must be null or non-negative finite numbers",
        );
      }
    }
  }
  for (const [label, value] of [
    ["latencyMs", input.latencyMs],
    ["tokenCount", input.tokenCount],
    ["cost", input.cost],
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new TypeError(`${label} must be a non-negative finite number`);
    }
  }
  if (
    input.cleanupStatus !== undefined &&
    input.cleanupStatus !== "complete" &&
    input.cleanupStatus !== "failed" &&
    input.cleanupStatus !== "unavailable"
  ) {
    throw new TypeError("unsupported cleanup status");
  }
  const productBoundary =
    input.productBoundary === undefined
      ? undefined
      : parseProductCandidateBoundary(input.productBoundary);
  const idMaterial = {
    runId: input.runId,
    trialId: input.trialId,
    trackId: input.trackId,
    executionStatus: input.executionStatus,
    ...(input.failureOwner === undefined ? {} : { failureOwner: input.failureOwner }),
    host: input.host,
    artifacts: input.artifacts,
    ...(productBoundary === undefined ? {} : productBoundary),
  };
  return Object.freeze({
    id: `trial-receipt-${stableDigest(idMaterial).slice("sha256:".length)}`,
    runId: input.runId,
    trialId: input.trialId,
    trackId: input.trackId,
    executionStatus: input.executionStatus,
    ...(input.failureOwner === undefined ? {} : { failureOwner: input.failureOwner }),
    host: Object.freeze({ ...input.host }),
    artifacts: Object.freeze({ ...input.artifacts }),
    metrics: input.metrics === null ? null : Object.freeze({ ...input.metrics }),
    ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
    ...(input.tokenCount === undefined ? {} : { tokenCount: input.tokenCount }),
    ...(input.cost === undefined ? {} : { cost: input.cost }),
    ...(input.cleanupStatus === undefined
      ? {}
      : { cleanupStatus: input.cleanupStatus }),
    ...(productBoundary === undefined ? {} : productBoundary),
  });
}

export function createTrackReport(input: {
  readonly trackId: EvaluationTrackId;
  readonly claimStatus: ClaimStatus;
  readonly executionStatus: ExecutionStatus;
  readonly nativeMetricIds: readonly string[];
  readonly metrics: Readonly<
    Record<
      string,
      Readonly<{
        numerator: number | null;
        denominator: number | null;
        value: number | null;
      }>
    >
  >;
  readonly provenance: TrackReport["provenance"];
}): TrackReport {
  if (!CLAIM_STATUSES.includes(input.claimStatus)) {
    throw new TypeError("track report claim status is invalid");
  }
  if (!EXECUTION_STATUSES.includes(input.executionStatus)) {
    throw new TypeError("track report execution status is invalid");
  }
  if (input.nativeMetricIds.length === 0) {
    throw new TypeError("track report needs at least one native metric");
  }
  const provenanceRecord = input.provenance as Record<string, unknown>;
  const allowedProvenanceKeys = new Set([
    "sourceManifestDigest",
    "runId",
    "nativeEvidenceDigest",
    "rightsRiskAcceptanceDigest",
    "licenseCleared",
    "rightsExecutionScope",
    ...PRODUCT_BOUNDARY_KEYS,
  ]);
  if (
    Object.keys(provenanceRecord).some((key) => !allowedProvenanceKeys.has(key)) ||
    typeof provenanceRecord.runId !== "string" ||
    provenanceRecord.runId.length === 0
  ) {
    throw new TypeError("track report provenance is invalid");
  }
  const sourceManifestDigest = digest(
    provenanceRecord.sourceManifestDigest,
    "track report source manifest digest",
  );
  const nativeEvidenceDigest =
    provenanceRecord.nativeEvidenceDigest === undefined
      ? undefined
      : digest(
          provenanceRecord.nativeEvidenceDigest,
          "track report native evidence digest",
        );
  const productBoundary = boundaryFromFields(
    provenanceRecord,
    "track report provenance",
  );
  const hasRightsRiskAcceptance = RIGHTS_RISK_PROVENANCE_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(provenanceRecord, key),
  );
  let rightsRiskAcceptanceDigest: Sha256Digest | undefined;
  if (hasRightsRiskAcceptance) {
    if (
      provenanceRecord.rightsRiskAcceptanceDigest === undefined ||
      provenanceRecord.licenseCleared !== false ||
      provenanceRecord.rightsExecutionScope !== "private-internal-smoke-only" ||
      input.trackId !== "ifeval" ||
      input.claimStatus !== "calibration" ||
      productBoundary === undefined
    ) {
      throw new TypeError("track report rights risk provenance is invalid");
    }
    rightsRiskAcceptanceDigest = digest(
      provenanceRecord.rightsRiskAcceptanceDigest,
      "track report rights risk acceptance digest",
    );
  }
  const metricIds = new Set(input.nativeMetricIds);
  if (metricIds.size !== input.nativeMetricIds.length) {
    throw new TypeError("track report native metric ids must be unique");
  }
  for (const metricId of input.nativeMetricIds) {
    if (metricId.length === 0)
      throw new TypeError("track report metric ids must not be empty");
    const metric = input.metrics[metricId];
    if (metric === undefined) throw new TypeError(`missing native metric: ${metricId}`);
    if (
      JSON.stringify(Object.keys(metric).sort()) !==
      JSON.stringify(["denominator", "numerator", "value"])
    ) {
      throw new TypeError(`native metric ${metricId} has unexpected fields`);
    }
    for (const [label, value] of Object.entries(metric)) {
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        throw new TypeError(`${metricId}.${label} must be null or non-negative`);
      }
    }
    if (
      metric.denominator !== null &&
      (!Number.isSafeInteger(metric.denominator) || metric.denominator < 0)
    ) {
      throw new TypeError(`${metricId}.denominator must be a non-negative integer`);
    }
    if (metric.numerator !== null && metric.denominator === null) {
      throw new TypeError(`${metricId} cannot have a numerator without a denominator`);
    }
    if (metric.value !== null && metric.denominator === null) {
      throw new TypeError(`${metricId} cannot have a value without a denominator`);
    }
    if (metric.denominator === 0 && metric.value !== null) {
      throw new TypeError(`${metricId} cannot have a value with a zero denominator`);
    }
  }
  const metrics = Object.freeze(
    Object.fromEntries(
      input.nativeMetricIds.map((metricId) => [
        metricId,
        Object.freeze({ ...input.metrics[metricId]! }),
      ]),
    ),
  ) as TrackReport["metrics"];
  const denominators = Object.freeze(
    Object.fromEntries(
      input.nativeMetricIds.map((metricId) => [
        metricId,
        input.metrics[metricId]!.denominator,
      ]),
    ),
  ) as TrackReport["denominators"];
  return Object.freeze({
    trackId: input.trackId,
    claimStatus: input.claimStatus,
    executionStatus: input.executionStatus,
    nativeMetricIds: Object.freeze([...input.nativeMetricIds]),
    denominators,
    metrics,
    provenance: Object.freeze({
      sourceManifestDigest,
      runId: provenanceRecord.runId,
      ...(nativeEvidenceDigest === undefined ? {} : { nativeEvidenceDigest }),
      ...(rightsRiskAcceptanceDigest === undefined
        ? {}
        : {
            rightsRiskAcceptanceDigest,
            licenseCleared: false as const,
            rightsExecutionScope: "private-internal-smoke-only" as const,
          }),
      ...(productBoundary === undefined ? {} : productBoundary),
    }),
  });
}

export function parseTrackReport(value: unknown): TrackReport {
  const record = object(value, "track report");
  const keys = Object.keys(record).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify(
      [
        "claimStatus",
        "denominators",
        "executionStatus",
        "metrics",
        "nativeMetricIds",
        "provenance",
        "trackId",
      ].sort(),
    )
  ) {
    throw new TypeError("track report has unexpected fields");
  }
  const nativeMetricIds = record.nativeMetricIds;
  if (
    !Array.isArray(nativeMetricIds) ||
    nativeMetricIds.some((metricId) => typeof metricId !== "string")
  ) {
    throw new TypeError("track report native metric ids are invalid");
  }
  const metricsRecord = object(record.metrics, "track report metrics");
  const denominatorsRecord = object(record.denominators, "track report denominators");
  if (
    JSON.stringify(Object.keys(denominatorsRecord).sort()) !==
    JSON.stringify([...nativeMetricIds].sort())
  ) {
    throw new TypeError("track report denominators do not match native metric ids");
  }
  if (
    JSON.stringify(Object.keys(metricsRecord).sort()) !==
    JSON.stringify([...nativeMetricIds].sort())
  ) {
    throw new TypeError("track report metrics do not match native metric ids");
  }
  const metrics: Record<
    string,
    { numerator: number | null; denominator: number | null; value: number | null }
  > = {};
  for (const metricId of nativeMetricIds) {
    const metric = object(metricsRecord[metricId], `track report metric ${metricId}`);
    const metricKeys = Object.keys(metric).sort();
    if (
      JSON.stringify(metricKeys) !==
      JSON.stringify(["denominator", "numerator", "value"])
    ) {
      throw new TypeError(`track report metric ${metricId} has unexpected fields`);
    }
    for (const field of ["numerator", "denominator", "value"] as const) {
      const fieldValue = metric[field];
      if (
        fieldValue !== null &&
        (typeof fieldValue !== "number" ||
          !Number.isFinite(fieldValue) ||
          fieldValue < 0)
      ) {
        throw new TypeError(`track report metric ${metricId}.${field} is invalid`);
      }
    }
    metrics[metricId] = {
      numerator: metric.numerator as number | null,
      denominator: metric.denominator as number | null,
      value: metric.value as number | null,
    };
    if (denominatorsRecord[metricId] !== metric.denominator) {
      throw new TypeError(`track report denominator mismatch for ${metricId}`);
    }
  }
  const provenance = object(record.provenance, "track report provenance");
  const allowedProvenanceKeys = new Set([
    "runId",
    "sourceManifestDigest",
    "nativeEvidenceDigest",
    "rightsRiskAcceptanceDigest",
    "licenseCleared",
    "rightsExecutionScope",
    ...PRODUCT_BOUNDARY_KEYS,
  ]);
  if (
    Object.keys(provenance).some((key) => !allowedProvenanceKeys.has(key)) ||
    !("runId" in provenance) ||
    !("sourceManifestDigest" in provenance) ||
    typeof provenance.runId !== "string" ||
    provenance.runId.length === 0
  ) {
    throw new TypeError("track report provenance is invalid");
  }
  const productBoundary = boundaryFromFields(provenance, "track report provenance");
  if (!CLAIM_STATUSES.includes(record.claimStatus as ClaimStatus)) {
    throw new TypeError("track report claim status is invalid");
  }
  if (!EXECUTION_STATUSES.includes(record.executionStatus as ExecutionStatus)) {
    throw new TypeError("track report execution status is invalid");
  }
  return createTrackReport({
    trackId: trackId(record.trackId, "track report trackId"),
    claimStatus: record.claimStatus as ClaimStatus,
    executionStatus: record.executionStatus as ExecutionStatus,
    nativeMetricIds: nativeMetricIds as string[],
    metrics,
    provenance: {
      sourceManifestDigest: digest(
        provenance.sourceManifestDigest,
        "track report source manifest digest",
      ),
      runId: provenance.runId,
      ...(provenance.nativeEvidenceDigest === undefined
        ? {}
        : {
            nativeEvidenceDigest: digest(
              provenance.nativeEvidenceDigest,
              "track report native evidence digest",
            ),
          }),
      ...(provenance.rightsRiskAcceptanceDigest === undefined &&
      provenance.licenseCleared === undefined &&
      provenance.rightsExecutionScope === undefined
        ? {}
        : {
            rightsRiskAcceptanceDigest: digest(
              provenance.rightsRiskAcceptanceDigest,
              "track report rights risk acceptance digest",
            ),
            licenseCleared: provenance.licenseCleared as false,
            rightsExecutionScope:
              provenance.rightsExecutionScope as "private-internal-smoke-only",
          }),
      ...(productBoundary === undefined ? {} : productBoundary),
    },
  });
}
