import { createHash } from "node:crypto";

import type { TrialSpec } from "./types.ts";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function stableDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function createTrialIdentity(trial: TrialSpec): string {
  const tuple = {
    candidate: trial.candidate,
    task: trial.task,
    harness: trial.harness,
    model: trial.model,
    host: trial.host,
    repetition: trial.repetition,
  };
  return `trial-${stableDigest(tuple).slice("sha256:".length)}`;
}
