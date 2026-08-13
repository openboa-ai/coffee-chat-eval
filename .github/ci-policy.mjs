import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const root = resolve(
  process.env.EVAL_CI_POLICY_ROOT ??
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const workflowRoot = resolve(root, ".github/workflows");
const failures = [];
const workflowNames = ["codeql.yml", "quality.yml", "secret-boundary.yml"];
const pinnedActions = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3",
  "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3",
]);
const qualityCommands = [
  "npm run format:check",
  "npm run typecheck",
  "npm run build",
  "npm test",
  "npm run canary:check",
  "npm run dry-run",
  "npm run smoke",
  "npm run ci:policy",
];
const calibrationCommands = [
  "npm run canary:calibrate",
  "npm run benchmark:calibrate",
  "npm run pcda:calibrate",
];
const authorEligibilityGate = `case "$EVENT_NAME" in
  merge_group) exit 0 ;;
  pull_request)
    case "$AUTHOR_ASSOCIATION" in OWNER|MEMBER) exit 0 ;; esac
    test "$PR_AUTHOR" = "dependabot[bot]"
    ;;
  *) exit 1 ;;
esac
`;

function fail(message) {
  failures.push(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function equal(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && equal(Object.keys(value).sort(), [...keys].sort());
}

function getSteps(job) {
  return Array.isArray(job?.steps) ? job.steps : [];
}

function indexOfRun(steps, command) {
  return steps.findIndex((step) => isRecord(step) && step.run === command);
}

function collectUses(value, result = [], seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectUses(item, result, seen);
    return result;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "uses") result.push(item);
    collectUses(item, result, seen);
  }
  return result;
}

function collectStrings(value, result = [], seen = new WeakSet()) {
  if (typeof value === "string") {
    result.push(value);
    return result;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return result;
  seen.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    collectStrings(item, result, seen);
  }
  return result;
}

function parseYaml(relativePath, label) {
  const source = readFileSync(resolve(root, relativePath), "utf8");
  if (Buffer.byteLength(source, "utf8") > 256 * 1024) {
    fail(`${label}: document resource limit`);
    return undefined;
  }
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length > 0) {
    fail(`${label}: workflow must parse uniquely`);
    return undefined;
  }
  try {
    return document.toJS({ maxAliasCount: 100 });
  } catch {
    fail(`${label}: aliases exceed their resource limit`);
    return undefined;
  }
}

function validateConcurrency(name, workflow) {
  if (
    !hasExactKeys(workflow.concurrency, ["group", "cancel-in-progress"]) ||
    workflow.concurrency["cancel-in-progress"] !== true ||
    typeof workflow.concurrency.group !== "string" ||
    !workflow.concurrency.group.includes("github.workflow") ||
    workflow.concurrency.group.includes("secrets.")
  ) {
    fail(`${name}: bounded concurrency`);
  }
}

function validateWorkflowShape(name, workflow) {
  if (
    !isRecord(workflow) ||
    !hasExactKeys(workflow, ["name", "on", "permissions", "concurrency", "jobs"])
  ) {
    fail(`${name}: workflow shape`);
    return;
  }
  if (!hasExactKeys(workflow.permissions, [])) {
    fail(`${name}: root permissions must be empty`);
  }
  if (!isRecord(workflow.jobs)) {
    fail(`${name}: jobs mapping`);
    return;
  }
  validateConcurrency(name, workflow);
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (
      !isRecord(job) ||
      !Number.isInteger(job["timeout-minutes"]) ||
      job["timeout-minutes"] < 1 ||
      job["timeout-minutes"] > 30 ||
      !isRecord(job.permissions)
    ) {
      fail(`${name}: ${jobName} bounded timeout and job permissions`);
    }
  }
}

function validateActions(name, workflow) {
  for (const action of collectUses(workflow)) {
    if (typeof action !== "string" || !pinnedActions.has(action)) {
      fail(`${name}: unapproved action ${String(action)}`);
    }
  }
  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of getSteps(job)) {
      if (
        isRecord(step) &&
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/checkout@") &&
        step.with?.["persist-credentials"] !== false
      ) {
        fail(`${name}: checkout persists credentials`);
      }
    }
  }
}

function validateJobPermissions(name, workflow) {
  for (const [jobName, job] of Object.entries(workflow.jobs ?? {})) {
    if (!isRecord(job?.permissions)) continue;
    const exactCodeql =
      name === "codeql.yml" &&
      jobName === "analyze" &&
      equal(job.permissions, {
        contents: "read",
        actions: "read",
        "security-events": "write",
      });
    const exactRead = equal(job.permissions, { contents: "read" });
    if (!exactCodeql && !exactRead) {
      fail(`${name}: job permissions must be read-only except CodeQL`);
    }
  }
}

function validateCandidateWorkflow(name, workflow) {
  if (collectStrings(workflow).some((value) => value.includes("secrets."))) {
    fail(`${name}: secret context`);
  }
}

function validateCodeql(workflow) {
  if (
    !hasExactKeys(workflow.on, ["pull_request", "merge_group", "push"]) ||
    !equal(workflow.on.push, { branches: ["main"] })
  ) {
    fail("codeql.yml: approved triggers");
  }
  const analyze = workflow.jobs?.analyze;
  if (
    !hasExactKeys(workflow.jobs, ["analyze"]) ||
    !isRecord(analyze) ||
    analyze.name !== "JavaScript-TypeScript" ||
    analyze["runs-on"] !== "ubuntu-24.04"
  ) {
    fail("codeql.yml: exact CodeQL job");
    return;
  }
  const steps = getSteps(analyze);
  if (
    steps[0]?.uses !== "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" ||
    steps[1]?.uses !==
      "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3" ||
    steps[1]?.with?.languages !== "javascript-typescript" ||
    steps[1]?.with?.["build-mode"] !== "none" ||
    steps[2]?.uses !==
      "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3"
  ) {
    fail("codeql.yml: exact pinned CodeQL actions");
  }
}

function validateDependencyReview(job) {
  if (
    !isRecord(job) ||
    job.name !== "dependency review" ||
    job["runs-on"] !== "ubuntu-24.04" ||
    !equal(job.permissions, { contents: "read" })
  ) {
    fail("quality.yml: dependency-review permissions");
    return;
  }
  const [pullRequest, mergeGroup] = getSteps(job);
  const expectedAction =
    "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294";
  for (const step of [pullRequest, mergeGroup]) {
    if (
      !isRecord(step) ||
      step.uses !== expectedAction ||
      step.with?.["fail-on-severity"] !== "moderate" ||
      step.with?.["fail-on-scopes"] !== "runtime,development,unknown" ||
      step.with?.["show-patched-versions"] !== true ||
      step.with?.["comment-summary-in-pr"] !== "never"
    ) {
      fail("quality.yml: dependency-review inputs");
      return;
    }
  }
  if (
    pullRequest?.if !== "github.event_name == 'pull_request'" ||
    mergeGroup?.if !== "github.event_name == 'merge_group'" ||
    mergeGroup?.with?.["base-ref"] !== "${{ github.event.merge_group.base_sha }}" ||
    mergeGroup?.with?.["head-ref"] !== "${{ github.event.merge_group.head_sha }}"
  ) {
    fail("quality.yml: exact merge-group refs");
  }
}

function validateQuality(workflow) {
  if (!hasExactKeys(workflow.on, ["pull_request", "merge_group"])) {
    fail("quality.yml: approved triggers");
  }
  const { eligibility, quality, aggregate } = workflow.jobs ?? {};
  const dependencyReview = workflow.jobs?.["dependency-review"];
  const harborContract = workflow.jobs?.["harbor-contract"];
  if (
    !hasExactKeys(workflow.jobs, [
      "eligibility",
      "quality",
      "dependency-review",
      "harbor-contract",
      "aggregate",
    ])
  ) {
    fail("quality.yml: exact jobs");
  }
  if (
    !isRecord(eligibility) ||
    !hasExactKeys(eligibility, [
      "name",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    eligibility.name !== "author eligibility" ||
    eligibility["runs-on"] !== "ubuntu-24.04" ||
    !equal(eligibility.permissions, { contents: "read" }) ||
    getSteps(eligibility).length !== 1 ||
    getSteps(eligibility)[0]?.name !== "Decide author eligibility" ||
    !equal(getSteps(eligibility)[0]?.env, {
      AUTHOR_ASSOCIATION: "${{ github.event.pull_request.author_association }}",
      EVENT_NAME: "${{ github.event_name }}",
      PR_AUTHOR: "${{ github.event.pull_request.user.login }}",
    }) ||
    getSteps(eligibility)[0]?.run !== authorEligibilityGate
  ) {
    fail("quality.yml: author eligibility job contract");
  }
  if (
    !isRecord(quality) ||
    quality.name !== "required" ||
    quality.needs !== "eligibility" ||
    !equal(quality.permissions, { contents: "read" })
  ) {
    fail("quality.yml: candidate checkout requires eligibility");
  } else {
    const steps = getSteps(quality);
    const install = indexOfRun(steps, "npm ci --ignore-scripts");
    const audit = indexOfRun(steps, "npm audit --audit-level=moderate");
    const commands = qualityCommands.map((command) => indexOfRun(steps, command));
    if (
      steps[0]?.uses !== "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1" ||
      install < 0 ||
      audit <= install ||
      commands.some((index) => index <= audit) ||
      commands.some(
        (index, position) => position > 0 && index <= commands[position - 1],
      ) ||
      commands.at(-1) !== steps.length - 1
    ) {
      fail(
        "quality.yml: immutable install and moderate audit precede exact repository scripts",
      );
    }
    const scan = steps.find(
      (step) => step?.name === "Scan complete Git history and worktree",
    )?.run;
    if (
      typeof scan !== "string" ||
      !scan.includes("gitleaks git") ||
      !scan.includes("gitleaks dir")
    ) {
      fail("quality.yml: complete history and worktree secret scan");
    }
    if (indexOfRun(steps, "npm run ci:policy") < 0) {
      fail("quality.yml: quality job runs the policy command");
    }
  }
  validateDependencyReview(dependencyReview);
  if (
    !isRecord(harborContract) ||
    harborContract.name !== "harbor contract" ||
    harborContract.needs !== "eligibility" ||
    !equal(harborContract.permissions, { contents: "read" })
  ) {
    fail("quality.yml: Harbor execution requires eligibility");
  } else {
    const steps = getSteps(harborContract);
    const install = indexOfRun(steps, "npm ci --ignore-scripts");
    const audit = indexOfRun(steps, "npm audit --audit-level=moderate");
    const uv = indexOfRun(
      steps,
      "python3 -m pip install --disable-pip-version-check --require-hashes -r .github/uv-requirements.txt",
    );
    const calibrations = calibrationCommands.map((command) =>
      indexOfRun(steps, command),
    );
    if (
      install < 0 ||
      audit <= install ||
      uv <= audit ||
      calibrations.some((index) => index <= uv) ||
      calibrations.some(
        (index, position) => position > 0 && index <= calibrations[position - 1],
      )
    ) {
      fail("quality.yml: hash-pinned Harbor calibration contract");
    }
  }
  if (
    collectStrings(workflow).some(
      (value) =>
        value.includes("npm run pcda:codex") ||
        value.includes("canary:codex") ||
        value.includes("benchmark:smoke"),
    )
  ) {
    fail("quality.yml: live model execution is forbidden in required CI");
  }
  if (
    !isRecord(aggregate) ||
    aggregate.name !== "aggregate" ||
    aggregate.if !== "always()" ||
    !equal(aggregate.needs, [
      "eligibility",
      "quality",
      "dependency-review",
      "harbor-contract",
    ]) ||
    !equal(aggregate.permissions, { contents: "read" })
  ) {
    fail("quality.yml: aggregate contract");
  }
}

function validateSecretBoundary(workflow) {
  if (
    !hasExactKeys(workflow.on, ["pull_request_target", "workflow_dispatch"]) ||
    !equal(workflow.on.pull_request_target?.types, [
      "opened",
      "synchronize",
      "reopened",
      "ready_for_review",
    ]) ||
    workflow.on.workflow_dispatch !== null ||
    !hasExactKeys(workflow.jobs, ["secret-boundary"])
  ) {
    fail("secret-boundary.yml: trusted boundary shape");
    return;
  }
  const boundary = workflow.jobs["secret-boundary"];
  if (
    !isRecord(boundary) ||
    boundary.name !== "Secret boundary" ||
    boundary["runs-on"] !== "ubuntu-latest" ||
    boundary.if !==
      "github.event_name == 'workflow_dispatch' || github.event.pull_request.author_association == 'OWNER' || github.event.pull_request.author_association == 'MEMBER' || github.event.pull_request.user.login == 'dependabot[bot]'" ||
    !equal(boundary.permissions, { contents: "read" })
  ) {
    fail("secret-boundary.yml: trusted author boundary");
    return;
  }
  const steps = getSteps(boundary);
  const trusted = steps.findIndex((step) => step?.with?.path === "trusted");
  const candidate = steps.findIndex((step) => step?.with?.path === "candidate");
  if (trusted !== 0 || candidate < 2) {
    fail("secret-boundary.yml: trusted checkout before candidate data checkout");
  }
  const strings = collectStrings(workflow);
  if (
    strings.some(
      (value) => /(?:^|\s)(?:npm|node)\s/u.test(value) || value.includes("secrets."),
    )
  ) {
    fail("secret-boundary.yml: candidate execution or secret context");
  }
  const scan = steps.at(-1)?.run;
  if (
    typeof scan !== "string" ||
    !scan.includes("set -o pipefail") ||
    !scan.includes("gitleaks git") ||
    !scan.includes("gitleaks dir") ||
    !scan.includes("git -C candidate fetch --no-tags --depth=1") ||
    !scan.includes("git -C candidate cat-file blob")
  ) {
    fail("secret-boundary.yml: complete history, worktree, and raw-blob scans");
  }
}

function validateDependabot() {
  const config = parseYaml(".github/dependabot.yml", "dependabot.yml");
  const updates = config?.updates;
  if (!Array.isArray(updates) || updates.length !== 2) {
    fail("dependabot.yml: exact update lanes");
    return;
  }
  const npm = updates.find((item) => item?.["package-ecosystem"] === "npm");
  const actions = updates.find(
    (item) => item?.["package-ecosystem"] === "github-actions",
  );
  const ignoredMajors = [
    { "dependency-name": "*", "update-types": ["version-update:semver-major"] },
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
    !equal(npm.ignore, ignoredMajors)
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
    !equal(actions.ignore, ignoredMajors)
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
    policy.required_approvals !== 0 ||
    !equal(policy.eligible_author_associations, ["OWNER", "MEMBER"]) ||
    !equal(policy.eligible_bot_logins, ["dependabot[bot]"]) ||
    policy.review_policy?.default_required_approvals !== 0 ||
    policy.review_policy?.sensitive_paths_use_human_team_reviewer !== true
  ) {
    fail("merge policy must be GitHub-native selective-review squash");
  }
  for (const context of [
    "aggregate",
    "dependency review",
    "Secret boundary",
    "JavaScript-TypeScript",
  ]) {
    if (!policy.required_contexts?.includes(context)) {
      fail(`merge policy must require ${context}`);
    }
  }
  for (const path of [
    ".github/**",
    ".githooks/**",
    "AGENTS.md",
    "SECURITY.md",
    "integrations/harbor/**",
    "src/pcda-harbor.ts",
    "src/pcda-runner.ts",
    "src/runner.ts",
  ]) {
    if (!policy.protected_paths?.includes(path)) {
      fail(`merge policy must protect ${path}`);
    }
  }
}

const discovered = readdirSync(workflowRoot)
  .filter((name) => /\.ya?ml$/u.test(name))
  .sort();
if (!equal(discovered, workflowNames)) fail("workflow set must be exact");

const workflows = {};
for (const name of workflowNames) {
  const workflow = parseYaml(`.github/workflows/${name}`, name);
  if (workflow === undefined) continue;
  workflows[name] = workflow;
  validateWorkflowShape(name, workflow);
  validateActions(name, workflow);
  validateJobPermissions(name, workflow);
}
if (workflows["codeql.yml"]) {
  validateCandidateWorkflow("codeql.yml", workflows["codeql.yml"]);
  validateCodeql(workflows["codeql.yml"]);
}
if (workflows["quality.yml"]) {
  validateCandidateWorkflow("quality.yml", workflows["quality.yml"]);
  validateQuality(workflows["quality.yml"]);
}
if (workflows["secret-boundary.yml"]) {
  validateSecretBoundary(workflows["secret-boundary.yml"]);
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (
  packageJson.scripts?.["ci:policy"] !==
  "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs"
) {
  fail("package command must run fixtures before the checker");
}
if (Object.hasOwn(packageJson.scripts ?? {}, "pcda:codex")) {
  fail("credential-bearing live PCDA command must remain absent");
}
for (const relativePath of [
  "src/pcda-bench.ts",
  "src/pcda-harbor.ts",
  "src/pcda-runner.ts",
]) {
  if (existsSync(resolve(root, relativePath))) {
    fail(`credential-bearing live PCDA module must remain absent: ${relativePath}`);
  }
}
if (packageJson.devDependencies?.yaml !== "2.9.0") {
  fail("package policy requires exact yaml 2.9.0");
}
if (Object.hasOwn(packageJson.dependencies ?? {}, "@openboa/coffee-chat")) {
  fail("the evaluator must not depend on private Coffee Chat source");
}
const uvRequirement = readFileSync(
  resolve(root, ".github/uv-requirements.txt"),
  "utf8",
);
const approvedUvRequirement = [
  "uv==0.8.3 \\",
  "    --hash=sha256:f1eb7c896fc0d80ed534748aaf46697b6ebc8ce401f1c51666ce0b9923c3db9a",
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
