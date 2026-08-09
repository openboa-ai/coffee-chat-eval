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
  !quality.includes("MIGRATION_BASE_SHA") ||
  !quality.includes("MIGRATION_AUTHORITY_SHA")
) {
  throw new Error(
    "quality workflow lacks the required aggregate or dependency-review lane",
  );
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
