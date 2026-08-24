import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { stableDigest } from "./identity.ts";
import {
  materializeSource,
  type LicenseEvidence,
  type MaterializedSourceVerification,
} from "./source-cache.ts";
import type { SourceManifest } from "./eval-core.ts";
import type { Sha256Digest } from "./types.ts";

function fileDigest(path: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function requireAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) throw new TypeError(`${label} must be an absolute path`);
  return resolve(path);
}

function defaultLicenseEvidence(
  manifest: SourceManifest,
  sourceRoot: string,
  dataRoot: string | undefined,
): readonly LicenseEvidence[] {
  const evidence: LicenseEvidence[] = [];
  const sourceLicense = resolve(sourceRoot, "LICENSE");
  if (existsSync(sourceLicense)) {
    evidence.push({
      path: "LICENSE",
      digest: fileDigest(sourceLicense),
      license: manifest.source.license,
    });
  }
  if (manifest.data !== undefined && dataRoot !== undefined) {
    const relativePath = manifest.data.licenseEvidencePath ?? "README.md";
    const dataLicense = resolve(dataRoot, relativePath);
    if (existsSync(dataLicense)) {
      evidence.push({
        path: `data/${relativePath}`,
        digest: fileDigest(dataLicense),
        license: manifest.data.license,
      });
    }
  }
  return Object.freeze(evidence);
}

/**
 * Materialize a pinned checkout without performing network I/O. The caller
 * obtains the source through an operator-controlled fetch step, then this
 * function copies and verifies only the manifest allowlist.
 */
export function materializePinnedSource(input: {
  readonly manifest: SourceManifest;
  readonly cacheRoot: string;
  readonly sourceRoot: string;
  readonly dataRoot?: string;
  readonly runtimeLockPath?: string;
  readonly runtimeLockDigest?: Sha256Digest;
  readonly licenseEvidence?: readonly LicenseEvidence[];
}): MaterializedSourceVerification {
  const cacheRoot = requireAbsolute(input.cacheRoot, "cacheRoot");
  const sourceRoot = requireAbsolute(input.sourceRoot, "sourceRoot");
  const dataRoot =
    input.dataRoot === undefined
      ? undefined
      : requireAbsolute(input.dataRoot, "dataRoot");
  const inferredRuntimeLockPath = resolve(sourceRoot, "uv.lock");
  const inferredRequirementsPath = resolve(sourceRoot, "requirements.txt");
  const runtimeLockPath =
    input.runtimeLockPath === undefined
      ? existsSync(inferredRuntimeLockPath)
        ? inferredRuntimeLockPath
        : existsSync(inferredRequirementsPath)
          ? inferredRequirementsPath
          : undefined
      : requireAbsolute(input.runtimeLockPath, "runtimeLockPath");
  const runtimeLockDigest =
    input.runtimeLockDigest ??
    (runtimeLockPath === undefined
      ? stableDigest({
          schema: "eval-owned-runtime-lock-v1",
          trackId: input.manifest.trackId,
          sourceRevision: input.manifest.source.commit,
          ...(input.manifest.data?.revision === undefined
            ? {}
            : { dataRevision: input.manifest.data.revision }),
        })
      : fileDigest(runtimeLockPath));
  const runtimeLockOrigin: "source" | "eval-owned" =
    runtimeLockPath === undefined || !runtimeLockPath.startsWith(`${sourceRoot}/`)
      ? "eval-owned"
      : "source";
  const licenseEvidence =
    input.licenseEvidence ??
    defaultLicenseEvidence(input.manifest, sourceRoot, dataRoot);
  if (licenseEvidence.length === 0) {
    throw new TypeError("license evidence is required for materialization");
  }
  return materializeSource({
    manifest: input.manifest,
    cacheRoot,
    sourceRoot,
    ...(dataRoot === undefined ? {} : { dataRoot }),
    runtimeLockDigest,
    runtimeLockOrigin,
    ...(runtimeLockOrigin === "eval-owned" && runtimeLockPath !== undefined
      ? { expectedRuntimeLockPath: runtimeLockPath }
      : {}),
    licenseEvidence,
  });
}
