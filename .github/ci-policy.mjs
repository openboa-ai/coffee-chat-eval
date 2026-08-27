import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
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

const trackedFiles = execFileSync("git", ["-C", root, "ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
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
  packageJson?.license !== "MIT" ||
  JSON.stringify(packageJson?.scripts) !==
    JSON.stringify({
      "hooks:install": "git config core.hooksPath .githooks",
      verify: "node .github/ci-policy.mjs",
    }) ||
  Object.keys(packageJson ?? {}).some(
    (key) =>
      !["name", "version", "private", "license", "description", "scripts"].includes(key),
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

const workflowEntries = trackedEntries(".github/workflows");
if (JSON.stringify(workflowEntries) !== JSON.stringify(["trusted.yml"])) {
  fail("only the trusted workflow may be present");
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

const githubEntries = trackedEntries(".github");
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

if (JSON.stringify(trackedEntries(".githooks")) !== JSON.stringify(["pre-commit"])) {
  fail(".githooks must contain only the declared executable hook");
}
const expectedHook = [
  "#!/bin/sh",
  "set -eu",
  "",
  "scanner=${GITLEAKS_BIN:-gitleaks}",
  'if ! command -v "$scanner" >/dev/null 2>&1; then',
  "  printf '%s\\n' 'Gitleaks is required; install Gitleaks before committing.' >&2",
  "  exit 1",
  "fi",
  "",
  "if [ -e .gitleaks.toml ] || [ -e .gitleaksignore ]; then",
  "  printf '%s\\n' 'Repository-local Gitleaks controls are not permitted.' >&2",
  "  exit 1",
  "fi",
  "unset GITLEAKS_CONFIG GITLEAKS_CONFIG_TOML",
  '"$scanner" git --pre-commit --staged --gitleaks-ignore-path /dev/null \\',
  "  --ignore-gitleaks-allow --redact --no-banner .",
  'staged_dir="$(mktemp -d)"',
  `trap 'rm -rf "$staged_dir"' EXIT HUP INT TERM`,
  'git checkout-index --all --prefix="$staged_dir/"',
  '"$scanner" dir --gitleaks-ignore-path /dev/null --ignore-gitleaks-allow \\',
  '  --redact --no-banner "$staged_dir"',
  "",
].join("\n");
const hookPath = resolve(root, ".githooks/pre-commit");
if (readFileSync(hookPath, "utf8") !== expectedHook) {
  fail(".githooks/pre-commit must remain the exact Gitleaks hook");
}
if ((statSync(hookPath).mode & 0o111) === 0) {
  fail(".githooks/pre-commit must remain executable");
}

if (
  readFileSync(resolve(root, ".gitignore"), "utf8") !==
  `artifacts/
node_modules/
__pycache__/
coverage/
dist/

# Local credentials
.env
.env.*
!.env.example
credentials.json
secrets.json
*.private.pem
private-key.pem
*.private.key
private.key
private-key.key
id_rsa
id_dsa
id_ecdsa
id_ed25519
tls.key
server.key
server-key.pem
*-private-key.pem
*-private-key.key
privkey*.pem
*.p12
*.pfx
*.jks
`
) {
  fail(".gitignore must preserve the credential and local-artifact ignore contract");
}

if (
  readFileSync(resolve(root, ".github/dependabot.yml"), "utf8") !==
  `version: 2

updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    commit-message:
      prefix: deps
    allow:
      - dependency-name: "*"
        update-types:
          - version-update:semver-minor
          - version-update:semver-patch
    groups:
      security:
        applies-to: security-updates
        patterns:
          - "*"
      production:
        applies-to: version-updates
        dependency-type: production
        update-types: [minor, patch]
      development:
        applies-to: version-updates
        dependency-type: development
        update-types: [minor, patch]
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
    open-pull-requests-limit: 5
    commit-message:
      prefix: deps
    allow:
      - dependency-name: "*"
        update-types:
          - version-update:semver-minor
          - version-update:semver-patch
    groups:
      security:
        applies-to: security-updates
        patterns:
          - "*"
      versions:
        applies-to: version-updates
        update-types: [minor, patch]
        patterns:
          - "*"
`
) {
  fail("Dependabot policy must remain bounded to approved update lanes");
}
if (
  readFileSync(resolve(root, ".github/CODEOWNERS"), "utf8") !==
  `/AGENTS.md @openboa
/LICENSE @openboa
/README.md @openboa
/SECURITY.md @openboa-ai/security-maintainers
/.github/ @openboa
/.githooks/ @openboa-ai/security-maintainers
/iterations/ @openboa
/package.json @openboa
/package-lock.json @openboa
`
) {
  fail("CODEOWNERS must preserve the eval ownership routes");
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
      "README.md",
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
