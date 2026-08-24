import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { EvaluationTrackId } from "./track-registry.ts";

/** Eval-owned dependency lock used by the imported Google checker. */
export const IFEVAL_RUNTIME_LOCK = fileURLToPath(
  new URL("../runtime-locks/ifeval-requirements.txt", import.meta.url),
);

/**
 * BEAM's published requirements include GPU-only wheels and unused embedding
 * stacks. This small Eval-owned lock is limited to dependencies imported by
 * the six admitted LLM-only scorers; the upstream scorer code remains exact.
 */
export const BEAM_RUNTIME_LOCK = fileURLToPath(
  new URL("../runtime-locks/beam-eval-requirements.txt", import.meta.url),
);

export function evalOwnedRuntimeLockForTrack(
  trackId: EvaluationTrackId,
): string | undefined {
  if (trackId === "ifeval") return IFEVAL_RUNTIME_LOCK;
  if (trackId === "beam-record-core") return BEAM_RUNTIME_LOCK;
  return undefined;
}

export function runtimeRootForSource(sourceRoot: string): string {
  return resolve(sourceRoot, "..", "runtime");
}

export function runtimePythonForSource(sourceRoot: string): string {
  return resolve(runtimeRootForSource(sourceRoot), "bin", "python");
}

export function requireRuntimePython(sourceRoot: string): string {
  const runtimePython = runtimePythonForSource(sourceRoot);
  if (existsSync(runtimePython)) return runtimePython;
  const error = new Error(`Python runtime is missing: ${runtimePython}`) as Error & {
    failureOwner?: "host";
  };
  error.failureOwner = "host";
  throw error;
}

export function runtimeEnvironment(sourceRoot: string): NodeJS.ProcessEnv {
  const runtimeRoot = runtimeRootForSource(sourceRoot);
  const environment: NodeJS.ProcessEnv = {};
  const inheritedNames = [
    "PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ] as const;
  for (const name of inheritedNames) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }

  return {
    ...environment,
    UV_PROJECT_ENVIRONMENT: runtimeRoot,
    NLTK_DATA: resolve(runtimeRoot, "nltk_data"),
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  };
}
