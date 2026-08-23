import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { putEvidence, redactEvidence, type EvidenceRecord } from "../src/evidence.ts";

test("evidence vault stores content-addressed private bytes append-only", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-evidence-"));
  try {
    const first = putEvidence(root, "private trace with candidate prose", "private");
    const second = putEvidence(root, "private trace with candidate prose", "private");
    assert.equal(first.digest, second.digest);
    assert.equal(first.path, second.path);
    assert.equal(
      readFileSync(first.path, "utf8"),
      "private trace with candidate prose",
    );
    assert.equal(first.visibility, "private");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("public evidence redaction retains hashes and drops raw task, trace, and secret fields", () => {
  const record: EvidenceRecord = {
    digest: ("sha256:" + "a".repeat(64)) as `sha256:${string}`,
    path: "/private/evidence/sha256-a",
    visibility: "private",
    task: "raw task",
    trace: "raw tool trace",
    secret: "raw secret",
  };
  const publicRecord = redactEvidence(record);
  assert.deepEqual(publicRecord, {
    digest: record.digest,
    visibility: "public",
  });
  assert.doesNotMatch(JSON.stringify(publicRecord), /raw (?:task|tool trace|secret)/u);
});
