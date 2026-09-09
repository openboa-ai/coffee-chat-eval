import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(process.env.CI_POLICY_ROOT ?? ".");
const failures = [];

function fail(message) {
  failures.push(message);
}

const trackedFiles = execFileSync("git", ["-C", root, "ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
// Compare complete paths: a same-named directory is not an allowed file.
// This is the published repository layout, not central security policy.
assert.deepEqual(trackedFiles.slice().sort(), [
  ".editorconfig",
  ".gitattributes",
  ".githooks/pre-commit",
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/merge-policy.json",
  ".github/verify.mjs",
  ".github/verify.test.mjs",
  ".github/workflows/trusted.yml",
  ".gitignore",
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "iterations/README.md",
  "package-lock.json",
  "package.json"
], "unexpected or missing repository file");
for (const path of trackedFiles) {
  assert.equal(lstatSync(resolve(root, path)).isFile(), true, `${path}: regular file required`);
}

for (const forbidden of [
  ".npmrc",
  "npm-shrinkwrap.json",
  "src",
  "tests",
  "integrations",
  "reports",
  "runtime-locks",
  "docs",
  "PLAN.md",
  "harbor-requirements.in",
  "harbor-requirements.txt",
  "uv-requirements.txt",
  ".gitleaksignore",
]) {
  if (existsSync(resolve(root, forbidden))) fail(`${forbidden} must be absent`);
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Coffee Chat Eval structure verification passed.");
}
