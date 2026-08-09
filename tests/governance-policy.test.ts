import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createFakeCandidate } from "../src/adapters/fake-candidate.ts";
import { createDryRunRegistry } from "../src/registry.ts";
import { formatDryRunReport } from "../src/report.ts";

const repository = new URL("..", import.meta.url);
const repositoryExecutionWorkflows = [
  ".github/workflows/quality.yml",
  ".github/workflows/policy.yml",
  ".github/workflows/github-coverage.yml",
] as const;

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, repository), "utf8"));
}

function runTrustedAuthorGate(workflowPath: string, authorAssociation: string): void {
  const workflow = readFileSync(new URL(workflowPath, repository), "utf8");
  const stepMarker = "      - name: Verify trusted pull request author\n";
  const stepStart = workflow.indexOf(stepMarker);
  const runMarker = "        run: |\n";
  const runStart = workflow.indexOf(runMarker, stepStart) + runMarker.length;
  const runEnd = workflow.indexOf("\n      - ", runStart);
  assert.notEqual(stepStart, -1, "trusted-author step must exist");
  assert.notEqual(runStart, runMarker.length - 1, "trusted-author script must exist");
  assert.notEqual(runEnd, -1, "trusted-author step must have a following step");
  const script = workflow.slice(runStart, runEnd).replace(/^ {10}/gmu, "");

  execFileSync("bash", ["-c", `set -euo pipefail\n${script}`], {
    cwd: repository,
    env: { ...process.env, AUTHOR_ASSOCIATION: authorAssociation },
    stdio: "pipe",
  });
}

test("repository governance validates role-owned least-privilege workflows", () => {
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [".github/ci-policy.mjs"], {
      cwd: repository,
      stdio: "pipe",
    }),
  );
});

test("evaluator CalVer is calendar-valid and consistent across public projections", () => {
  const packageSource = readFileSync(new URL("package.json", repository), "utf8");
  const topLevelVersionDeclarations =
    packageSource.match(/^ {2}"version"\s*:/gmu) ?? [];
  assert.equal(
    topLevelVersionDeclarations.length,
    1,
    "package.json must declare exactly one top-level version",
  );
  const packageJson = JSON.parse(packageSource) as { version: string };
  const plan = readFileSync(new URL("PLAN.md", repository), "utf8");
  const planCalVers = [...plan.matchAll(/^CalVer: `([^`]+)`$/gmu)].map(
    (match) => match[1],
  );
  const registry = createDryRunRegistry();
  const report = formatDryRunReport(registry);

  assert.match(
    packageJson.version,
    /^\d{4}\.(?:[1-9]|1[0-2])\.(?:[1-9]|[12]\d|3[01])$/u,
  );
  assert.deepEqual(planCalVers, [packageJson.version]);
  assert.equal(registry.calver, packageJson.version);
  assert.equal(createFakeCandidate().ref.calver, packageJson.version);
  assert.equal(
    report
      .split("\n")
      .filter((line) => line.startsWith("CalVer: "))
      .join("\n"),
    `CalVer: ${packageJson.version}`,
  );
});

test("merge policy requires the contexts actually named by Eval workflows", () => {
  const policy = readJson(".github/merge-policy.json") as {
    required_contexts: string[];
  };
  assert.deepEqual(policy.required_contexts, [
    "Eval / aggregate",
    "Eval / dependency review",
  ]);
});

test("candidate-executing workflows admit only organization owners and members", () => {
  const policy = readJson(".github/merge-policy.json") as Record<string, unknown> & {
    eligible_author_associations?: unknown;
  };
  assert.deepEqual(policy.eligible_author_associations, ["OWNER", "MEMBER"]);
  assert.equal(Object.hasOwn(policy, "eligible_author_logins"), false);

  for (const workflowPath of repositoryExecutionWorkflows) {
    const workflow = readFileSync(new URL(workflowPath, repository), "utf8");
    const gateIndex = workflow.indexOf(
      "      - name: Verify trusted pull request author",
    );
    assert.notEqual(gateIndex, -1, workflowPath);
    assert.doesNotMatch(
      workflow,
      /pull_request\.user\.login|PR_AUTHOR_LOGIN|trusted_official_login/u,
      workflowPath,
    );
    for (const candidateExecution of [
      "uses: actions/checkout@",
      "uses: actions/setup-node@",
      "run: npm ci",
    ]) {
      const executionIndex = workflow.indexOf(candidateExecution);
      assert.notEqual(executionIndex, -1, `${workflowPath}: ${candidateExecution}`);
      assert.ok(gateIndex < executionIndex, `${workflowPath}: ${candidateExecution}`);
    }

    for (const association of ["OWNER", "MEMBER"]) {
      assert.doesNotThrow(() => runTrustedAuthorGate(workflowPath, association));
    }
    for (const association of ["CONTRIBUTOR", "COLLABORATOR", "NONE"]) {
      assert.throws(() => runTrustedAuthorGate(workflowPath, association));
    }
  }
});

test("protected evaluator authority is owned and cannot enter the auto lane", () => {
  const policy = readJson(".github/merge-policy.json") as {
    protected_paths: string[];
    fork_pull_requests?: unknown;
  };
  const protectedPaths = new Set(policy.protected_paths);
  for (const protectedPath of [
    "LICENSE",
    "package.json",
    "package-lock.json",
    "src/adapters/**",
    "src/hosts/**",
    "src/identity.ts",
    "src/matrix.ts",
    "src/registry.ts",
    "src/report.ts",
    "src/runner.ts",
    "src/types.ts",
    "src/validation.ts",
  ]) {
    assert.equal(protectedPaths.has(protectedPath), true, protectedPath);
  }

  const codeowners = readFileSync(new URL(".github/CODEOWNERS", repository), "utf8");
  for (const ownedPath of [
    "/LICENSE",
    "/package.json",
    "/package-lock.json",
    "/src/adapters/",
    "/src/hosts/",
    "/src/identity.ts",
    "/src/matrix.ts",
    "/src/registry.ts",
    "/src/report.ts",
    "/src/runner.ts",
    "/src/types.ts",
    "/src/validation.ts",
  ]) {
    assert.match(codeowners, new RegExp(`^${ownedPath} @openboa$`, "mu"));
  }

  assert.deepEqual(policy.fork_pull_requests, {
    policy: "intake_only",
    coverage_upload: "same_repository_only",
    promotion: "maintainer_same_repository_branch",
  });
});

test("every checkout disables persisted credentials", () => {
  for (const workflowPath of [
    ".github/workflows/quality.yml",
    ".github/workflows/policy.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/github-coverage.yml",
  ]) {
    const workflow = readFileSync(new URL(workflowPath, repository), "utf8");
    const checkoutCount = workflow.match(/uses: actions\/checkout@/gu)?.length ?? 0;
    const disabledCount = workflow.match(/persist-credentials:\s*false/gu)?.length ?? 0;
    assert.equal(disabledCount, checkoutCount, workflowPath);
    assert.doesNotMatch(workflow, /persist-credentials:\s*true/gu);
  }
});

test("quality CI runs evaluator quality and supply-chain gates", () => {
  const workflow = readFileSync(
    new URL(".github/workflows/quality.yml", repository),
    "utf8",
  );

  assert.match(workflow, /needs\.dependency-review\.result/u);
  assert.match(workflow, /^name: Eval$/mu);
  assert.match(workflow, /name: required/u);
  assert.match(workflow, /name: dependency review/u);
  assert.match(workflow, /npm run ci:policy/u);
  assert.match(workflow, /npm run dry-run/u);
});

test("coverage CI uploads same-repository Cobertura evidence to GitHub", () => {
  const workflow = readFileSync(
    new URL(".github/workflows/github-coverage.yml", repository),
    "utf8",
  );

  assert.match(workflow, /^name: Eval code coverage$/mu);
  assert.match(workflow, /pull_request:/u);
  assert.match(workflow, /merge_group:/u);
  assert.match(workflow, /--experimental-test-coverage/u);
  assert.match(workflow, /--experimental-strip-types/u);
  assert.match(workflow, /coverage\/cobertura\.xml/u);
  assert.match(
    workflow,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u,
  );
  assert.match(workflow, /code-quality: write/u);
  assert.match(workflow, /actions\/upload-code-coverage@[0-9a-f]{40}/u);
  assert.match(workflow, /label: eval-javascript/u);
  assert.doesNotMatch(workflow, /fail-on-error:\s*false/u);
});
