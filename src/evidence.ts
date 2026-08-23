import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface EvidenceRecord {
  readonly digest: `sha256:${string}`;
  readonly path: string;
  readonly visibility: "private" | "public";
  readonly task?: string;
  readonly trace?: string;
  readonly secret?: string;
}

function digestBytes(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function putEvidence(
  rootValue: string,
  value: string | Uint8Array,
  visibility: "private" | "public" = "private",
): EvidenceRecord {
  if (!isAbsolute(rootValue)) throw new TypeError("evidence root must be absolute");
  const root = resolve(rootValue);
  const bytes =
    typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  const digest = digestBytes(bytes);
  const directory = join(root, "sha256");
  const path = join(directory, digest.slice("sha256:".length));
  mkdirSync(directory, { recursive: true });
  if (existsSync(path)) {
    const existing = readFileSync(path);
    if (!existing.equals(bytes))
      throw new Error("content-addressed evidence path contains different bytes");
  } else {
    writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  }
  return Object.freeze({ digest, path, visibility });
}

export function redactEvidence(record: EvidenceRecord): Readonly<{
  digest: `sha256:${string}`;
  visibility: "public";
}> {
  return Object.freeze({ digest: record.digest, visibility: "public" as const });
}
