import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const task = "task-4-governance-and-deterministic-evaluator-baseline";
const emptyBaseSha = "c834e23a7149b434d5b4c349cf4589502306da0c";
const authorityPaths = [
  `docs/migration/objectives/${task}.json`,
  `docs/migration/selections/${task}.json`,
  `docs/migration/equality/${task}.json`,
  `docs/migration/receipts/${task}.json`,
];
const reviewedAuthorityDigests = new Map([
  [
    `docs/migration/objectives/${task}.json`,
    "94395157290237c40e1b370f2987b80013b20ffc1933430b83d0ec7a1ccbb142",
  ],
  [
    `docs/migration/selections/${task}.json`,
    "4c024cb1ed66ead5bea7c7e091218da747773876fb531dbbd2c82b6a6e7ae8c4",
  ],
  [
    `docs/migration/equality/${task}.json`,
    "71e96b691038747c18481d41e056f201e0fe781050f4f7026403dda6eb813440",
  ],
  [
    `docs/migration/receipts/${task}.json`,
    "e65d1d8b58ca019e27aec9483f78e30d7ee236ca70eb404ae4cd6a0f46292527",
  ],
]);
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

export function assertAuthorityDigestsMatch(expectedDigests, actualDigests) {
  for (const [relative, expected] of expectedDigests) {
    if (actualDigests.get(relative) !== expected) {
      throw new Error(`reviewed migration authority digest differs: ${relative}`);
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

async function main() {
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
  assertAuthorityDigestsMatch(
    reviewedAuthorityDigests,
    new Map([
      [`docs/migration/objectives/${task}.json`, digest(objective.bytes)],
      [`docs/migration/selections/${task}.json`, digest(projection.bytes)],
      [`docs/migration/equality/${task}.json`, digest(equality.bytes)],
      [`docs/migration/receipts/${task}.json`, digest(execution.bytes)],
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
  if (base !== emptyBaseSha) {
    const receiptPath = `docs/migration/receipts/${task}.json`;
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["show", `${base}:${receiptPath}`],
        {
          cwd: path(".").pathname,
          encoding: "buffer",
        },
      );
      if (digest(stdout) !== reviewedAuthorityDigests.get(receiptPath)) {
        throw new Error("base bootstrap receipt digest differs");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "base bootstrap receipt digest differs"
      )
        throw error;
      throw new Error("base does not contain the reviewed bootstrap receipt");
    }
    return;
  }
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
