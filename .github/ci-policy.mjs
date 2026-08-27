import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
const root = resolve(process.env.CI_POLICY_ROOT ?? ".");
const failures = [];
const TRUSTED_CONTROL_SHA = "f33da6bbcdfebd0693ff7673d750f369629e000e";

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

function equal(actual, expected) {
  return isDeepStrictEqual(actual, expected);
}

const requiredFiles = [
  "README.md",
  "AGENTS.md",
  "SECURITY.md",
  "LICENSE",
  "iterations/README.md",
  "package.json",
  "package-lock.json",
  ".github/merge-policy.json",
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
  ".gitleaksignore",
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

if (!equal(readdirSync(resolve(root, "iterations")).sort(), ["README.md"])) {
  fail("iterations must contain only README.md until execution evidence exists");
}

const workflowEntries = readdirSync(resolve(root, ".github/workflows")).sort();
if (JSON.stringify(workflowEntries) !== JSON.stringify(["trusted.yml"])) {
  fail("only the trusted workflow may be present");
}

const githubEntries = readdirSync(resolve(root, ".github")).sort();
if (
  JSON.stringify(githubEntries) !==
  JSON.stringify([
    "CODEOWNERS",
    "PULL_REQUEST_TEMPLATE.md",
    "ci-policy.mjs",
    "dependabot.yml",
    "merge-policy.json",
    "workflows",
  ])
) {
  fail(".github must contain only the declared policy and workflow files");
}

const trustedWorkflowPath = resolve(root, ".github/workflows/trusted.yml");
if (existsSync(trustedWorkflowPath)) {
  const expectedTrustedWorkflow = `name: OpenBoa Coffee trusted gate

on:
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review]

permissions: {}

jobs:
  trusted:
    name: OpenBoa Coffee trusted required
    permissions:
      actions: read
      contents: read
      security-events: write
    uses: openboa-ai/.github/.github/workflows/coffee-trusted-gate.yml@${TRUSTED_CONTROL_SHA}
    with:
      control_sha: ${TRUSTED_CONTROL_SHA}
`;
  if (readFileSync(trustedWorkflowPath, "utf8") !== expectedTrustedWorkflow) {
    fail("trusted wrapper must remain exact");
  }
}

if (
  !equal(readJson(".github/merge-policy.json"), {
    schema: "coffee-chat/merge-policy",
    auto_merge: {
      provider: "github-native",
      required_checks: true,
      verified_members_only: true,
    },
    merge_method: "squash",
    merge_queue: false,
    required_events: ["pull_request"],
    required_approvals: 0,
    review_policy: {
      default_required_approvals: 0,
      sensitive_paths_use_protected_environment: true,
    },
    eligible_author_associations: ["OWNER", "MEMBER"],
    eligible_bot_logins: ["dependabot[bot]"],
    protected_paths: [
      ".github/**",
      ".githooks/**",
      ".gitleaksignore",
      ".gitleaks.toml",
      "AGENTS.md",
      "CODEOWNERS",
      "SECURITY.md",
      "iterations/**",
      ".npmrc",
      "npm-shrinkwrap.json",
      "package-lock.json",
      "package.json",
    ],
    required_checks: [
      {
        context: "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required",
        integration_id: 15368,
      },
    ],
    sensitive_review: {
      enforcement: "github_environment",
      environment: "coffee-security",
      required_approvals: 1,
      prevent_self_review: false,
    },
  })
) {
  fail("merge policy must preserve the exact GitHub-native and sensitive-review contract");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Coffee Chat Eval structure and policy passed.");
}
