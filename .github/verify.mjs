import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
const root = resolve(process.env.CI_POLICY_ROOT ?? ".");
const failures = [];

function fail(message) {
  failures.push(message);
}

function equal(actual, expected) {
  return isDeepStrictEqual(actual, expected);
}

const trackedFiles = execFileSync("git", ["-C", root, "ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
// Infrastructure directories are not an escape hatch for Product/data artifacts.
// Central controls validate security semantics; this repository owns its layout.
assert.deepEqual(
  trackedFiles.filter((path) => path.startsWith(".github/") || path.startsWith(".githooks/")).sort(),
  [
    ".githooks/pre-commit",
    ".github/CODEOWNERS",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/dependabot.yml",
    ".github/merge-policy.json",
    ".github/verify.mjs",
    ".github/verify.test.mjs",
    ".github/workflows/trusted.yml",
  ],
  "unexpected or missing infrastructure file",
);

function trackedEntries(directory = ".") {
  const prefix = directory === "." ? "" : `${directory.replace(/\/$/u, "")}/`;
  const entries = new Set();
  for (const file of trackedFiles) {
    if (!file.startsWith(prefix)) continue;
    const remainder = file.slice(prefix.length);
    if (!remainder) continue;
    entries.add(remainder.split("/")[0]);
  }
  return [...entries].sort();
}
function checkoutEntries(directory = ".") {
  const entries = trackedEntries(directory);
  if (directory === ".") entries.push(".git");
  return entries.sort();
}

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "SECURITY.md",
  "LICENSE",
  ".gitignore",
  ".githooks/pre-commit",
  "iterations/README.md",
  "package.json",
  "package-lock.json",
];
for (const relativePath of requiredFiles) {
  if (!existsSync(resolve(root, relativePath))) fail(`${relativePath} is required`);
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

const topLevel = checkoutEntries();
const allowedTopLevel = new Set([
  ".editorconfig",
  ".gitattributes",
  ".git",
  ".github",
  ".githooks",
  ".gitignore",
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "iterations",
  "package-lock.json",
  "package.json",
]);
for (const entry of topLevel) {
  if (!allowedTopLevel.has(entry)) fail(`unexpected top-level entry: ${entry}`);
}

if (!equal(trackedEntries("iterations"), ["README.md"])) {
  fail("iterations must contain only README.md until execution evidence exists");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Coffee Chat Eval structure verification passed.");
}
