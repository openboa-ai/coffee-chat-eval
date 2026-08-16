import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPolicyParser } from "./policy-bootstrap.mjs";

const controlRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(process.env.EVAL_CI_POLICY_ROOT ?? controlRoot);
const { parseDocument } = loadPolicyParser(controlRoot);
const workflowRoot = resolve(root, ".github/workflows");
const TRUSTED_CONTROL_SHA = "f2e0db9ee5fc67c63fe789d0e80bb3061436bc6c";
const failures = [];
if (existsSync(resolve(root, ".npmrc"))) {
  failures.push("root .npmrc must be absent");
}
if (existsSync(resolve(root, ".github/policy-parser/.npmrc"))) {
  failures.push("isolated policy parser .npmrc must be absent before install");
}
const harborRequirementsPath = resolve(root, ".github/harbor-requirements.txt");
if (
  !existsSync(harborRequirementsPath) ||
  createHash("sha256").update(readFileSync(harborRequirementsPath)).digest("hex") !==
    "d4f01211a1c9013fe0ed3c49f471dac24356859312d7fcd6d0fdc00c51809dd6"
) {
  failures.push(
    "Harbor dependency graph must retain its exact authenticated hash lock",
  );
}
if (
  !existsSync(resolve(root, ".github/harbor-requirements.in")) ||
  readFileSync(resolve(root, ".github/harbor-requirements.in"), "utf8") !==
    "harbor==0.21.0\n"
) {
  failures.push("Harbor root requirement must remain exactly pinned");
}
if (existsSync(resolve(root, "npm-shrinkwrap.json"))) {
  failures.push("root npm-shrinkwrap.json must be absent");
}
if (existsSync(resolve(root, ".github/policy-parser/npm-shrinkwrap.json"))) {
  failures.push(
    "isolated policy parser npm-shrinkwrap.json must be absent before loading",
  );
}
const expectedPackageScripts = {
  "bench:oracle": "node --experimental-strip-types src/cli.ts oracle-control",
  build: "tsc --noEmit",
  "ci:policy":
    "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs",
  "dry-run": "node --experimental-strip-types src/cli.ts dry-run",
  format: "prettier --write .",
  "format:check": "prettier --check .",
  "hooks:install": "git config core.hooksPath .githooks",
  "security:scan": "gitleaks git --redact --no-banner .",
  smoke: "node --experimental-strip-types --test tests/smoke.test.ts",
  test: "node --experimental-strip-types --test tests/*.test.*",
  typecheck: "tsc --noEmit",
};
function fail(message) {
  failures.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

function packageNameFromLockPath(path) {
  const marker = "node_modules/";
  const index = path.lastIndexOf(marker);
  return index === -1 ? null : path.slice(index + marker.length);
}

function expectedRegistryUrl(name, version) {
  const tarballName = name.slice(name.lastIndexOf("/") + 1);
  return `https://registry.npmjs.org/${name}/-/${tarballName}-${version}.tgz`;
}

function validatePackageLock(packageJson, allowedDevDependencies) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  } catch (error) {
    fail(
      `package lock must parse: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return;
  }
  const rootPackage = lock?.packages?.[""];
  const devDependencies = packageJson.devDependencies ?? {};
  if (
    lock.lockfileVersion !== 3 ||
    lock.requires !== true ||
    lock.name !== packageJson.name ||
    lock.version !== packageJson.version ||
    !isRecord(lock.packages) ||
    !isRecord(rootPackage) ||
    rootPackage.name !== packageJson.name ||
    rootPackage.version !== packageJson.version ||
    !equal(rootPackage.devDependencies ?? {}, devDependencies) ||
    !equal(rootPackage.dependencies ?? {}, packageJson.dependencies ?? {}) ||
    !equal(Object.keys(devDependencies).sort(), [...allowedDevDependencies].sort()) ||
    !Object.values(devDependencies).every(
      (version) => typeof version === "string" && EXACT_VERSION.test(version),
    )
  ) {
    fail("package lock must match the approved dependency contract");
    return;
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "") continue;
    const name = packageNameFromLockPath(path);
    if (
      name === null ||
      !isRecord(entry) ||
      typeof entry.version !== "string" ||
      !EXACT_VERSION.test(entry.version) ||
      entry.resolved !== expectedRegistryUrl(name, entry.version) ||
      typeof entry.integrity !== "string" ||
      !SHA512_INTEGRITY.test(entry.integrity) ||
      entry.link === true ||
      entry.hasInstallScript === true
    ) {
      fail("package lock must preserve registry identity and integrity");
      return;
    }
  }
}

function equal(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && equal(Object.keys(value).sort(), [...keys].sort());
}

const YAML_MAX_BYTES = 256 * 1024;
const YAML_MAX_ALIASES = 100;
const YAML_MAX_DEPTH = 32;
const YAML_MAX_NODES = 10_000;
const YAML_MAX_STRING_BYTES = 256 * 1024;

function assertYamlResourceBudget(value, label) {
  const pending = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  let stringBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    nodes += 1;
    if (nodes > YAML_MAX_NODES) {
      fail(`${label}: document node limit exceeded`);
      return false;
    }
    if (current.depth > YAML_MAX_DEPTH) {
      fail(`${label}: document depth limit exceeded`);
      return false;
    }
    if (typeof current.value === "string") {
      stringBytes += Buffer.byteLength(current.value, "utf8");
      if (stringBytes > YAML_MAX_STRING_BYTES) {
        fail(`${label}: document string limit exceeded`);
        return false;
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    const children = Array.isArray(current.value)
      ? current.value
      : Object.entries(current.value).flat();
    for (const child of children) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function parseBoundedYaml(relativePath, label) {
  const source = readFileSync(resolve(root, relativePath), "utf8");
  if (Buffer.byteLength(source, "utf8") > YAML_MAX_BYTES) {
    fail(`${label}: document byte limit exceeded`);
    return undefined;
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    fail(`${label}: must parse uniquely`);
    return undefined;
  }
  let value;
  try {
    value = document.toJS({ maxAliasCount: YAML_MAX_ALIASES });
  } catch {
    fail(`${label}: alias resource limit exceeded`);
    return undefined;
  }
  return assertYamlResourceBudget(value, label) ? value : undefined;
}

function validateDependabot() {
  const config = parseBoundedYaml(".github/dependabot.yml", "dependabot.yml");
  const updates = config?.updates;
  if (!Array.isArray(updates) || updates.length !== 2) {
    fail("dependabot.yml: exact update lanes");
    return;
  }
  const npm = updates.find((item) => item?.["package-ecosystem"] === "npm");
  const actions = updates.find(
    (item) => item?.["package-ecosystem"] === "github-actions",
  );
  const compatibleVersionUpdates = [
    {
      "dependency-name": "*",
      "update-types": ["version-update:semver-minor", "version-update:semver-patch"],
    },
  ];
  if (
    !isRecord(npm) ||
    !equal(npm.groups?.security, {
      "applies-to": "security-updates",
      patterns: ["*"],
    }) ||
    !equal(npm.groups?.production, {
      "applies-to": "version-updates",
      "dependency-type": "production",
      "update-types": ["minor", "patch"],
    }) ||
    !equal(npm.groups?.development, {
      "applies-to": "version-updates",
      "dependency-type": "development",
      "update-types": ["minor", "patch"],
    }) ||
    !equal(npm.allow, compatibleVersionUpdates) ||
    Object.hasOwn(npm, "ignore")
  ) {
    fail("dependabot.yml: npm security, compatible version, and major policy");
  }
  if (
    !isRecord(actions) ||
    !equal(actions.groups?.security, {
      "applies-to": "security-updates",
      patterns: ["*"],
    }) ||
    !equal(actions.groups?.versions, {
      "applies-to": "version-updates",
      "update-types": ["minor", "patch"],
      patterns: ["*"],
    }) ||
    !equal(actions.allow, compatibleVersionUpdates) ||
    Object.hasOwn(actions, "ignore")
  ) {
    fail("dependabot.yml: Actions security, compatible version, and major policy");
  }
}

function validateMergePolicy() {
  const policy = JSON.parse(
    readFileSync(resolve(root, ".github/merge-policy.json"), "utf8"),
  );
  if (
    policy.merge_method !== "squash" ||
    policy.auto_merge?.provider !== "github-native" ||
    policy.auto_merge.required_checks !== true ||
    policy.merge_queue !== false ||
    !equal(policy.required_events, ["pull_request"]) ||
    policy.required_approvals !== 0 ||
    !equal(policy.eligible_author_associations, ["OWNER", "MEMBER"]) ||
    !equal(policy.eligible_bot_logins, ["dependabot[bot]"]) ||
    policy.review_policy?.default_required_approvals !== 0 ||
    policy.review_policy?.sensitive_paths_use_protected_environment !== true
  ) {
    fail("merge policy must be GitHub-native selective-review squash");
  }
  if (
    !equal(policy.required_checks, [
      {
        context: "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required",
        integration_id: 15368,
      },
    ])
  ) {
    fail("merge policy must retain exact required checks");
  }
  if (
    !equal(policy.sensitive_review, {
      enforcement: "github_environment",
      environment: "coffee-security",
      required_approvals: 1,
      prevent_self_review: false,
    })
  ) {
    fail("merge policy must retain the protected Environment review");
  }
  if (
    !equal(policy.protected_paths, [
      ".github/**",
      ".githooks/**",
      ".gitleaksignore",
      ".gitleaks.toml",
      "AGENTS.md",
      "CODEOWNERS",
      "SECURITY.md",
      ".npmrc",
      "npm-shrinkwrap.json",
      "package-lock.json",
      "package.json",
      "src/bench.ts",
      "src/cli.ts",
      "src/harbor.ts",
      "src/resources.ts",
      "src/registry.ts",
      "src/runner.ts",
    ])
  ) {
    fail("merge policy must retain exact protected paths");
  }
}

const discovered = readdirSync(workflowRoot)
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort();
if (!equal(discovered, ["trusted.yml"])) {
  fail("target repository must expose only the trusted wrapper");
}

const trustedWorkflowSource = readFileSync(
  resolve(workflowRoot, "trusted.yml"),
  "utf8",
);
const trustedControlSha = trustedWorkflowSource.match(
  /uses: openboa-ai\/\.github\/\.github\/workflows\/coffee-trusted-gate\.yml@([0-9a-f]{40})/u,
)?.[1];
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
if (
  trustedControlSha !== TRUSTED_CONTROL_SHA ||
  trustedWorkflowSource !== expectedTrustedWorkflow
) {
  fail("trusted wrapper must remain exact");
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (
  packageJson.scripts?.["ci:policy"] !==
  "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs"
) {
  fail("package command must run fixtures before the checker");
}
if (
  !equal(
    Object.entries(packageJson.scripts ?? {}).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    Object.entries(expectedPackageScripts).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
) {
  fail("package scripts must remain exact");
}
if (
  !hasExactKeys(packageJson, [
    "name",
    "private",
    "version",
    "type",
    "engines",
    "scripts",
    "devDependencies",
  ]) ||
  packageJson.name !== "@openboa-ai/coffee-chat-eval" ||
  packageJson.private !== true ||
  packageJson.version !== "2026.8.12" ||
  packageJson.type !== "module" ||
  !equal(packageJson.engines, { node: ">=24" })
) {
  fail("package metadata must remain exact");
}
if (
  Object.values(packageJson.scripts ?? {}).some((script) =>
    /OPENAI_API_KEY/u.test(script),
  )
)
  fail("candidate execution scripts must not receive provider credentials");
if (Object.hasOwn(packageJson.dependencies ?? {}, "@openboa/coffee-chat")) {
  fail("the evaluator must not depend on private Coffee Chat source");
}
validatePackageLock(packageJson, ["@types/node", "prettier", "typescript"]);
const uvRequirement = readFileSync(
  resolve(root, ".github/uv-requirements.txt"),
  "utf8",
);
const approvedUvRequirement = [
  "uv==0.12.3 \\",
  "    --hash=sha256:1482d1462b1aecd18ee33627363fe1c63d6a194f12d40d37efc446d9e0d800a1",
  "",
].join("\n");
if (uvRequirement !== approvedUvRequirement) {
  fail("uv requirement must use the approved PyPI wheel hash");
}
validateDependabot();
validateMergePolicy();

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("CI policy passed\n");
}
