import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);
const path = (relative) => new URL(relative, root);
const workflows = [
  ".github/workflows/quality.yml",
  ".github/workflows/policy.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/github-coverage.yml",
];
const pinnedAction = /uses:\s+[\w/-]+@[0-9a-f]{40}\b/u;

export function assertCheckoutCredentialsDisabled(workflow, source) {
  const lines = source.split("\n");
  const checkoutIndexes = lines.flatMap((line, index) =>
    line.includes("uses: actions/checkout@") ? [index] : [],
  );
  for (const checkoutIndex of checkoutIndexes) {
    const usesIndent = /^\s*/u.exec(lines[checkoutIndex])?.[0].length ?? 0;
    let stepStart = -1;
    let stepIndent = -1;
    for (let index = checkoutIndex; index >= 0; index -= 1) {
      const marker = /^(\s*)-\s/u.exec(lines[index]);
      if (marker && marker[1].length <= usesIndent) {
        stepStart = index;
        stepIndent = marker[1].length;
        break;
      }
    }
    if (stepStart === -1) throw new Error(`${workflow} has an unparseable checkout`);
    let stepEnd = lines.length;
    for (let index = stepStart + 1; index < lines.length; index += 1) {
      const marker = /^(\s*)-\s/u.exec(lines[index]);
      if (marker && marker[1].length === stepIndent) {
        stepEnd = index;
        break;
      }
    }
    const step = lines.slice(stepStart, stepEnd).join("\n");
    const disabledDeclarations =
      step.match(/^\s*persist-credentials:\s*false\s*$/gmu)?.length ?? 0;
    if (
      disabledDeclarations !== 1 ||
      /^\s*persist-credentials:\s*true\s*$/mu.test(step)
    ) {
      throw new Error(`${workflow} checkout must disable persisted credentials`);
    }
  }
}

function namedJobContext(workflow, source, jobId) {
  const workflowName = /^name:\s*(.+)$/mu.exec(source)?.[1];
  const jobStart = source.indexOf(`  ${jobId}:\n`);
  const nextJob = source.slice(jobStart + 1).search(/\n  [^\s][^\n]*:\n/u);
  const jobEnd = nextJob === -1 ? undefined : jobStart + 1 + nextJob;
  const job = source.slice(jobStart, jobEnd);
  const jobName = /^    name:\s*(.+)$/mu.exec(job)?.[1];
  if (!workflowName || !jobName) {
    throw new Error(`${workflow} does not define a named ${jobId} job`);
  }
  return `${workflowName} / ${jobName}`;
}

export function assertRequiredContexts(requiredContexts, namedContexts) {
  if (
    requiredContexts.length !== namedContexts.length ||
    requiredContexts.some((context, index) => context !== namedContexts[index])
  ) {
    throw new Error("merge policy contexts do not match named workflow jobs");
  }
}

for (const workflow of workflows) {
  const text = await readFile(path(workflow), "utf8");
  if (!text.includes("pull_request:") || !text.includes("merge_group:")) {
    throw new Error(`${workflow} must run for pull_request and merge_group`);
  }
  if (
    text.includes("pull_request_target") ||
    ![...text.matchAll(/uses:.*$/gmu)].every(([line]) => pinnedAction.test(line))
  ) {
    throw new Error(`${workflow} has an unsafe trigger or unpinned action`);
  }
  assertCheckoutCredentialsDisabled(workflow, text);
}

const quality = await readFile(path(".github/workflows/quality.yml"), "utf8");
if (
  !quality.includes("name: aggregate") ||
  !quality.includes("if: always()") ||
  !quality.includes("contents: read") ||
  !quality.includes("name: dependency review") ||
  !quality.includes(
    "actions/dependency-review-action@2031cfc080254a8a887f58cffee85186f0e49e48",
  ) ||
  !quality.includes("github.event.merge_group.base_sha") ||
  !quality.includes("MIGRATION_BASE_SHA")
) {
  throw new Error(
    "quality workflow lacks the required aggregate or dependency-review lane",
  );
}
for (const required of [
  "name: Verify trusted pull request author",
  "github.event_name == 'pull_request'",
  "github.event.pull_request.author_association",
  "OWNER|MEMBER",
  "author=untrusted",
]) {
  if (!quality.includes(required)) {
    throw new Error(`quality workflow lacks member eligibility: ${required}`);
  }
}
if (quality.includes("COLLABORATOR")) {
  throw new Error("quality workflow must not admit non-member collaborators");
}
const policy = await readFile(path(".github/workflows/policy.yml"), "utf8");
if (
  !policy.includes("fetch-depth: 0") ||
  !policy.includes("MIGRATION_BASE_SHA") ||
  !policy.includes("github.event.pull_request.base.sha") ||
  !policy.includes("github.event.merge_group.base_sha")
) {
  throw new Error("policy workflow lacks the change-aware migration base");
}
const codeql = await readFile(path(".github/workflows/codeql.yml"), "utf8");
for (const permission of [
  "contents: read",
  "actions: read",
  "security-events: write",
]) {
  if (!codeql.includes(permission))
    throw new Error(`CodeQL must declare ${permission}`);
}
if (codeql.includes("id-token:") || codeql.includes("packages:"))
  throw new Error("CodeQL has unrelated write scope");

const coverage = await readFile(path(".github/workflows/github-coverage.yml"), "utf8");
for (const required of [
  "permissions: {}",
  "--experimental-strip-types",
  "--experimental-test-coverage",
  "--test-reporter-destination=coverage/lcov.info",
  "--require-hashes",
  "--requirement .github/coverage-requirements.txt",
  "github.event.pull_request.head.repo.full_name == github.repository",
  "github.event_name != 'merge_group'",
  "needs.coverage.result == 'success'",
  "code-quality: write",
  "file: cobertura.xml",
  "language: JavaScript",
  "label: eval-javascript",
]) {
  if (!coverage.includes(required))
    throw new Error(`coverage workflow is missing ${required}`);
}
for (const forbidden of ["secrets.", "id-token:", "packages:"]) {
  if (coverage.includes(forbidden))
    throw new Error(`coverage workflow has forbidden authority: ${forbidden}`);
}
if (/fail-on-error:\s*false/u.test(coverage)) {
  throw new Error("coverage upload failures must remain fail-closed");
}
const coverageRequirements = await readFile(
  path(".github/coverage-requirements.txt"),
  "utf8",
);
if (
  coverageRequirements.trim() !==
  "lcov_cobertura==2.1.1 --hash=sha256:92f8107297f6d1d7a7a0a88c6071c1ea04f862f2fe918c6ecce271573c37d8aa"
)
  throw new Error("coverage converter must remain version and hash locked");

const mergePolicy = JSON.parse(
  await readFile(path(".github/merge-policy.json"), "utf8"),
);
if (
  JSON.stringify(mergePolicy.auto_merge) !==
    JSON.stringify({ required_checks: true, verified_members_only: true }) ||
  JSON.stringify(mergePolicy.eligible_author_associations) !==
    JSON.stringify(["OWNER", "MEMBER"])
) {
  throw new Error("merge policy must use approval-free member auto-merge");
}
const requiredProtectedPaths = [
  "LICENSE",
  "package.json",
  "package-lock.json",
  "scripts/check-migration-receipt.mjs",
  "src/identity.ts",
  "src/matrix.ts",
  "src/registry.ts",
  "src/report.ts",
  "src/types.ts",
];
for (const protectedPath of requiredProtectedPaths) {
  if (!mergePolicy.protected_paths.includes(protectedPath)) {
    throw new Error(`merge policy must protect ${protectedPath}`);
  }
}
if (
  JSON.stringify(mergePolicy.fork_pull_requests) !==
  JSON.stringify({
    policy: "intake_only",
    coverage_upload: "same_repository_only",
    promotion: "maintainer_same_repository_branch",
  })
) {
  throw new Error("fork pull request intake policy differs");
}
const codeowners = await readFile(path(".github/CODEOWNERS"), "utf8");
for (const protectedPath of requiredProtectedPaths) {
  if (!codeowners.split("\n").includes(`/${protectedPath} @openboa`)) {
    throw new Error(`CODEOWNERS must own ${protectedPath}`);
  }
}
assertRequiredContexts(mergePolicy.required_contexts, [
  namedJobContext("quality.yml", quality, "aggregate"),
  namedJobContext("quality.yml", quality, "dependency-review"),
]);

const packageJson = JSON.parse(await readFile(path("package.json"), "utf8"));
for (const script of ["format:check", "typecheck", "test", "dry-run", "ci:policy"]) {
  if (typeof packageJson.scripts?.[script] !== "string")
    throw new Error(`missing ${script} script`);
}
if (packageJson.devDependencies?.ajv !== "8.20.0") {
  throw new Error("migration schema validator must remain exactly pinned");
}
await execFileAsync(process.execPath, ["scripts/check-migration-receipt.mjs"], {
  cwd: path(".").pathname,
});
