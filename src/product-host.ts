import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type {
  CandidateTransport,
  InteractiveAgentTransport,
  ProductCandidateBoundary,
} from "./eval-core.ts";
import {
  COFFEE_CHAT_PRODUCT_CALVER,
  COFFEE_CHAT_PRODUCT_COMMIT,
  COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
  COFFEE_CHAT_PRODUCT_REPOSITORY,
  type CoffeeChatProductIdentity,
} from "./runtime-config.ts";
import type { Sha256Digest } from "./types.ts";

const execute = promisify(execFile);
const GIT_BINARY = "/usr/bin/git";
const SAFE_GIT_ENV = Object.freeze({
  PATH: "/usr/bin:/bin",
  LANG: "C",
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_NO_REPLACE_OBJECTS: "1",
});
const COMMIT = /^[0-9a-f]{40}$/u;
const CALVER = /^[0-9]{4}\.(?:[1-9]|1[0-2])\.(?:[1-9]|[12][0-9]|3[01])$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;

/**
 * This list mirrors the public package surface declared by the Product's
 * scripts/package-lib.mjs. Eval deliberately owns this pin instead of importing
 * candidate source code at runtime.
 */
export const PRODUCT_PACKAGE_ROOTS = Object.freeze([
  ".agents",
  ".codex-plugin",
  "config/capabilities.json",
  "config/plugin-metadata.json",
  "contract",
  "docs/assets/readme/coffee-chat-hero.png",
  "docs/assets/readme/coffee-chat-judgment.png",
  "docs/assets/readme/coffee-chat-talk-work.png",
  "docs/product-boundaries.md",
  "docs/quality-map.md",
  "runtime",
  "skills",
  "AGENTS.md",
  "INSTALL_FOR_AGENTS.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "plugin.json",
] as const);

const EXPECTED_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "init",
    skill: "coffee-init",
    entrypoint: "skills/coffee-init/scripts/run.mjs",
    state: "available",
  }),
  Object.freeze({
    id: "sync",
    skill: "coffee-sync",
    entrypoint: "skills/coffee-sync/scripts/run.mjs",
    state: "not_implemented",
  }),
  Object.freeze({
    id: "unsync",
    skill: "coffee-unsync",
    entrypoint: "skills/coffee-unsync/scripts/run.mjs",
    state: "not_implemented",
  }),
  Object.freeze({
    id: "roast",
    skill: "coffee-roast",
    entrypoint: "skills/coffee-roast/scripts/run.mjs",
    state: "not_implemented",
  }),
  Object.freeze({
    id: "brew",
    skill: "coffee-brew",
    entrypoint: "skills/coffee-brew/scripts/run.mjs",
    state: "not_implemented",
  }),
  Object.freeze({
    id: "coffee-chat",
    skill: "coffee-chat",
    entrypoint: "skills/coffee-chat/scripts/run.mjs",
    state: "not_implemented",
  }),
  Object.freeze({
    id: "coffee-blend",
    skill: "coffee-blend",
    entrypoint: "skills/coffee-blend/scripts/run.mjs",
    state: "not_implemented",
  }),
] as const);

interface PackageFile {
  readonly path: string;
  readonly bytes: Buffer;
}

export type CoffeeChatProductCandidateMetadata = ProductCandidateBoundary;

export type ProductPackageVerification =
  | {
      readonly state: "verified";
      readonly metadata: CoffeeChatProductCandidateMetadata;
      readonly capabilityContractDigest: Sha256Digest;
    }
  | {
      readonly state: "unavailable";
      readonly failureOwner: "host";
      readonly reason: string;
    };

export interface VerifiedCoffeeChatProductCandidateTransport extends CandidateTransport {
  readonly kind: "coffee_chat_product";
  readonly productBoundary: CoffeeChatProductCandidateMetadata;
  readonly productHostPreflight: Readonly<{ state: "verified" }>;
}

export interface VerifiedCoffeeChatProductInteractiveTransport extends InteractiveAgentTransport {
  readonly kind: "coffee_chat_product";
  readonly productBoundary: CoffeeChatProductCandidateMetadata;
  readonly productHostPreflight: Readonly<{ state: "verified" }>;
}

export interface UnavailableCoffeeChatProductCandidateTransport extends CandidateTransport {
  readonly kind: "coffee_chat_product";
  readonly productBoundary: CoffeeChatProductCandidateMetadata;
  readonly productHostPreflight: Readonly<{
    state: "unavailable";
    reason: string;
  }>;
}

export interface UnavailableCoffeeChatProductInteractiveTransport extends InteractiveAgentTransport {
  readonly kind: "coffee_chat_product";
  readonly productBoundary: CoffeeChatProductCandidateMetadata;
  readonly productHostPreflight: Readonly<{
    state: "unavailable";
    reason: string;
  }>;
}

export type PreparedCoffeeChatProductCandidateTransport =
  | {
      readonly state: "verified";
      readonly metadata: CoffeeChatProductCandidateMetadata;
      readonly capabilityContractDigest: Sha256Digest;
      readonly transport: VerifiedCoffeeChatProductCandidateTransport;
    }
  | {
      readonly state: "unavailable";
      readonly failureOwner: "host";
      readonly reason: string;
      readonly metadata: CoffeeChatProductCandidateMetadata;
      readonly transport: UnavailableCoffeeChatProductCandidateTransport;
    };

export type PreparedCoffeeChatProductInteractiveTransport =
  | {
      readonly state: "verified";
      readonly metadata: CoffeeChatProductCandidateMetadata;
      readonly capabilityContractDigest: Sha256Digest;
      readonly transport: VerifiedCoffeeChatProductInteractiveTransport;
    }
  | {
      readonly state: "unavailable";
      readonly failureOwner: "host";
      readonly reason: string;
      readonly metadata: CoffeeChatProductCandidateMetadata;
      readonly transport: UnavailableCoffeeChatProductInteractiveTransport;
    };

class SafeVerificationError extends Error {}

function sha256(bytes: Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function contained(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !isAbsolute(pathFromRoot))
  );
}

async function collectPackageFiles(
  packageRoot: string,
): Promise<readonly PackageFile[]> {
  if (!isAbsolute(packageRoot)) {
    throw new SafeVerificationError("Product package root must be absolute");
  }
  const root = resolve(packageRoot);
  try {
    const rootInformation = await lstat(root);
    if (rootInformation.isSymbolicLink()) {
      throw new SafeVerificationError("Product package root symlink is forbidden");
    }
    if (!rootInformation.isDirectory()) {
      throw new SafeVerificationError("Product package root must be a directory");
    }
    await realpath(root);
  } catch (error) {
    if (error instanceof SafeVerificationError) throw error;
    throw new SafeVerificationError("Product package root is unavailable");
  }
  const found: PackageFile[] = [];
  async function visit(path: string): Promise<void> {
    const absolute = resolve(root, path);
    if (!contained(root, absolute)) {
      throw new SafeVerificationError(`Product package path escapes its root: ${path}`);
    }
    let information;
    try {
      information = await lstat(absolute);
    } catch {
      throw new SafeVerificationError(`Product package entry is missing: ${path}`);
    }
    if (information.isSymbolicLink()) {
      throw new SafeVerificationError(`Product package symlink is forbidden: ${path}`);
    }
    if (information.isDirectory()) {
      const children = await readdir(absolute);
      for (const child of children.sort()) await visit(join(path, child));
      return;
    }
    if (!information.isFile()) {
      throw new SafeVerificationError(`Product package entry is unsupported: ${path}`);
    }
    const normalized = path.split(sep).join("/");
    found.push({ path: normalized, bytes: await readFile(absolute) });
  }

  for (const entry of PRODUCT_PACKAGE_ROOTS) await visit(entry);
  return found.sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Reproduces the Product's deterministic, uncompressed package ZIP bytes. */
function packageZip(files: readonly PackageFile[]): Buffer {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(`coffee-chat/${file.path}`, "utf8");
    const checksum = crc32(file.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(file.bytes.length, 18);
    local.writeUInt32LE(file.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, file.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(file.bytes.length, 20);
    central.writeUInt32LE(file.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + file.bytes.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

export async function calculateProductPackageDigest(
  packageRoot: string,
): Promise<Sha256Digest> {
  return sha256(packageZip(await collectPackageFiles(packageRoot)));
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SafeVerificationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !(key in record))
  ) {
    throw new SafeVerificationError(`${label} has unexpected fields`);
  }
}

function parseJson(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    return object(JSON.parse(bytes.toString("utf8")), label);
  } catch (error) {
    if (error instanceof SafeVerificationError) throw error;
    throw new SafeVerificationError(`${label} is not valid JSON`);
  }
}

function fileByPath(files: readonly PackageFile[], path: string): PackageFile {
  const file = files.find((entry) => entry.path === path);
  if (file === undefined) {
    throw new SafeVerificationError(`Product package entry is missing: ${path}`);
  }
  return file;
}

function verifyPluginIdentity(
  files: readonly PackageFile[],
  identity: CoffeeChatProductIdentity,
): void {
  for (const path of [
    "plugin.json",
    ".codex-plugin/plugin.json",
    "config/plugin-metadata.json",
  ]) {
    const manifest = parseJson(fileByPath(files, path).bytes, `Product ${path}`);
    if (manifest.name !== "coffee-chat") {
      throw new SafeVerificationError(`Product ${path} name does not match`);
    }
    if (manifest.version !== identity.calver) {
      throw new SafeVerificationError(`Product ${path} version does not match`);
    }
    if (manifest.repository !== identity.repository) {
      throw new SafeVerificationError(`Product ${path} repository does not match`);
    }
  }
}

function verifyCapabilityContract(
  files: readonly PackageFile[],
  identity: CoffeeChatProductIdentity,
): Sha256Digest {
  const contractFile = fileByPath(files, "config/capabilities.json");
  const contract = parseJson(contractFile.bytes, "Product capability contract");
  exactKeys(
    contract,
    ["schema", "product", "calver", "interface", "capabilities"],
    "Product capability contract",
  );
  if (
    contract.schema !== "coffee-chat-capabilities-v1" ||
    contract.product !== "coffee-chat" ||
    contract.calver !== identity.calver ||
    contract.interface !== "skills" ||
    !Array.isArray(contract.capabilities) ||
    contract.capabilities.length !== EXPECTED_CAPABILITIES.length
  ) {
    throw new SafeVerificationError("Product capability contract does not match");
  }

  for (let index = 0; index < EXPECTED_CAPABILITIES.length; index += 1) {
    const expected = EXPECTED_CAPABILITIES[index];
    const actual = object(
      contract.capabilities[index],
      "Product capability contract entry",
    );
    exactKeys(
      actual,
      ["id", "skill", "entrypoint", "state"],
      "Product capability contract entry",
    );
    if (
      expected === undefined ||
      actual.id !== expected.id ||
      actual.skill !== expected.skill ||
      actual.entrypoint !== expected.entrypoint ||
      actual.state !== expected.state
    ) {
      throw new SafeVerificationError("Product capability contract does not match");
    }
    fileByPath(files, expected.entrypoint);
    fileByPath(files, `skills/${expected.skill}/SKILL.md`);
  }
  return sha256(contractFile.bytes);
}

async function gitOutput(root: string, arguments_: readonly string[]): Promise<string> {
  try {
    const result = await execute(
      GIT_BINARY,
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        root,
        ...arguments_,
      ],
      {
        encoding: "utf8",
        env: SAFE_GIT_ENV,
        maxBuffer: 1024 * 1024,
      },
    );
    return result.stdout.trim();
  } catch {
    throw new SafeVerificationError("Product Git checkout is unavailable");
  }
}

async function gitBytes(root: string, arguments_: readonly string[]): Promise<Buffer> {
  try {
    const result = await execute(
      GIT_BINARY,
      [
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-C",
        root,
        ...arguments_,
      ],
      {
        encoding: "buffer",
        env: SAFE_GIT_ENV,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    return result.stdout as Buffer;
  } catch {
    throw new SafeVerificationError("Product Git checkout is unavailable");
  }
}

async function verifyGitPackageSurface(
  root: string,
  files: readonly PackageFile[],
): Promise<void> {
  const rawTree = await gitBytes(root, [
    "ls-tree",
    "-r",
    "--full-tree",
    "-z",
    "HEAD",
    "--",
    ...PRODUCT_PACKAGE_ROOTS,
  ]);
  const entries = rawTree
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const match = /^(100644|100755) blob ([0-9a-f]{40,64})\t([^\n\r\0]+)$/u.exec(
        entry,
      );
      if (match === null) {
        throw new SafeVerificationError(
          "Product public package surface contains an unsupported Git entry",
        );
      }
      return Object.freeze({ objectId: match[2]!, path: match[3]! });
    });
  if (
    entries.length !== files.length ||
    entries.some((entry, index) => entry.path !== files[index]?.path)
  ) {
    throw new SafeVerificationError("Product public package surface is not clean");
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const working = files[index]!;
    const committed = await gitBytes(root, ["cat-file", "blob", entry.objectId]);
    if (!committed.equals(working.bytes)) {
      throw new SafeVerificationError("Product public package surface is not clean");
    }
  }
}

function validateIdentity(identity: CoffeeChatProductIdentity): void {
  if (
    identity.repository !== COFFEE_CHAT_PRODUCT_REPOSITORY ||
    !COMMIT.test(identity.commit) ||
    !CALVER.test(identity.calver) ||
    !DIGEST.test(identity.packageDigest) ||
    identity.mode !== "connectivity_only"
  ) {
    throw new SafeVerificationError("Product candidate identity is invalid");
  }
}

function validateAdmittedIdentity(identity: CoffeeChatProductIdentity): void {
  validateIdentity(identity);
  if (
    identity.commit !== COFFEE_CHAT_PRODUCT_COMMIT ||
    identity.calver !== COFFEE_CHAT_PRODUCT_CALVER ||
    identity.packageDigest !== COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST
  ) {
    throw new SafeVerificationError(
      "Product candidate identity does not match the admitted release",
    );
  }
}

async function verifyPackageAgainstSuppliedIdentity(input: {
  readonly packageRoot: string;
  readonly identity: CoffeeChatProductIdentity;
}): Promise<ProductPackageVerification> {
  try {
    validateIdentity(input.identity);
    const root = resolve(input.packageRoot);
    const canonicalRoot = await realpath(root);
    const files = await collectPackageFiles(input.packageRoot);
    const topLevel = resolve(await gitOutput(root, ["rev-parse", "--show-toplevel"]));
    if ((await realpath(topLevel)) !== canonicalRoot) {
      throw new SafeVerificationError(
        "Product package root is not the Git checkout root",
      );
    }
    const remote = (await gitOutput(root, ["remote", "get-url", "origin"])).replace(
      /\.git$/u,
      "",
    );
    if (remote !== input.identity.repository) {
      throw new SafeVerificationError(
        "Product Git remote does not match candidate identity",
      );
    }
    if ((await gitOutput(root, ["rev-parse", "HEAD"])) !== input.identity.commit) {
      throw new SafeVerificationError(
        "Product Git HEAD does not match candidate identity",
      );
    }
    await verifyGitPackageSurface(root, files);
    const packageDigest = sha256(packageZip(files));
    if (packageDigest !== input.identity.packageDigest) {
      throw new SafeVerificationError(
        "Product package digest does not match candidate identity",
      );
    }
    verifyPluginIdentity(files, input.identity);
    const capabilityContractDigest = verifyCapabilityContract(files, input.identity);
    const metadata = boundaryFromIdentity(input.identity);
    return Object.freeze({
      state: "verified" as const,
      metadata,
      capabilityContractDigest,
    });
  } catch (error) {
    return Object.freeze({
      state: "unavailable" as const,
      failureOwner: "host" as const,
      reason:
        error instanceof SafeVerificationError
          ? error.message
          : "Product package verification failed",
    });
  }
}

export async function verifyCoffeeChatProductPackage(input: {
  readonly packageRoot: string;
  readonly identity: CoffeeChatProductIdentity;
}): Promise<ProductPackageVerification> {
  try {
    validateAdmittedIdentity(input.identity);
  } catch (error) {
    return Object.freeze({
      state: "unavailable" as const,
      failureOwner: "host" as const,
      reason:
        error instanceof SafeVerificationError
          ? error.message
          : "Product package verification failed",
    });
  }
  return verifyPackageAgainstSuppliedIdentity(input);
}

function verifiedPreflight(): Readonly<{ state: "verified" }> {
  return Object.freeze({ state: "verified" as const });
}

function boundaryFromIdentity(
  identity: CoffeeChatProductIdentity,
): CoffeeChatProductCandidateMetadata {
  return Object.freeze({
    candidateMode: "connectivity_only" as const,
    capabilitiesUsed: Object.freeze([]) as readonly [],
    productBehaviorExercised: false as const,
    referenceHost: "eval-skills-reference-host-v1" as const,
    productIdentity: Object.freeze({
      repository: identity.repository,
      commit: identity.commit,
      calver: identity.calver,
      packageDigest: identity.packageDigest,
    }),
  });
}

function unavailablePreflight(reason: string): Readonly<{
  state: "unavailable";
  reason: string;
}> {
  return Object.freeze({ state: "unavailable" as const, reason });
}

function unavailableCandidateTransport(
  identity: CoffeeChatProductIdentity,
  reason: string,
): UnavailableCoffeeChatProductCandidateTransport {
  const productBoundary = boundaryFromIdentity(identity);
  return Object.freeze({
    kind: "coffee_chat_product" as const,
    productBoundary,
    productHostPreflight: unavailablePreflight(reason),
    run: async () => ({
      state: "unavailable" as const,
      reason,
      failureOwner: "host" as const,
    }),
  });
}

export class ProductHostUnavailableError extends Error {
  readonly state = "unavailable" as const;
  readonly failureOwner = "host" as const;
}

function unavailableInteractiveTransport(
  identity: CoffeeChatProductIdentity,
  reason: string,
): UnavailableCoffeeChatProductInteractiveTransport {
  const batch = unavailableCandidateTransport(identity, reason);
  return Object.freeze({
    ...batch,
    openSession: async () => {
      throw new ProductHostUnavailableError(reason);
    },
  });
}

function unavailableCandidatePreparation(
  identity: CoffeeChatProductIdentity,
  reason: string,
): Extract<PreparedCoffeeChatProductCandidateTransport, { state: "unavailable" }> {
  return Object.freeze({
    state: "unavailable" as const,
    failureOwner: "host" as const,
    reason,
    metadata: boundaryFromIdentity(identity),
    transport: unavailableCandidateTransport(identity, reason),
  });
}

function unavailableInteractivePreparation(
  identity: CoffeeChatProductIdentity,
  reason: string,
): Extract<PreparedCoffeeChatProductInteractiveTransport, { state: "unavailable" }> {
  return Object.freeze({
    state: "unavailable" as const,
    failureOwner: "host" as const,
    reason,
    metadata: boundaryFromIdentity(identity),
    transport: unavailableInteractiveTransport(identity, reason),
  });
}

async function prepareCandidateTransportWithVerifier(
  input: {
    readonly packageRoot: string;
    readonly identity: CoffeeChatProductIdentity;
    readonly delegate: CandidateTransport;
  },
  verifier: typeof verifyCoffeeChatProductPackage,
): Promise<PreparedCoffeeChatProductCandidateTransport> {
  const verification = await verifier(input);
  if (verification.state !== "verified") {
    return unavailableCandidatePreparation(input.identity, verification.reason);
  }
  if (input.delegate.kind !== "agent_stack") {
    return unavailableCandidatePreparation(
      input.identity,
      "Product reference host delegate must be agent_stack",
    );
  }
  const transport: VerifiedCoffeeChatProductCandidateTransport = Object.freeze({
    kind: "coffee_chat_product" as const,
    productBoundary: verification.metadata,
    productHostPreflight: verifiedPreflight(),
    run: (request: unknown) => input.delegate.run(request),
  });
  return Object.freeze({
    state: "verified" as const,
    metadata: verification.metadata,
    capabilityContractDigest: verification.capabilityContractDigest,
    transport,
  });
}

export async function prepareCoffeeChatProductCandidateTransport(input: {
  readonly packageRoot: string;
  readonly identity: CoffeeChatProductIdentity;
  readonly delegate: CandidateTransport;
}): Promise<PreparedCoffeeChatProductCandidateTransport> {
  return prepareCandidateTransportWithVerifier(input, verifyCoffeeChatProductPackage);
}

async function prepareInteractiveTransportWithVerifier(
  input: {
    readonly packageRoot: string;
    readonly identity: CoffeeChatProductIdentity;
    readonly delegate: InteractiveAgentTransport;
  },
  verifier: typeof verifyCoffeeChatProductPackage,
): Promise<PreparedCoffeeChatProductInteractiveTransport> {
  const verification = await verifier(input);
  if (verification.state !== "verified") {
    return unavailableInteractivePreparation(input.identity, verification.reason);
  }
  if (input.delegate.kind !== "agent_stack") {
    return unavailableInteractivePreparation(
      input.identity,
      "Product reference host delegate must be agent_stack",
    );
  }
  const transport: VerifiedCoffeeChatProductInteractiveTransport = Object.freeze({
    kind: "coffee_chat_product" as const,
    productBoundary: verification.metadata,
    productHostPreflight: verifiedPreflight(),
    run: (request: unknown) => input.delegate.run(request),
    openSession: (request: unknown) => input.delegate.openSession(request),
  });
  return Object.freeze({
    state: "verified" as const,
    metadata: verification.metadata,
    capabilityContractDigest: verification.capabilityContractDigest,
    transport,
  });
}

export async function prepareCoffeeChatProductInteractiveTransport(input: {
  readonly packageRoot: string;
  readonly identity: CoffeeChatProductIdentity;
  readonly delegate: InteractiveAgentTransport;
}): Promise<PreparedCoffeeChatProductInteractiveTransport> {
  return prepareInteractiveTransportWithVerifier(input, verifyCoffeeChatProductPackage);
}

/** Internal fixture surface. Production callers must use the admitted wrappers. */
export const productHostTestOnly = Object.freeze({
  verifyPackageAgainstSuppliedIdentity,
  prepareCandidateTransport: (input: {
    readonly packageRoot: string;
    readonly identity: CoffeeChatProductIdentity;
    readonly delegate: CandidateTransport;
  }) =>
    prepareCandidateTransportWithVerifier(input, verifyPackageAgainstSuppliedIdentity),
  prepareInteractiveTransport: (input: {
    readonly packageRoot: string;
    readonly identity: CoffeeChatProductIdentity;
    readonly delegate: InteractiveAgentTransport;
  }) =>
    prepareInteractiveTransportWithVerifier(
      input,
      verifyPackageAgainstSuppliedIdentity,
    ),
});
