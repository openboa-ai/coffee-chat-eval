import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(process.env.CI_POLICY_ROOT ?? ".");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  try {
    return JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
  } catch (error) {
    fail(`${relativePath} must be valid JSON: ${error.message}`);
    return undefined;
  }
}

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "SECURITY.md",
  "LICENSE",
  "iterations/README.md",
  "package.json",
  "package-lock.json",
  ".github/workflows/trusted.yml",
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
]) {
  if (existsSync(resolve(root, forbidden))) fail(`${forbidden} must be absent`);
}

const packageJson = readJson("package.json");
if (
  packageJson?.name !== "coffee-chat-eval" ||
  packageJson?.version !== "0.1.0" ||
  JSON.stringify(packageJson?.scripts) !==
    JSON.stringify({ verify: "node .github/ci-policy.mjs" }) ||
  Object.keys(packageJson ?? {}).some(
    (key) => !["name", "version", "private", "description", "scripts"].includes(key),
  ) ||
  packageJson?.private !== true
) {
  fail("package.json must remain the dependency-free verification skeleton");
}

const lock = readJson("package-lock.json");
if (
  lock?.name !== "coffee-chat-eval" ||
  lock?.version !== "0.1.0" ||
  lock?.lockfileVersion !== 3 ||
  lock?.requires !== true ||
  JSON.stringify(lock?.packages) !==
    JSON.stringify({
      "": {
        name: "coffee-chat-eval",
        version: "0.1.0",
        license: "MIT",
      },
    })
) {
  fail("package-lock.json must remain dependency-free and match package.json");
}

const topLevel = readdirSync(root).sort();
const allowedTopLevel = new Set([
  ".editorconfig",
  ".gitattributes",
  ".git",
  ".github",
  ".githooks",
  ".gitignore",
  ".gitleaksignore",
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

const workflowEntries = readdirSync(resolve(root, ".github/workflows")).sort();
if (JSON.stringify(workflowEntries) !== JSON.stringify(["trusted.yml"])) {
  fail("only the trusted workflow may be present");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Coffee Chat Eval structure and policy passed.");
}
