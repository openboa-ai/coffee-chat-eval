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
const expectedPackageScripts = {
  "benchmark:calibrate":
    "node --experimental-strip-types src/canary-cli.ts benchmark-calibrate",
  build: "tsc --noEmit",
  "canary:calibrate": "node --experimental-strip-types src/canary-cli.ts calibrate",
  "canary:check":
    "python3 -m py_compile evals/protocol-canary/tests/verify.py evals/ifeval-smoke/tests/verify.py && sh -n evals/protocol-canary/solution/solve.sh evals/protocol-canary/tests/test.sh evals/ifeval-smoke/solution/solve.sh evals/ifeval-smoke/tests/test.sh",
  "ci:policy":
    "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs",
  "dry-run": "node --experimental-strip-types src/cli.ts dry-run",
  format: "prettier --write .",
  "format:check": "prettier --check .",
  "hooks:install": "git config core.hooksPath .githooks",
  "pcda:calibrate":
    "node --experimental-strip-types src/pcda-cli.ts calibrate --oracle-result $PWD/tests/fixtures/pcda-calibration/oracle-result.json --noop-result $PWD/tests/fixtures/pcda-calibration/noop-result.json",
  "security:scan": "gitleaks git --redact --no-banner .",
  smoke: "node --experimental-strip-types --test tests/smoke.test.ts",
  test: "node --experimental-strip-types --test tests/*.test.*",
  typecheck: "tsc --noEmit",
};
const authorEligibilityGate = `case "$EVENT_NAME" in
  pull_request)
    case "$AUTHOR_ASSOCIATION" in
      OWNER|MEMBER)
        test "$ACTOR" = "$PR_AUTHOR"
        test "$HEAD_REPOSITORY" = "$BASE_REPOSITORY"
        ;;
      *)
        test "$ACTOR" = "dependabot[bot]"
        test "$PR_AUTHOR" = "dependabot[bot]"
        test "$HEAD_REPOSITORY" = "$BASE_REPOSITORY"
        ;;
    esac
    ;;
  *) exit 1 ;;
esac
`;
const authorEligibilityEnv = {
  ACTOR: "${{ github.actor }}",
  AUTHOR_ASSOCIATION: "${{ github.event.pull_request.author_association }}",
  BASE_REPOSITORY: "${{ github.repository }}",
  EVENT_NAME: "${{ github.event_name }}",
  HEAD_REPOSITORY: "${{ github.event.pull_request.head.repo.full_name }}",
  PR_AUTHOR: "${{ github.event.pull_request.user.login }}",
};
const qualitySecretScan = [
  "test ! -e .gitleaks.toml",
  "printf '%s  %s\\n' \\",
  "  '5b78ddc165d282a346988abf15a48875a24020aa340a0984dd3cee9d27da9a50' \\",
  "  '.gitleaksignore' | sha256sum --check",
  'gitleaks git --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  "  --gitleaks-ignore-path .gitleaksignore --ignore-gitleaks-allow \\",
  "  --redact --no-banner .",
  'gitleaks dir --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  "  --gitleaks-ignore-path .gitleaksignore --ignore-gitleaks-allow \\",
  "  --redact --no-banner .",
  "",
].join("\n");
const boundarySecretScan = [
  "set -o pipefail",
  "test ! -e candidate/.gitleaks.toml",
  "cmp trusted/.gitleaksignore candidate/.gitleaksignore",
  'ignore_path="$GITHUB_WORKSPACE/trusted/.gitleaksignore"',
  'gitleaks git --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  '  --gitleaks-ignore-path "$ignore_path" --ignore-gitleaks-allow \\',
  '  --redact --no-banner "$GITHUB_WORKSPACE/candidate"',
  'gitleaks dir --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  '  --gitleaks-ignore-path "$ignore_path" --ignore-gitleaks-allow \\',
  '  --redact --no-banner "$GITHUB_WORKSPACE/candidate"',
  'blob_dir="$(mktemp -d)"',
  'if test -n "$BASE_SHA"; then',
  "  git -C candidate fetch --no-tags --depth=1 \\",
  '    "https://github.com/$BASE_REPOSITORY.git" "$BASE_SHA"',
  '  object_range="$BASE_SHA..$HEAD_SHA"',
  "else",
  '  object_range="$HEAD_SHA"',
  "fi",
  'git -C candidate rev-list --objects "$object_range" |',
  "  cut -d' ' -f1 |",
  "  git -C candidate cat-file --batch-check='%(objectname) %(objecttype)' |",
  "  awk '$2 == \"blob\" { print $1 }' |",
  "  while read -r object_id; do",
  '    git -C candidate cat-file blob "$object_id" > "$blob_dir/$object_id"',
  "  done",
  'gitleaks dir --config "$GITLEAKS_TRUSTED_CONFIG" \\',
  '  --gitleaks-ignore-path "$ignore_path" --ignore-gitleaks-allow \\',
  '  --redact --no-banner "$blob_dir"',
  "",
].join("\n");

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
    !hasExactKeys(workflow.on, ["pull_request", "push"]) ||
    !equal(workflow.on.push, { branches: ["main"] })
  ) {
    fail("codeql.yml: approved triggers");
  }
  const analyze = workflow.jobs?.analyze;
  if (
    !hasExactKeys(workflow.jobs, ["analyze"]) ||
    !isRecord(analyze) ||
    !hasExactKeys(analyze, [
      "name",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    analyze.name !== "JavaScript-TypeScript" ||
    analyze["runs-on"] !== "ubuntu-24.04" ||
    analyze["timeout-minutes"] !== 20
  ) {
    fail("codeql.yml: exact CodeQL job");
    return;
  }
  const steps = getSteps(analyze);
  if (
    !equal(steps, [
      {
        name: "Check out repository without persisted credentials",
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: { "persist-credentials": false },
      },
      {
        name: "Initialize CodeQL",
        uses: "github/codeql-action/init@5595ccaf912efad79be6eef63a5619ff05969be3",
        with: { languages: "javascript-typescript", "build-mode": "none" },
      },
      {
        name: "Analyze with CodeQL",
        uses: "github/codeql-action/analyze@5595ccaf912efad79be6eef63a5619ff05969be3",
      },
    ])
  ) {
    fail("codeql.yml: exact pinned CodeQL actions");
  }
}

function validateDependencyReview(job) {
  if (
    !isRecord(job) ||
    !hasExactKeys(job, [
      "name",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    job.name !== "dependency review" ||
    job["runs-on"] !== "ubuntu-24.04" ||
    job["timeout-minutes"] !== 10 ||
    !equal(job.permissions, { contents: "read" })
  ) {
    fail("quality.yml: dependency-review permissions");
    return;
  }
  if (
    !equal(getSteps(job), [
      {
        name: "Review pull-request dependencies",
        uses: "actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294",
        with: {
          "fail-on-severity": "moderate",
          "fail-on-scopes": "runtime,development,unknown",
          "show-patched-versions": true,
          "comment-summary-in-pr": "never",
        },
      },
    ])
  ) {
    fail("quality.yml: dependency-review inputs");
  }
}

function validateQuality(workflow) {
  if (!hasExactKeys(workflow.on, ["pull_request"])) {
    fail("quality.yml: approved triggers");
  }
  const { eligibility, quality, aggregate } = workflow.jobs ?? {};
  const dependencyReview = workflow.jobs?.["dependency-review"];
  const harborContract = workflow.jobs?.["harbor-contract"];
  const eligibilitySteps = getSteps(eligibility);
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
    eligibilitySteps.length !== 1 ||
    !equal(eligibilitySteps[0], {
      name: "Decide author eligibility",
      env: authorEligibilityEnv,
      run: authorEligibilityGate,
    })
  ) {
    fail("quality.yml: author eligibility job contract");
  }
  if (
    !isRecord(quality) ||
    !hasExactKeys(quality, [
      "name",
      "needs",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    quality.name !== "required" ||
    quality.needs !== "eligibility" ||
    quality["runs-on"] !== "ubuntu-24.04" ||
    quality["timeout-minutes"] !== 20 ||
    !equal(quality.permissions, { contents: "read" })
  ) {
    fail("quality.yml: candidate checkout requires eligibility");
  } else {
    const steps = getSteps(quality);
    if (
      !equal(steps, [
        {
          name: "Check out repository without persisted credentials",
          uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          with: { "fetch-depth": 0, "persist-credentials": false },
        },
        {
          name: "Install immutable Gitleaks",
          run: ".github/scripts/install-gitleaks.sh",
        },
        {
          name: "Scan complete Git history and worktree",
          run: qualitySecretScan,
        },
        {
          name: "Set up Node.js",
          uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
          with: { "node-version": 24, cache: "npm" },
        },
        { run: "npm ci --ignore-scripts" },
        {
          name: "Enforce repository policy before delegated scripts",
          run: "node .github/ci-policy.mjs",
        },
        { run: "npm audit --audit-level=moderate" },
        ...qualityCommands.map((run) => ({ run })),
      ])
    ) {
      fail("quality.yml: exact fail-closed candidate quality steps and secret scan");
    }
  }
  validateDependencyReview(dependencyReview);
  if (
    !isRecord(harborContract) ||
    !hasExactKeys(harborContract, [
      "name",
      "needs",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    harborContract.name !== "harbor contract" ||
    harborContract.needs !== "eligibility" ||
    harborContract["runs-on"] !== "ubuntu-24.04" ||
    harborContract["timeout-minutes"] !== 30 ||
    !equal(harborContract.permissions, { contents: "read" })
  ) {
    fail("quality.yml: Harbor execution requires eligibility");
  } else {
    const steps = getSteps(harborContract);
    if (
      !equal(steps, [
        {
          name: "Check out repository without persisted credentials",
          uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          with: { "persist-credentials": false },
        },
        {
          name: "Set up Node.js",
          uses: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
          with: { "node-version": 24, cache: "npm" },
        },
        { run: "npm ci --ignore-scripts" },
        {
          name: "Enforce repository policy before delegated scripts",
          run: "node .github/ci-policy.mjs",
        },
        { run: "npm audit --audit-level=moderate" },
        {
          name: "Install hash-verified uv",
          run: "python3 -m pip install --disable-pip-version-check --require-hashes -r .github/uv-requirements.txt",
        },
        ...calibrationCommands.map((run) => ({ run })),
      ])
    ) {
      fail("quality.yml: exact hash-pinned Harbor calibration steps");
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
    !hasExactKeys(aggregate, [
      "name",
      "if",
      "needs",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    aggregate.name !== "aggregate" ||
    aggregate.if !== "always()" ||
    !equal(aggregate.needs, [
      "eligibility",
      "quality",
      "dependency-review",
      "harbor-contract",
    ]) ||
    aggregate["runs-on"] !== "ubuntu-24.04" ||
    aggregate["timeout-minutes"] !== 5 ||
    !equal(aggregate.permissions, { contents: "read" }) ||
    !equal(getSteps(aggregate), [
      {
        name: "Require every applicable lane",
        env: {
          DEPENDENCY_REVIEW_RESULT: "${{ needs.dependency-review.result }}",
          ELIGIBILITY_RESULT: "${{ needs.eligibility.result }}",
          HARBOR_CONTRACT_RESULT: "${{ needs.harbor-contract.result }}",
          QUALITY_RESULT: "${{ needs.quality.result }}",
        },
        run: 'test "$ELIGIBILITY_RESULT" = success\ntest "$QUALITY_RESULT" = success\ntest "$DEPENDENCY_REVIEW_RESULT" = success\ntest "$HARBOR_CONTRACT_RESULT" = success\n',
      },
    ])
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
    !hasExactKeys(boundary, [
      "name",
      "if",
      "runs-on",
      "timeout-minutes",
      "permissions",
      "steps",
    ]) ||
    boundary.name !== "Secret boundary" ||
    boundary["runs-on"] !== "ubuntu-24.04" ||
    boundary["timeout-minutes"] !== 10 ||
    boundary.if !==
      "github.event_name == 'workflow_dispatch' || ((github.event.pull_request.author_association == 'OWNER' || github.event.pull_request.author_association == 'MEMBER') && github.actor == github.event.pull_request.user.login && github.event.pull_request.head.repo.full_name == github.repository) || (github.actor == 'dependabot[bot]' && github.event.pull_request.user.login == 'dependabot[bot]' && github.event.pull_request.head.repo.full_name == github.repository)" ||
    !equal(boundary.permissions, { contents: "read" })
  ) {
    fail("secret-boundary.yml: trusted author boundary");
    return;
  }
  const steps = getSteps(boundary);
  const strings = collectStrings(workflow);
  if (
    strings.some(
      (value) => /(?:^|\s)(?:npm|node)\s/u.test(value) || value.includes("secrets."),
    )
  ) {
    fail("secret-boundary.yml: candidate execution or secret context");
  }
  if (
    !equal(steps, [
      {
        name: "Check out trusted security controls",
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: {
          ref: "${{ github.event.pull_request.base.sha || github.sha }}",
          "fetch-depth": 1,
          "persist-credentials": false,
          path: "trusted",
        },
      },
      {
        name: "Install immutable Gitleaks from trusted base",
        run: "trusted/.github/scripts/install-gitleaks.sh",
      },
      {
        name: "Check out candidate as data only",
        uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
        with: {
          repository:
            "${{ github.event.pull_request.head.repo.full_name || github.repository }}",
          ref: "${{ github.event.pull_request.head.sha || github.sha }}",
          "fetch-depth": 0,
          "persist-credentials": false,
          path: "candidate",
        },
      },
      {
        name: "Scan candidate without executing it",
        env: {
          BASE_SHA: "${{ github.event.pull_request.base.sha || '' }}",
          BASE_REPOSITORY: "${{ github.repository }}",
          HEAD_SHA: "${{ github.event.pull_request.head.sha || github.sha }}",
        },
        run: boundarySecretScan,
      },
    ])
  ) {
    fail("secret-boundary.yml: exact fail-closed trusted boundary and raw-blob scans");
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
    policy.review_policy?.sensitive_paths_use_human_team_reviewer !== true
  ) {
    fail("merge policy must be GitHub-native selective-review squash");
  }
  if (
    !equal(policy.required_checks, [
      { context: "aggregate", integration_id: 15368 },
      { context: "dependency review", integration_id: 15368 },
      { context: "Secret boundary", integration_id: 15368 },
      { context: "JavaScript-TypeScript", integration_id: 15368 },
    ])
  ) {
    fail("merge policy must retain exact required checks");
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
      "integrations/harbor/**",
      "evals/**",
      "src/benchmark-smoke.ts",
      "src/canary-cli.ts",
      "src/harbor.ts",
      "src/pcda-cli.ts",
      "src/pcda-receipt.ts",
      "src/pcda-resources.ts",
      "src/protocol-canary.ts",
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
