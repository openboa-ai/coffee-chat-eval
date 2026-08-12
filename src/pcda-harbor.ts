import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  isAbsolute,
  join,
  parse as parsePath,
  relative,
  resolve,
  sep,
} from "node:path";

import { HARBOR_VERSION } from "./harbor.ts";
import {
  computeExecutionTreeDigest,
  type ProjectedPcdaCondition,
} from "./pcda-bench.ts";

export interface CandidateCredentialMetadata {
  readonly available: boolean;
  readonly source: "saved-openai-api-key";
  readonly authorization: "candidate-and-judge";
}

export interface PcdaHarborInput {
  readonly projection: ProjectedPcdaCondition;
  readonly uvxTool: ResolvedUvxTool;
  readonly candidateProviderHost: string;
  readonly candidateModel: string;
  readonly dockerHost: string;
  readonly jobsRoot: string;
  readonly candidateCredential?: CandidateCredentialMetadata;
}

export interface PcdaLaunchNetworkContract {
  readonly networkBaseline: "no-network";
  readonly setupAllowlist: readonly ["dl-cdn.alpinelinux.org", "registry.npmjs.org"];
  readonly agentAllowlist: readonly ["api.openai.com"];
  readonly verifierNetwork: "no-network";
}

const RESOLVED_UVX_BRAND: unique symbol = Symbol("ResolvedUvxTool");
type Sha256Digest = `sha256:${string}`;

export interface UvxTrustPolicy {
  readonly expectedDigest: Sha256Digest;
  readonly expectedVersion: string;
}

export interface ResolvedUvxTool {
  readonly path: string;
  readonly observedDigest: Sha256Digest;
  readonly observedVersion: string;
  readonly policyDigest: Sha256Digest;
  readonly policyVersion: string;
  readonly [RESOLVED_UVX_BRAND]: true;
}

export type PcdaHarborLaunch =
  | {
      readonly state: "unavailable";
      readonly reason: "candidate credential was not supplied";
    }
  | {
      readonly state: "ready";
      readonly command: string;
      readonly uvx: Readonly<{
        path: string;
        observedDigest: Sha256Digest;
        observedVersion: string;
        policyDigest: Sha256Digest;
        policyVersion: string;
      }>;
      readonly args: readonly string[];
      readonly environmentTemplate: Readonly<Record<string, string>>;
      readonly credentialBinding: {
        readonly childVariable: "OPENAI_API_KEY";
        readonly source: "saved-openai-api-key";
        readonly authorization: "candidate-and-judge";
      };
      readonly jobDirectory: string;
      readonly network: PcdaLaunchNetworkContract;
    };

export interface PcdaSpawnInput {
  readonly launch: Extract<PcdaHarborLaunch, { readonly state: "ready" }>;
  readonly credentialName: string;
  readonly loadCredential: (name: string) => string;
  readonly spawn: (
    command: string,
    args: readonly string[],
    environment: Readonly<Record<string, string>>,
  ) => { readonly exitCode: number; readonly boundedOutput?: string };
}

export interface PcdaSpawnResult {
  readonly state: "completed" | "failed";
  readonly exitCode: number;
  readonly jobDirectory: string;
}

const SETUP_ALLOWLIST = Object.freeze([
  "dl-cdn.alpinelinux.org",
  "registry.npmjs.org",
] as const);
const RESOLVED_UVX_TOOLS = new WeakSet<object>();
const READY_LAUNCHES = new WeakMap<
  object,
  {
    readonly tool: ResolvedUvxTool;
    readonly projection: ProjectedPcdaCondition;
  }
>();
const RESOLVED_UVX_INSPECTIONS = new WeakMap<
  object,
  {
    readonly mode: number;
    readonly uid: number;
    readonly observedDigest: Sha256Digest;
    readonly observedVersion: string;
    readonly policyDigest: Sha256Digest;
    readonly policyVersion: string;
  }
>();
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const UVX_VERSION_PATTERN =
  /^uvx [0-9]+\.[0-9]+\.[0-9]+(?: \([0-9a-f]{7,40} [0-9]{4}-[0-9]{2}-[0-9]{2}\))?$/u;
const REQUIRED_TASK_FILES = [
  "projection.json",
  "harbor/task.toml",
  "harbor/instruction.md",
  "harbor/environment/Dockerfile",
  "harbor/environment/input/task.json",
  "harbor/environment/input/evidence.json",
  "harbor/environment/input/output-contract.json",
  "harbor/tests/Dockerfile",
  "harbor/tests/test.sh",
  "harbor/tests/verifier.py",
  "harbor/tests/judgment.json",
] as const;

function pathSegments(path: string): readonly string[] {
  const root = parsePath(path).root;
  return relative(root, path).split(sep).filter(Boolean);
}

function inspectUvxExecutable(path: string): {
  readonly digest: Sha256Digest;
  readonly mode: number;
  readonly uid: number;
} {
  requireStrictPath(path, "absolute uvxPath", "executable");
  const stat = lstatSync(path);
  const currentUid = process.getuid?.();
  if (currentUid === undefined || stat.uid !== currentUid) {
    throw new Error("uvxPath must be owned by the current user");
  }
  if ((stat.mode & 0o022) !== 0) {
    throw new Error("uvxPath must not be group or world writable");
  }
  return {
    digest: `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`,
    mode: stat.mode & 0o7777,
    uid: stat.uid,
  };
}

function validateUvxTrustPolicy(policy: UvxTrustPolicy): void {
  if (!Object.isFrozen(policy)) {
    throw new Error("uvx trust policy must be immutable and frozen");
  }
  if (!SHA256_DIGEST_PATTERN.test(policy.expectedDigest)) {
    throw new Error("uvx trust policy digest must be a sha256 digest");
  }
  if (
    policy.expectedVersion.length > 128 ||
    !UVX_VERSION_PATTERN.test(policy.expectedVersion)
  ) {
    throw new Error("uvx trust policy version must match the bounded uvx format");
  }
}

export function resolveUvxTool(path: string, policy: UvxTrustPolicy): ResolvedUvxTool {
  validateUvxTrustPolicy(policy);
  const inspection = inspectUvxExecutable(path);
  if (inspection.digest !== policy.expectedDigest) {
    throw new Error("uvx digest does not match the external trust policy");
  }
  const home = mkdtempSync(join(realpathSync(tmpdir()), "pcda-uvx-resolve-"));
  let observedVersion: string;
  try {
    observedVersion = execFileSync(path, ["--version"], {
      encoding: "utf8",
      env: {
        HOME: home,
        LANG: "C.UTF-8",
        PATH: "/usr/bin:/bin",
      },
      maxBuffer: 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
    }).trim();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
  if (observedVersion.length > 128 || !UVX_VERSION_PATTERN.test(observedVersion)) {
    throw new Error("uvx --version must match the bounded uvx version format");
  }
  if (observedVersion !== policy.expectedVersion) {
    throw new Error("uvx version does not match the external trust policy");
  }
  const postVersionInspection = inspectUvxExecutable(path);
  if (
    postVersionInspection.digest !== inspection.digest ||
    postVersionInspection.mode !== inspection.mode ||
    postVersionInspection.uid !== inspection.uid
  ) {
    throw new Error("uvx changed while resolving version evidence");
  }
  const value = {
    path,
    observedDigest: inspection.digest,
    observedVersion,
    policyDigest: policy.expectedDigest,
    policyVersion: policy.expectedVersion,
  } as Omit<ResolvedUvxTool, typeof RESOLVED_UVX_BRAND> &
    Partial<Pick<ResolvedUvxTool, typeof RESOLVED_UVX_BRAND>>;
  Object.defineProperty(value, RESOLVED_UVX_BRAND, { value: true });
  Object.freeze(value);
  RESOLVED_UVX_TOOLS.add(value);
  RESOLVED_UVX_INSPECTIONS.set(
    value,
    Object.freeze({
      mode: inspection.mode,
      uid: inspection.uid,
      observedDigest: inspection.digest,
      observedVersion,
      policyDigest: policy.expectedDigest,
      policyVersion: policy.expectedVersion,
    }),
  );
  return value as ResolvedUvxTool;
}

function recheckResolvedUvxTool(tool: ResolvedUvxTool): ResolvedUvxTool {
  if (!RESOLVED_UVX_TOOLS.has(tool)) {
    throw new Error("uvxTool must be resolved by resolveUvxTool");
  }
  const expected = RESOLVED_UVX_INSPECTIONS.get(tool);
  if (expected === undefined) {
    throw new Error("uvxTool resolution evidence is missing");
  }
  const inspection = inspectUvxExecutable(tool.path);
  if (inspection.mode !== expected.mode || inspection.uid !== expected.uid) {
    throw new Error("uvx mode or ownership changed after resolution");
  }
  if (
    inspection.digest !== expected.observedDigest ||
    tool.observedDigest !== expected.observedDigest ||
    tool.observedVersion !== expected.observedVersion ||
    tool.policyDigest !== expected.policyDigest ||
    tool.policyVersion !== expected.policyVersion
  ) {
    throw new Error("uvx digest changed after resolution");
  }
  return tool;
}

function requireStrictPath(
  path: string,
  label: string,
  kind: "directory" | "file" | "executable",
): string {
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw new Error(`${label} must be an absolute canonical path`);
  }
  const root = parsePath(path).root;
  let current = root;
  const segments = pathSegments(path);
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      throw new Error(`${label} path is missing: ${current}`, { cause: error });
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} path must not contain a symbolic link: ${current}`);
    }
    const final = index === segments.length - 1;
    if (!final && !stat.isDirectory()) {
      throw new Error(`${label} ancestor must be a directory: ${current}`);
    }
    if (final && kind === "directory" && !stat.isDirectory()) {
      throw new Error(`${label} must be a directory`);
    }
    if (final && kind !== "directory" && !stat.isFile()) {
      throw new Error(`${label} must be a required regular file`);
    }
    if (final && kind === "executable" && (stat.mode & 0o111) === 0) {
      throw new Error(`${label} must be an executable regular file`);
    }
  }
  return path;
}

function rejectProjectionSymlinks(root: string): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`projection tree must not contain a symbolic link: ${path}`);
      }
      if (stat.isDirectory()) visit(path);
      else if (!stat.isFile()) {
        throw new Error(`projection tree contains a non-regular entry: ${path}`);
      }
    }
  };
  visit(root);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function verifyProjectionManifest(projection: ProjectedPcdaCondition): void {
  const value = record(
    JSON.parse(
      readFileSync(join(projection.projectionRoot, "projection.json"), "utf8"),
    ),
    "projection.json",
  );
  const expected = {
    release: projection.release,
    condition: projection.benchCondition,
    sourceDigest: projection.caseSourceDigest,
    candidateDigest: projection.candidateDigest,
    verifierDigest: projection.verifierDigest,
    projectionDigest: projection.projectionDigest,
    harborDirectory: projection.taskPath,
  } as const;
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (value[field] !== expectedValue) {
      throw new Error(`projection.json does not bind trusted ${field}`);
    }
  }
}

function verifyTrustedProjection(projection: ProjectedPcdaCondition): void {
  requireStrictPath(projection.projectionRoot, "projectionRoot", "directory");
  const expectedTaskPath = join(projection.projectionRoot, "harbor");
  const expectedTaskToml = join(expectedTaskPath, "task.toml");
  if (
    projection.taskPath !== expectedTaskPath ||
    projection.taskTomlPath !== expectedTaskToml
  ) {
    throw new Error("task path must bind to the trusted projection root");
  }
  rejectProjectionSymlinks(projection.projectionRoot);
  for (const file of REQUIRED_TASK_FILES) {
    requireStrictPath(
      join(projection.projectionRoot, file),
      `required task file ${file}`,
      "file",
    );
  }
  if (projection.condition !== "T0") {
    requireStrictPath(
      join(projection.taskPath, "environment", "input", "perspective.json"),
      "required task file perspective.json",
      "file",
    );
  }
  verifyProjectionManifest(projection);
}

function parseTomlString(raw: string, key: string): string {
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === "string") return value;
  } catch {
    // The uniform task.toml error below is the public failure boundary.
  }
  throw new Error(`task.toml ${key} must be a quoted string`);
}

function parseTaskToml(path: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  const sections = new Set<string>();
  let section = "";
  for (const [index, sourceLine] of readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .entries()) {
    const line = sourceLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const table = line.match(/^\[([A-Za-z0-9_.-]+)\]$/u);
    if (table !== null) {
      section = table[1]!;
      if (sections.has(section)) {
        throw new Error(`task.toml contains duplicate section [${section}]`);
      }
      sections.add(section);
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u);
    if (assignment === null) {
      throw new Error(`task.toml line ${index + 1} is unsupported`);
    }
    const key = section === "" ? assignment[1]! : `${section}.${assignment[1]!}`;
    if (values.has(key)) throw new Error(`task.toml contains duplicate ${key}`);
    values.set(key, assignment[2]!);
  }
  return values;
}

function verifyTaskToml(path: string): void {
  const values = parseTaskToml(path);
  const artifactsRaw = values.get("artifacts");
  let artifacts: unknown;
  try {
    artifacts = artifactsRaw === undefined ? undefined : JSON.parse(artifactsRaw);
  } catch (error) {
    throw new Error("task.toml artifacts must be a JSON-compatible string array", {
      cause: error,
    });
  }
  if (
    !Array.isArray(artifacts) ||
    artifacts.length !== 1 ||
    artifacts[0] !== "/app/output.json"
  ) {
    throw new Error("task.toml must declare exactly one /app/output.json artifact");
  }
  const required = {
    "agent.network_mode": "no-network",
    "environment.network_mode": "no-network",
    "verifier.environment_mode": "separate",
    "verifier.environment.network_mode": "no-network",
  } as const;
  for (const [key, expected] of Object.entries(required)) {
    const raw = values.get(key);
    if (raw === undefined || parseTomlString(raw, key) !== expected) {
      throw new Error(`task.toml ${key} must be ${expected}`);
    }
  }
}

function requireCandidateProviderHost(host: string): "api.openai.com" {
  if (host !== "api.openai.com") {
    throw new Error(
      "candidateProviderHost must be the bare first-baseline hostname api.openai.com",
    );
  }
  return host;
}

function requireCandidateModel(model: string): "gpt-5.6-terra" {
  if (model !== "gpt-5.6-terra") {
    throw new Error("candidateModel must be gpt-5.6-terra");
  }
  return model;
}

function requireDockerHost(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error("dockerHost must be an absolute unix socket URL", {
      cause: error,
    });
  }
  if (
    parsed.protocol !== "unix:" ||
    parsed.host !== "" ||
    !isAbsolute(parsed.pathname) ||
    value.length > 4_096
  ) {
    throw new Error("dockerHost must be an absolute unix socket URL");
  }
  return value;
}

export function buildPcdaHarborArgs(input: PcdaHarborInput): PcdaHarborLaunch {
  verifyTrustedProjection(input.projection);
  verifyTaskToml(input.projection.taskTomlPath);
  if (
    computeExecutionTreeDigest(input.projection.projectionRoot) !==
    input.projection.executionTreeDigest
  ) {
    throw new Error("projection execution tree digest changed after projection");
  }
  const candidateProviderHost = requireCandidateProviderHost(
    input.candidateProviderHost,
  );
  const candidateModel = requireCandidateModel(input.candidateModel);
  const dockerHost = requireDockerHost(input.dockerHost);

  if (
    input.candidateCredential === undefined ||
    input.candidateCredential.available !== true
  ) {
    return Object.freeze({
      state: "unavailable",
      reason: "candidate credential was not supplied",
    });
  }
  const credential = input.candidateCredential;
  if (credential.source !== "saved-openai-api-key") {
    throw new Error("ambient credential sources are forbidden");
  }
  if (credential.authorization !== "candidate-and-judge") {
    throw new Error("candidate credential requires explicit shared-key authorization");
  }
  const uvxTool = recheckResolvedUvxTool(input.uvxTool);

  const jobsRoot = resolve(input.jobsRoot);
  mkdirSync(jobsRoot, { recursive: true });
  const jobDirectory = mkdtempSync(
    join(jobsRoot, `pcda-${input.projection.condition.toLowerCase()}-`),
  );
  const home = join(jobDirectory, "home");
  const config = join(jobDirectory, "config");
  const dockerConfig = join(jobDirectory, "docker-config");
  mkdirSync(home);
  mkdirSync(config);
  mkdirSync(dockerConfig);
  writeFileSync(
    join(dockerConfig, "config.json"),
    `${JSON.stringify({
      cliPluginsExtraDirs: ["/opt/homebrew/lib/docker/cli-plugins"],
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  const args = Object.freeze([
    "--from",
    `harbor==${HARBOR_VERSION}`,
    "harbor",
    "run",
    "--path",
    input.projection.taskPath,
    "--agent",
    "codex",
    "--model",
    candidateModel,
    "--agent-kwarg",
    "version=0.147.0",
    "--env",
    "docker",
    ...SETUP_ALLOWLIST.flatMap((host) => ["--allow-environment-host", host]),
    "--allow-agent-host",
    candidateProviderHost,
    "--job-name",
    `coffee-chat-pcda-${input.projection.condition.toLowerCase()}`,
    "--jobs-dir",
    jobDirectory,
    "--n-concurrent",
    "1",
    "--yes",
    "--quiet",
  ]);
  const environmentTemplate = Object.freeze({
    DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: dockerHost,
    HOME: home,
    LANG: "C.UTF-8",
    // Harbor needs the host Docker CLI before it creates the isolated trial.
    // Keep this allowlist deterministic instead of inheriting the caller's PATH.
    PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
    XDG_CONFIG_HOME: config,
  });
  const credentialBinding = Object.freeze({
    childVariable: "OPENAI_API_KEY" as const,
    source: credential.source,
    authorization: credential.authorization,
  });
  const network: PcdaLaunchNetworkContract = Object.freeze({
    networkBaseline: "no-network",
    setupAllowlist: SETUP_ALLOWLIST,
    agentAllowlist: Object.freeze([candidateProviderHost] as const),
    verifierNetwork: "no-network",
  });
  const launch = Object.freeze({
    state: "ready",
    command: uvxTool.path,
    uvx: Object.freeze({
      path: uvxTool.path,
      observedDigest: uvxTool.observedDigest,
      observedVersion: uvxTool.observedVersion,
      policyDigest: uvxTool.policyDigest,
      policyVersion: uvxTool.policyVersion,
    }),
    args,
    environmentTemplate,
    credentialBinding,
    jobDirectory,
    network,
  });
  READY_LAUNCHES.set(launch, { tool: uvxTool, projection: input.projection });
  return launch;
}

export function executePcdaSpawn(input: PcdaSpawnInput): PcdaSpawnResult {
  const authority = READY_LAUNCHES.get(input.launch);
  if (authority === undefined) {
    throw new Error("launch must be returned by buildPcdaHarborArgs");
  }
  if (
    input.credentialName === "OPENAI_API_KEY" ||
    !/^[A-Z][A-Z0-9_]{2,127}$/u.test(input.credentialName)
  ) {
    throw new Error("candidate credential requires a dedicated parent credential name");
  }

  recheckResolvedUvxTool(authority.tool);
  verifyTrustedProjection(authority.projection);
  if (
    computeExecutionTreeDigest(authority.projection.projectionRoot) !==
    authority.projection.executionTreeDigest
  ) {
    throw new Error("projection execution tree digest changed before spawn");
  }

  const credential = input.loadCredential(input.credentialName);
  if (credential.length === 0 || credential.length > 16_384) {
    throw new Error("candidate credential is missing or unbounded");
  }
  const environment = Object.freeze({
    ...input.launch.environmentTemplate,
    [input.launch.credentialBinding.childVariable]: credential,
  });
  const result = input.spawn(input.launch.command, input.launch.args, environment);
  if (!Number.isSafeInteger(result.exitCode) || result.exitCode < 0) {
    throw new Error("spawn exitCode must be a non-negative safe integer");
  }
  if (result.boundedOutput?.includes(credential)) {
    throw new Error("Harbor child output contained credential material");
  }
  return Object.freeze({
    state: result.exitCode === 0 ? "completed" : "failed",
    exitCode: result.exitCode,
    jobDirectory: input.launch.jobDirectory,
  });
}
