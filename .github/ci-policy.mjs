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
assertRequiredContexts(mergePolicy.required_contexts, [
  namedJobContext("quality.yml", quality, "quality"),
  namedJobContext("quality.yml", quality, "dependency-review"),
  namedJobContext("codeql.yml", codeql, "analyze"),
]);

const packageJson = JSON.parse(await readFile(path("package.json"), "utf8"));
for (const script of ["format:check", "typecheck", "test", "dry-run", "ci:policy"]) {
  if (typeof packageJson.scripts?.[script] !== "string")
    throw new Error(`missing ${script} script`);
}
await execFileAsync(process.execPath, ["scripts/check-migration-receipt.mjs"], {
  cwd: path(".").pathname,
});
