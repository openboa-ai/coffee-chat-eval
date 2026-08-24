import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { stableDigest } from "./identity.ts";
import type { Sha256Digest } from "./types.ts";
import type { SourceManifest } from "./eval-core.ts";
import { getEvaluationTrack } from "./track-registry.ts";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RECEIPT_NAME = "source-receipt.json";

export interface MaterializedFile {
  readonly path: string;
  readonly digest: Sha256Digest;
}

export interface LicenseEvidence {
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly license: string;
}

export interface MaterializedSourceReceipt {
  readonly schema: "materialized-source-v1";
  readonly trackId: SourceManifest["trackId"];
  readonly sourceManifestDigest: Sha256Digest;
  readonly sourceRevision: string;
  readonly dataRevision?: string;
  readonly licenseEvidence: readonly LicenseEvidence[];
  readonly runtimeLockDigest: Sha256Digest;
  readonly runtimeLockOrigin?: "source" | "eval-owned";
  readonly sourceRoot: string;
  readonly sourceFiles: readonly MaterializedFile[];
  readonly dataRoot?: string;
  readonly dataFiles?: readonly MaterializedFile[];
}

export interface MaterializedSourceVerification {
  readonly receiptPath: string;
  readonly sourceRoot: string;
  readonly sourceFileCount: number;
  readonly dataRoot?: string;
  readonly dataFileCount?: number;
  readonly receiptDigest: Sha256Digest;
  readonly sourceRevision: string;
  readonly dataRevision?: string;
  readonly licenseEvidence: readonly LicenseEvidence[];
  readonly runtimeLockDigest: Sha256Digest;
  readonly runtimeLockOrigin?: "source" | "eval-owned";
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
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

function relativePath(value: unknown, label: string): string {
  const path = text(value, label);
  if (isAbsolute(path) || path.split("/").includes("..")) {
    throw new TypeError(`${label} must be a relative contained path`);
  }
  return path;
}

function revision(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result) && !/^v[0-9]/u.test(result)) {
    throw new TypeError(`${label} must be an immutable revision`);
  }
  return result;
}

function parseLicenseEvidence(value: unknown): readonly LicenseEvidence[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("licenseEvidence must be a non-empty array");
  }
  const entries = value.map((item, index) => {
    const record = object(item, `licenseEvidence[${index}]`);
    const keys = Object.keys(record).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["digest", "license", "path"])) {
      throw new TypeError(`licenseEvidence[${index}] has unexpected fields`);
    }
    return Object.freeze({
      path: relativePath(record.path, `licenseEvidence[${index}].path`),
      digest: digest(record.digest, `licenseEvidence[${index}].digest`),
      license: text(record.license, `licenseEvidence[${index}].license`),
    });
  });
  const paths = new Set(entries.map((entry) => entry.path));
  if (paths.size !== entries.length)
    throw new TypeError("licenseEvidence paths must be unique");
  return Object.freeze(entries);
}

function parseFiles(value: unknown, label: string): readonly MaterializedFile[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  const files = value.map((item, index) => {
    const record = object(item, `${label}[${index}]`);
    const keys = Object.keys(record).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["digest", "path"])) {
      throw new TypeError(`${label}[${index}] has unexpected fields`);
    }
    return Object.freeze({
      path: relativePath(record.path, `${label}[${index}].path`),
      digest: digest(record.digest, `${label}[${index}].digest`),
    });
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new TypeError(`${label} paths must be unique`);
  }
  return Object.freeze(files);
}

export function parseMaterializedSourceReceipt(
  value: unknown,
): MaterializedSourceReceipt {
  const receipt = object(value, "materialized source receipt");
  const keys = Object.keys(receipt).sort();
  const required = [
    "schema",
    "licenseEvidence",
    "runtimeLockDigest",
    "sourceManifestDigest",
    "sourceRevision",
    "sourceRoot",
    "sourceFiles",
    "trackId",
  ];
  const optional = ["dataFiles", "dataRevision", "dataRoot", "runtimeLockOrigin"];
  if (
    required.some((key) => !(key in receipt)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new TypeError("materialized source receipt has unexpected fields");
  }
  if (receipt.schema !== "materialized-source-v1") {
    throw new TypeError("materialized source receipt schema is unsupported");
  }
  const runtimeLockOrigin = receipt.runtimeLockOrigin;
  if (
    runtimeLockOrigin !== undefined &&
    runtimeLockOrigin !== "source" &&
    runtimeLockOrigin !== "eval-owned"
  ) {
    throw new TypeError("runtimeLockOrigin is unsupported");
  }
  const dataRoot =
    receipt.dataRoot === undefined
      ? undefined
      : relativePath(receipt.dataRoot, "dataRoot");
  const dataFiles =
    receipt.dataFiles === undefined
      ? undefined
      : parseFiles(receipt.dataFiles, "dataFiles");
  if ((dataRoot === undefined) !== (dataFiles === undefined)) {
    throw new TypeError("dataRoot and dataFiles must be supplied together");
  }
  const dataRevision =
    receipt.dataRevision === undefined
      ? undefined
      : revision(receipt.dataRevision, "dataRevision");
  if (dataFiles !== undefined && dataRevision === undefined) {
    throw new TypeError("data materialization requires dataRevision");
  }
  const trackId = text(receipt.trackId, "trackId");
  if (getEvaluationTrack(trackId) === undefined) {
    throw new TypeError("materialized source track is unsupported");
  }
  return Object.freeze({
    schema: "materialized-source-v1" as const,
    trackId: trackId as SourceManifest["trackId"],
    sourceManifestDigest: digest(receipt.sourceManifestDigest, "sourceManifestDigest"),
    sourceRevision: revision(receipt.sourceRevision, "sourceRevision"),
    ...(dataRevision === undefined ? {} : { dataRevision }),
    licenseEvidence: parseLicenseEvidence(receipt.licenseEvidence),
    runtimeLockDigest: digest(receipt.runtimeLockDigest, "runtimeLockDigest"),
    ...(runtimeLockOrigin === undefined ? {} : { runtimeLockOrigin }),
    sourceRoot: relativePath(receipt.sourceRoot, "sourceRoot"),
    sourceFiles: parseFiles(receipt.sourceFiles, "sourceFiles"),
    ...(dataRoot === undefined ? {} : { dataRoot }),
    ...(dataFiles === undefined ? {} : { dataFiles }),
  });
}

function matches(path: string, pattern: string): boolean {
  if (pattern === path) return true;
  if (!pattern.includes("**")) return false;
  const escaped = pattern
    .split("**")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "u").test(path);
}

function admitted(path: string, manifest: SourceManifest): boolean {
  if (manifest.excludedPaths.some((pattern) => matches(path, pattern))) return false;
  return manifest.allowlist.some((pattern) => matches(path, pattern));
}

function walkFiles(
  root: string,
  prefix = "",
  skipUnadmittedSymlink?: (path: string) => boolean,
): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const relativePathValue =
      prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const fullPath = resolve(root, entry.name);
    if (entry.isSymbolicLink()) {
      if (skipUnadmittedSymlink?.(relativePathValue) === true) continue;
      throw new TypeError(
        `materialized source must not contain symlinks: ${relativePathValue}`,
      );
    }
    if (entry.isDirectory()) {
      paths.push(...walkFiles(fullPath, relativePathValue, skipUnadmittedSymlink));
    } else if (entry.isFile()) {
      paths.push(relativePathValue);
    } else {
      throw new TypeError(
        `materialized source contains unsupported entry: ${relativePathValue}`,
      );
    }
  }
  return paths;
}

function fileDigest(path: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function verifyRuntimeLockDigest(
  receipt: MaterializedSourceReceipt,
  sourceRoot: string,
  expectedRuntimeLockPath: string | undefined,
): void {
  // Upstream Python tracks expose their lock/requirements file in the
  // allowlist.  Bind the receipt to those exact bytes so a later edit cannot
  // silently reuse an otherwise valid source materialization.  Tracks with no
  // upstream lock use the Eval-owned identity recorded by the materializer.
  // When a caller supplies that admitted repository lock, bind verification
  // to its current exact bytes as well.
  if (expectedRuntimeLockPath !== undefined) {
    if (!isAbsolute(expectedRuntimeLockPath)) {
      throw new TypeError("expectedRuntimeLockPath must be an absolute path");
    }
    const lockPath = resolve(expectedRuntimeLockPath);
    const lockStat = lstatSync(lockPath);
    if (lockStat.isSymbolicLink() || !lockStat.isFile()) {
      throw new TypeError("Eval-owned runtime lock must be a regular file");
    }
    if (fileDigest(lockPath) !== receipt.runtimeLockDigest) {
      throw new TypeError("runtime lock digest drifted: Eval-owned lock");
    }
    return;
  }
  if (receipt.runtimeLockOrigin === "eval-owned") return;
  for (const name of ["uv.lock", "requirements.txt"] as const) {
    const path = resolve(sourceRoot, name);
    if (!existsSync(path)) continue;
    const actual = fileDigest(path);
    if (receipt.runtimeLockDigest !== actual) {
      throw new TypeError(`runtime lock digest drifted: ${name}`);
    }
    return;
  }
}

function verifyFileSet(
  root: string,
  files: readonly MaterializedFile[],
  manifest: SourceManifest,
  label: "source" | "data",
): void {
  const actual = walkFiles(root).sort();
  const listed = files.map((file) => file.path).sort();
  if (label === "source") {
    for (const path of actual) {
      if (!admitted(path, manifest)) {
        throw new TypeError(`materialized source path is not admitted: ${path}`);
      }
    }
  } else if (manifest.data?.allowlist !== undefined) {
    for (const path of actual) {
      if (
        manifest.excludedPaths.some((pattern) => matches(path, pattern)) ||
        !manifest.data.allowlist.some((pattern) => matches(path, pattern))
      ) {
        throw new TypeError(`materialized data path is not admitted: ${path}`);
      }
    }
  }
  if (JSON.stringify(actual) !== JSON.stringify(listed)) {
    throw new TypeError(`${label} materialization file census does not match receipt`);
  }
  for (const file of files) {
    const actualDigest = fileDigest(resolve(root, file.path));
    if (actualDigest !== file.digest) {
      throw new TypeError(`${label} file digest drifted: ${file.path}`);
    }
    if (label === "data") {
      const expectedDigest = manifest.data?.fileDigests?.[file.path];
      if (expectedDigest !== undefined && actualDigest !== expectedDigest) {
        throw new TypeError(`data file digest drifted: ${file.path}`);
      }
    }
  }
}

export function verifyMaterializedSource(input: {
  readonly manifest: SourceManifest;
  readonly cacheRoot: string;
  readonly expectedRuntimeLockPath?: string;
}): MaterializedSourceVerification {
  if (!isAbsolute(input.cacheRoot)) {
    throw new TypeError("cacheRoot must be an absolute path");
  }
  const cacheRoot = resolve(input.cacheRoot);
  const trackRoot = resolve(cacheRoot, input.manifest.trackId);
  const receiptPath = resolve(trackRoot, RECEIPT_NAME);
  const receipt = parseMaterializedSourceReceipt(
    JSON.parse(readFileSync(receiptPath, "utf8")) as unknown,
  );
  if (receipt.trackId !== input.manifest.trackId) {
    throw new TypeError("materialized source track does not match manifest");
  }
  const manifestDigest = stableDigest(input.manifest);
  if (receipt.sourceManifestDigest !== manifestDigest) {
    throw new TypeError("materialized source manifest digest does not match");
  }
  const sourceRoot = resolve(trackRoot, receipt.sourceRoot);
  if (relative(trackRoot, sourceRoot).startsWith("..")) {
    throw new TypeError("sourceRoot escapes cache root");
  }
  const sourceStat = lstatSync(sourceRoot);
  if (!sourceStat.isDirectory()) throw new TypeError("sourceRoot must be a directory");
  verifyRuntimeLockDigest(receipt, sourceRoot, input.expectedRuntimeLockPath);
  verifyFileSet(sourceRoot, receipt.sourceFiles, input.manifest, "source");
  if (input.manifest.source.licenseDigest !== undefined) {
    const license = receipt.sourceFiles.find((file) => file.path === "LICENSE");
    if (license?.digest !== input.manifest.source.licenseDigest) {
      throw new TypeError("source license digest does not match manifest");
    }
  }
  if (receipt.sourceRevision !== input.manifest.source.commit) {
    throw new TypeError("materialized source revision does not match manifest");
  }
  const sourceEvidence = receipt.licenseEvidence.find(
    (entry) =>
      entry.path === "LICENSE" && entry.digest === input.manifest.source.licenseDigest,
  );
  if (
    input.manifest.source.licenseDigest !== undefined &&
    sourceEvidence === undefined
  ) {
    throw new TypeError("source license evidence does not match manifest");
  }
  const dataRoot =
    receipt.dataRoot === undefined ? undefined : resolve(trackRoot, receipt.dataRoot);
  if (dataRoot !== undefined && relative(trackRoot, dataRoot).startsWith("..")) {
    throw new TypeError("dataRoot escapes cache root");
  }
  if (dataRoot !== undefined && receipt.dataFiles !== undefined) {
    const dataStat = lstatSync(dataRoot);
    if (!dataStat.isDirectory()) throw new TypeError("dataRoot must be a directory");
    verifyFileSet(dataRoot, receipt.dataFiles, input.manifest, "data");
    if (
      input.manifest.data?.licenseDigest !== undefined &&
      !receipt.licenseEvidence.some(
        (entry) => entry.digest === input.manifest.data!.licenseDigest,
      )
    ) {
      throw new TypeError("data license evidence does not match manifest");
    }
    if (receipt.dataRevision !== input.manifest.data?.revision) {
      throw new TypeError("materialized data revision does not match manifest");
    }
  } else if (input.manifest.data !== undefined) {
    throw new TypeError("manifest data requires a materialized data root");
  }
  return Object.freeze({
    receiptPath,
    sourceRoot,
    sourceFileCount: receipt.sourceFiles.length,
    sourceRevision: receipt.sourceRevision,
    ...(receipt.dataRevision === undefined
      ? {}
      : { dataRevision: receipt.dataRevision }),
    licenseEvidence: receipt.licenseEvidence,
    runtimeLockDigest: receipt.runtimeLockDigest,
    ...(receipt.runtimeLockOrigin === undefined
      ? {}
      : { runtimeLockOrigin: receipt.runtimeLockOrigin }),
    ...(dataRoot === undefined
      ? {}
      : { dataRoot, dataFileCount: receipt.dataFiles!.length }),
    receiptDigest: stableDigest(receipt),
  });
}

function copyTree(
  sourceRoot: string,
  targetRoot: string,
  manifest: SourceManifest,
): readonly MaterializedFile[] {
  // Operators normally provide a complete pinned checkout.  Project it onto
  // the allowlist instead of copying unrelated upstream files (including
  // explicitly excluded historical responses) into the Eval cache.
  const paths = walkFiles(sourceRoot, "", (path) => !admitted(path, manifest))
    .filter((path) => admitted(path, manifest))
    .sort();
  if (paths.length === 0) {
    throw new TypeError("source materialization allowlist selected no files");
  }
  const files: MaterializedFile[] = [];
  for (const path of paths) {
    const sourcePath = resolve(sourceRoot, path);
    const targetPath = resolve(targetRoot, path);
    mkdirSync(resolve(targetPath, ".."), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    files.push(Object.freeze({ path, digest: fileDigest(sourcePath) }));
  }
  return Object.freeze(files);
}

function copyDataTree(
  sourceRoot: string,
  targetRoot: string,
  manifest: SourceManifest,
): readonly MaterializedFile[] {
  const dataAdmitted = (path: string): boolean =>
    manifest.data?.allowlist === undefined
      ? true
      : !manifest.excludedPaths.some((pattern) => matches(path, pattern)) &&
        manifest.data.allowlist.some((pattern) => matches(path, pattern));
  const paths = walkFiles(sourceRoot, "", (path) => !dataAdmitted(path)).sort();
  if (manifest.data?.allowlist !== undefined) {
    for (const path of paths) {
      if (
        manifest.excludedPaths.some((pattern) => matches(path, pattern)) ||
        !manifest.data.allowlist.some((pattern) => matches(path, pattern))
      ) {
        throw new TypeError(`data materialization path is not admitted: ${path}`);
      }
    }
  }
  const files: MaterializedFile[] = [];
  for (const path of paths) {
    const sourcePath = resolve(sourceRoot, path);
    const targetPath = resolve(targetRoot, path);
    mkdirSync(resolve(targetPath, ".."), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    files.push(Object.freeze({ path, digest: fileDigest(sourcePath) }));
  }
  return Object.freeze(files);
}

function validateLicenseEvidence(
  evidence: readonly LicenseEvidence[],
  sourceRoot: string,
  dataRoot: string | undefined,
  manifest: SourceManifest,
): void {
  const expected = new Set<string>();
  if (manifest.source.licenseDigest !== undefined)
    expected.add(manifest.source.licenseDigest);
  if (manifest.data?.licenseDigest !== undefined)
    expected.add(manifest.data.licenseDigest);
  for (const entry of evidence) {
    const root = entry.path.startsWith("data/") ? dataRoot : sourceRoot;
    const relativeEntry = entry.path.startsWith("data/")
      ? entry.path.slice("data/".length)
      : entry.path;
    if (root === undefined)
      throw new TypeError(`license evidence path has no data root: ${entry.path}`);
    const path = resolve(root, relativeEntry);
    if (relative(root, path).startsWith(".."))
      throw new TypeError("license evidence escapes materialization");
    if (fileDigest(path) !== entry.digest)
      throw new TypeError(`license evidence digest drifted: ${entry.path}`);
  }
  for (const required of expected) {
    if (!evidence.some((entry) => entry.digest === required)) {
      throw new TypeError("license evidence is incomplete");
    }
  }
}

/**
 * Materialize an already downloaded exact checkout into the cache. This
 * function never fetches from a network: callers must provide source/data
 * directories that they own and have independently pinned.
 */
export function materializeSource(input: {
  readonly manifest: SourceManifest;
  readonly cacheRoot: string;
  readonly sourceRoot: string;
  readonly dataRoot?: string;
  readonly runtimeLockDigest: Sha256Digest;
  readonly runtimeLockOrigin?: "source" | "eval-owned";
  readonly expectedRuntimeLockPath?: string;
  readonly licenseEvidence: readonly LicenseEvidence[];
}): MaterializedSourceVerification {
  if (!isAbsolute(input.cacheRoot))
    throw new TypeError("cacheRoot must be an absolute path");
  if (!isAbsolute(input.sourceRoot))
    throw new TypeError("sourceRoot must be an absolute path");
  if (input.dataRoot !== undefined && !isAbsolute(input.dataRoot)) {
    throw new TypeError("dataRoot must be an absolute path");
  }
  digest(input.runtimeLockDigest, "runtimeLockDigest");
  const evidence = parseLicenseEvidence(input.licenseEvidence);
  const sourceStat = lstatSync(input.sourceRoot);
  if (!sourceStat.isDirectory()) throw new TypeError("sourceRoot must be a directory");
  if (input.manifest.data !== undefined && input.dataRoot === undefined) {
    throw new TypeError("manifest data requires dataRoot");
  }
  const cacheRoot = resolve(input.cacheRoot);
  const trackRoot = resolve(cacheRoot, input.manifest.trackId);
  const sourceTarget = resolve(trackRoot, "source");
  mkdirSync(sourceTarget, { recursive: true });
  const sourceFiles = copyTree(input.sourceRoot, sourceTarget, input.manifest);
  const dataTarget =
    input.dataRoot === undefined ? undefined : resolve(trackRoot, "data");
  const dataFiles =
    input.dataRoot === undefined
      ? undefined
      : (() => {
          const stat = lstatSync(input.dataRoot!);
          if (!stat.isDirectory()) throw new TypeError("dataRoot must be a directory");
          mkdirSync(dataTarget!, { recursive: true });
          return copyDataTree(input.dataRoot!, dataTarget!, input.manifest);
        })();
  validateLicenseEvidence(evidence, sourceTarget, dataTarget, input.manifest);
  const receipt: MaterializedSourceReceipt = Object.freeze({
    schema: "materialized-source-v1",
    trackId: input.manifest.trackId,
    sourceManifestDigest: stableDigest(input.manifest),
    sourceRevision: input.manifest.source.commit,
    ...(input.manifest.data === undefined
      ? {}
      : { dataRevision: input.manifest.data.revision }),
    licenseEvidence: evidence,
    runtimeLockDigest: input.runtimeLockDigest,
    ...(input.runtimeLockOrigin === undefined
      ? {}
      : { runtimeLockOrigin: input.runtimeLockOrigin }),
    sourceRoot: "source",
    sourceFiles,
    ...(dataFiles === undefined ? {} : { dataRoot: "data", dataFiles }),
  });
  const receiptPath = resolve(trackRoot, RECEIPT_NAME);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  try {
    writeFileSync(receiptPath, serialized, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
      throw error;
    if (readFileSync(receiptPath, "utf8") !== serialized) {
      throw new TypeError(
        "materialized source receipt already contains different bytes",
      );
    }
  }
  return verifyMaterializedSource({
    manifest: input.manifest,
    cacheRoot,
    ...(input.expectedRuntimeLockPath === undefined
      ? {}
      : { expectedRuntimeLockPath: input.expectedRuntimeLockPath }),
  });
}
