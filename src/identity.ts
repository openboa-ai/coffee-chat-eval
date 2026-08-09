import { createHash } from "node:crypto";

import type { TrialSpec } from "./types.ts";

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("expected a finite JSON number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`unsupported JSON value: ${typeof value}`);
  }
  if (ancestors.has(value)) throw new TypeError("cyclic JSON value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError("sparse arrays are not JSON values");
        entries.push(canonicalJson(value[index], ancestors));
      }
      return `[${entries.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("expected a plain JSON object");
    }
    const keys = Object.keys(value);
    if (Reflect.ownKeys(value).length !== keys.length) {
      throw new TypeError("expected enumerable string JSON keys");
    }
    const record = value as Record<string, unknown>;
    return `{${keys
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`)
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function stableDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function createTrialIdentity(trial: TrialSpec): string {
  const tuple = {
    evaluator: trial.evaluator,
    candidate: trial.candidate,
    task: trial.task,
    harness: trial.harness,
    model: trial.model,
    host: trial.host,
    repetition: trial.repetition,
  };
  return `trial-${stableDigest(tuple).slice("sha256:".length)}`;
}
