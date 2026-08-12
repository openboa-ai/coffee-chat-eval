import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const workflows = [
  ".github/workflows/quality.yml",
  ".github/workflows/policy.yml",
  ".github/workflows/codeql.yml",
];
const pinnedAction = /uses:\s+[\w/-]+@[0-9a-f]{40}\b/u;

function assertCheckoutCredentialsDisabled(workflow, source) {
  const checkoutSteps =
    source.match(/uses: actions\/checkout@[\s\S]*?persist-credentials: false/gmu) ?? [];
  const checkoutCount = source.match(/uses: actions\/checkout@/gu)?.length ?? 0;
  if (
    checkoutSteps.length !== checkoutCount ||
    source.includes("persist-credentials: true")
  ) {
    throw new Error(`${workflow} checkout must disable persisted credentials`);
  }
}

function assertTrustedAuthorGateBeforeCheckout(workflow, source) {
  for (const required of [
    "name: Verify trusted pull request author",
    "github.event.pull_request.author_association",
    "OWNER|MEMBER",
    "author=untrusted",
  ]) {
    if (!source.includes(required)) throw new Error(`${workflow} lacks ${required}`);
  }
  if (source.includes("COLLABORATOR") || source.includes("pull_request.user.login")) {
    throw new Error(`${workflow} has unsupported author authority`);
  }
  if (
    source.indexOf("name: Verify trusted pull request author") >
    source.indexOf("uses: actions/checkout@")
  ) {
    throw new Error(`${workflow} checks out before author eligibility`);
  }
}

for (const workflow of workflows) {
  const source = await readFile(new URL(workflow, root), "utf8");
  if (!source.includes("pull_request:") || !source.includes("merge_group:")) {
    throw new Error(`${workflow} must run for pull_request and merge_group`);
  }
  if (
    source.includes("pull_request_target") ||
    ![...source.matchAll(/uses:.*$/gmu)].every(([line]) => pinnedAction.test(line))
  ) {
    throw new Error(`${workflow} has an unsafe trigger or unpinned action`);
  }
  assertCheckoutCredentialsDisabled(workflow, source);
}

const quality = await readFile(new URL(".github/workflows/quality.yml", root), "utf8");
assertTrustedAuthorGateBeforeCheckout("quality workflow", quality);
for (const required of [
  "name: dependency review",
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  "name: aggregate",
  "if: always()",
  "npm run format:check",
  "npm run typecheck",
  "npm run build",
  "npm test",
  "npm run canary:check",
  "npm run dry-run",
  "npm run smoke",
  "npm run ci:policy",
]) {
  if (!quality.includes(required))
    throw new Error(`quality workflow lacks ${required}`);
}
for (const required of [
  "name: harbor contract",
  "python -m pip install --disable-pip-version-check uv==0.8.3",
  "npm run canary:calibrate",
  "npm run benchmark:calibrate",
  "needs: [quality, dependency-review, harbor-contract]",
]) {
  if (!quality.includes(required))
    throw new Error(`quality workflow lacks ${required}`);
}

const policy = await readFile(new URL(".github/workflows/policy.yml", root), "utf8");
assertTrustedAuthorGateBeforeCheckout("policy workflow", policy);

const codeql = await readFile(new URL(".github/workflows/codeql.yml", root), "utf8");
for (const permission of [
  "contents: read",
  "actions: read",
  "security-events: write",
]) {
  if (!codeql.includes(permission))
    throw new Error(`CodeQL must declare ${permission}`);
}

const boundary = await readFile(
  new URL(".github/workflows/secret-boundary.yml", root),
  "utf8",
);
for (const required of [
  "pull_request_target:",
  "contents: read",
  "path: trusted",
  "path: candidate",
  "cmp trusted/.gitleaksignore candidate/.gitleaksignore",
  "gitleaks git",
  "gitleaks dir",
]) {
  if (!boundary.includes(required))
    throw new Error(`secret boundary lacks ${required}`);
}
if (
  boundary.includes("npm ") ||
  boundary.includes("node ") ||
  boundary.includes("secrets.")
) {
  throw new Error("secret boundary must treat the candidate only as data");
}
const mergePolicy = JSON.parse(
  await readFile(new URL(".github/merge-policy.json", root), "utf8"),
);
if (
  JSON.stringify(mergePolicy.eligible_author_associations) !==
    JSON.stringify(["OWNER", "MEMBER"]) ||
  mergePolicy.merge_method !== "squash" ||
  mergePolicy.required_approvals !== 0 ||
  mergePolicy.auto_merge?.required_checks !== true
) {
  throw new Error(
    "merge policy must require OWNER|MEMBER, squash, checks, and zero approvals",
  );
}
if (!mergePolicy.required_contexts?.includes("Secret boundary / Secret boundary")) {
  throw new Error("merge policy must require the trusted secret boundary");
}

const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
for (const script of [
  "format:check",
  "typecheck",
  "build",
  "test",
  "canary:check",
  "canary:calibrate",
  "benchmark:calibrate",
  "dry-run",
  "smoke",
  "ci:policy",
]) {
  if (typeof packageJson.scripts?.[script] !== "string")
    throw new Error(`missing ${script} script`);
}
if (Object.hasOwn(packageJson.dependencies ?? {}, "@openboa/coffee-chat")) {
  throw new Error("the evaluator must not depend on private Coffee Chat source");
}
