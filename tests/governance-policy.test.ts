import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("repository governance validates least-privilege workflows and migration evidence", () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, [".github/ci-policy.mjs"], {
      cwd: new URL("..", import.meta.url),
      stdio: "pipe",
    });
  });
});

test("migration policy rejects a changed surface with no pre-PR classification", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'import { assertChangedPathsAreClassified } from "./scripts/check-migration-receipt.mjs"; assertChangedPathsAreClassified(["src/unclassified.ts"], new Set(["src/runner.ts"]));',
        ],
        { cwd: new URL("..", import.meta.url), stdio: "pipe" },
      ),
    /unclassified changed surface/u,
  );
});

test("migration policy rejects a checkout whose reviewed authority bytes changed", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'import { assertAuthorityBytesMatch } from "./scripts/check-migration-receipt.mjs"; assertAuthorityBytesMatch(new Map([["docs/migration/a.json", "reviewed"]]), new Map([["docs/migration/a.json", "rewritten"]]));',
        ],
        { cwd: new URL("..", import.meta.url), stdio: "pipe" },
      ),
    /reviewed migration authority differs/u,
  );
});

test("merge policy requires the contexts actually named by Eval workflows", () => {
  const policy = JSON.parse(
    readFileSync(new URL("../.github/merge-policy.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(policy.required_contexts, [
    "Eval / required",
    "Eval / dependency review",
    "Eval CodeQL / JavaScript-TypeScript",
  ]);
});

test("quality CI supplies a merge-base to the change-aware migration check", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/quality.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /MIGRATION_BASE_SHA:/u);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/u);
  assert.match(workflow, /github\.event\.merge_group\.base_sha/u);
  assert.match(workflow, /needs\.dependency-review\.result/u);
  assert.match(workflow, /^name: Eval$/mu);
  assert.match(workflow, /name: required/u);
  assert.match(workflow, /name: dependency review/u);
});
