import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { TextDecoder } from "node:util";

export const PCDA_RESOURCE_LIMITS = Object.freeze({
  directoryEntries: 128,
  nativeResultBytes: 2 * 1024 * 1024,
  artifactManifestBytes: 256 * 1024,
  artifactBytes: 2 * 1024 * 1024,
  verifierVerdictBytes: 64 * 1024,
  benchReportCharacters: 256 * 1024,
  signedAttestationBytes: 256 * 1024,
});

const utf8 = new TextDecoder("utf-8", { fatal: true });

export function readBoundedJson(
  path: string,
  maxBytes: number,
  label: string,
): unknown {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error(`${label} must be a regular file`);
    if (before.size > maxBytes) {
      throw new Error(`${label} exceeds its resource limit`);
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (
      offset !== bytes.length ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error(`${label} changed while it was read`);
    }
    try {
      return JSON.parse(utf8.decode(bytes)) as unknown;
    } catch {
      throw new Error(`${label} must be canonical UTF-8 JSON`);
    }
  } finally {
    closeSync(descriptor);
  }
}
