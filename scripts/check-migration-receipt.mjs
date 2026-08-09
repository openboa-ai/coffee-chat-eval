import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const task = "task-4-governance-and-deterministic-evaluator-baseline";
const reviewedAuthoritySha = "75b784af363d5f92c60c885e7e2f8ab568ede502";
const authorityPaths = [
  `docs/migration/objectives/${task}.json`,
  `docs/migration/selections/${task}.json`,
  `docs/migration/equality/${task}.json`,
  `docs/migration/receipts/${task}.json`,
];
const root = new URL("../", import.meta.url);
const path = (relative) => new URL(relative, root);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function assertChangedPathsAreClassified(changedPaths, classifiedPaths) {
  for (const changedPath of changedPaths) {
    if (!classifiedPaths.has(changedPath)) {
      throw new Error(`unclassified changed surface: ${changedPath}`);
    }
  }
}

export function assertAuthorityBytesMatch(reviewedBytes, workspaceBytes) {
  for (const [relative, bytes] of reviewedBytes) {
    if (workspaceBytes.get(relative) !== bytes) {
      throw new Error(`reviewed migration authority differs: ${relative}`);
    }
  }
}

async function readJson(relative) {
  const bytes = await readFile(path(relative));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

async function migrationBase() {
  if (process.env.MIGRATION_BASE_SHA) return process.env.MIGRATION_BASE_SHA;
  const { stdout } = await execFileAsync("git", ["merge-base", "HEAD", "origin/main"], {
    cwd: path(".").pathname,
  });
  return stdout.trim();
}

async function reviewedAuthority() {
  const requested = process.env.MIGRATION_AUTHORITY_SHA ?? reviewedAuthoritySha;
  if (requested !== reviewedAuthoritySha) {
    throw new Error("migration authority must use the reviewed trust-base commit");
  }
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", requested, "HEAD"], {
      cwd: path(".").pathname,
    });
  } catch {
    throw new Error("reviewed migration authority is not reachable from HEAD");
  }
  return requested;
}

async function authorityBytes(authority) {
  const entries = await Promise.all(
    authorityPaths.map(async (relative) => {
      const { stdout } = await execFileAsync(
        "git",
        ["show", `${authority}:${relative}`],
        {
          cwd: path(".").pathname,
          encoding: "buffer",
        },
      );
      return [relative, Buffer.from(stdout).toString("utf8")];
    }),
  );
  return new Map(entries);
}

async function main() {
  const authority = await reviewedAuthority();
  const [
    objective,
    projection,
    equality,
    execution,
    packageJson,
    plan,
    registry,
    candidate,
  ] = await Promise.all([
    readJson(`docs/migration/objectives/${task}.json`),
    readJson(`docs/migration/selections/${task}.json`),
    readJson(`docs/migration/equality/${task}.json`),
    readJson(`docs/migration/receipts/${task}.json`),
    readJson("package.json"),
    readFile(path("PLAN.md"), "utf8"),
    readFile(path("src/registry.ts"), "utf8"),
    readFile(path("src/adapters/fake-candidate.ts"), "utf8"),
  ]);
  assertAuthorityBytesMatch(
    await authorityBytes(authority),
    new Map([
      [`docs/migration/objectives/${task}.json`, objective.bytes.toString("utf8")],
      [`docs/migration/selections/${task}.json`, projection.bytes.toString("utf8")],
      [`docs/migration/equality/${task}.json`, equality.bytes.toString("utf8")],
      [`docs/migration/receipts/${task}.json`, execution.bytes.toString("utf8")],
    ]),
  );
  const expectedLedger =
    "a2717ed0750c11081e09933703d256b971235fd1a5bb73f91476f04badf1b8eb";
  if (
    projection.value.ledger_sha256 !== expectedLedger ||
    equality.value.ledger_sha256 !== expectedLedger
  ) {
    throw new Error(
      "migration ledger digest does not match the frozen workspace ledger",
    );
  }
  if (equality.value.objective_selection_sha256 !== digest(objective.bytes)) {
    throw new Error("migration equality receipt does not bind the objective selection");
  }
  if (equality.value.projection_sha256 !== digest(projection.bytes)) {
    throw new Error(
      "migration equality receipt does not bind the exact projection bytes",
    );
  }
  if (execution.value.projection_sha256 !== `sha256:${digest(projection.bytes)}`) {
    throw new Error("execution receipt does not bind the exact projection bytes");
  }
  if (execution.value.equality_receipt_sha256 !== `sha256:${digest(equality.bytes)}`) {
    throw new Error("execution receipt does not bind the exact equality receipt bytes");
  }
  if (
    execution.value.execution_class !== "fixture_only" ||
    execution.value.oracle !== "local_deterministic_checks"
  ) {
    throw new Error("baseline receipt must remain fixture-only and deterministic");
  }
  const calver = packageJson.value.version;
  if (typeof calver !== "string" || !/^\d+\.[1-9]\d*\.[1-9]\d*$/u.test(calver)) {
    throw new Error("package version must use unpadded CalVer");
  }
  for (const [name, text] of Object.entries({ plan, registry, candidate })) {
    if (!text.includes(calver))
      throw new Error(`${name} does not project package CalVer`);
  }
  const base = await migrationBase();
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", base],
    { cwd: path(".").pathname },
  );
  assertChangedPathsAreClassified(
    stdout.split("\n").filter(Boolean),
    new Set(
      projection.value.changed_surface_classification.map(
        ({ target_path_or_surface }) => target_path_or_surface,
      ),
    ),
  );
}

if (
  process.argv[1] &&
  new URL(process.argv[1], `file://${process.cwd()}/`).pathname ===
    fileURLToPath(import.meta.url)
) {
  await main();
}
