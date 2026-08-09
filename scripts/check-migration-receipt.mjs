import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import Ajv2020 from "ajv/dist/2020.js";

const execFileAsync = promisify(execFile);
const task = "task-4-governance-and-deterministic-evaluator-baseline";
const targetOwner = "openboa-ai/coffee-chat-eval";
const taskId = "task-4";
const objectiveName = "governance-and-deterministic-evaluator-baseline";
const emptyBaseSha = "c834e23a7149b434d5b4c349cf4589502306da0c";
const expectedLedger =
  "a2717ed0750c11081e09933703d256b971235fd1a5bb73f91476f04badf1b8eb";
const expectedGenerator =
  "110f1a2a00d8cd7095e79f6c090ffc833f62e3c39adf71790bf29b1e9d7338c7";
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
    "da2ea3fa1605dbf90d4739e4d300fbb6ee1f44efffda5d55c9bdc6982f08b3e8",
  ],
]);
const schemaDocuments = [
  [".github/migration-selection.schema.json", `docs/migration/selections/${task}.json`],
  [
    ".github/migration-equality-receipt.schema.json",
    `docs/migration/equality/${task}.json`,
  ],
  [".github/migration-receipt.schema.json", `docs/migration/receipts/${task}.json`],
];
const root = new URL("../", import.meta.url);
const rootDirectory = fileURLToPath(root);
const path = (relative) => new URL(relative, root);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalJson = (value) => JSON.stringify(value, null, 2) + "\n";

export function isCalVer(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})\.([1-9]|1[0-2])\.([1-9]|[12]\d|3[01])$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = daysInMonth[month - 1];
  return maximumDay !== undefined && day <= maximumDay;
}

function readUniqueCalVerField(name, text, pattern) {
  const values = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = pattern.exec(line);
    if (match) values.push(match[1]);
  }
  if (values.length !== 1) {
    throw new Error(`${name} must declare exactly one authoritative CalVer field`);
  }
  return values[0];
}

export function gitBlobOid(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

export function assertMigratedBytesEqual(sourceBytes, targetBytes, targetPath) {
  if (!sourceBytes.equals(targetBytes)) {
    throw new Error(`pinned source bytes differ from migrated target: ${targetPath}`);
  }
}

export async function readPinnedSource(row, fetchImplementation = fetch) {
  const encodedRepository = row.source_repository
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const encodedPath = row.source_path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url =
    `https://api.github.com/repos/${encodedRepository}/contents/${encodedPath}` +
    `?ref=${encodeURIComponent(row.source_commit)}`;
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "openboa-ai-coffee-chat-eval-migration-check",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetchImplementation(url, {
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`pinned source fetch failed: HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (
    !payload ||
    Array.isArray(payload) ||
    payload.type !== "file" ||
    payload.encoding !== "base64" ||
    typeof payload.content !== "string" ||
    typeof payload.sha !== "string"
  ) {
    throw new Error("pinned source response is not one base64 Git blob");
  }
  const sourceBytes = Buffer.from(payload.content.replace(/\s/gu, ""), "base64");
  if (
    payload.sha !== row.source_blob_oid ||
    gitBlobOid(sourceBytes) !== row.source_blob_oid
  ) {
    throw new Error(`pinned source blob mismatch: ${row.source_path}`);
  }
  if (digest(sourceBytes) !== row.content_sha256) {
    throw new Error(`pinned source digest mismatch: ${row.source_path}`);
  }
  return sourceBytes;
}

export function classifyMigrationBase(base) {
  return base === emptyBaseSha ? "bootstrap" : "ordinary-pr";
}

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

function assertExactChangedSurface(changedPaths, classifiedPaths) {
  assertChangedPathsAreClassified(changedPaths, classifiedPaths);
  const changed = new Set(changedPaths);
  for (const classifiedPath of classifiedPaths) {
    if (!changed.has(classifiedPath)) {
      throw new Error(`classified bootstrap surface is absent: ${classifiedPath}`);
    }
  }
}

function safeTargetPath(relative) {
  if (
    typeof relative !== "string" ||
    relative.length === 0 ||
    relative === "-" ||
    isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.split("/").includes("..")
  ) {
    throw new Error(`unsafe migration target path: ${String(relative)}`);
  }
  const absolute = resolve(rootDirectory, relative);
  if (
    !absolute.startsWith(
      rootDirectory.endsWith(sep) ? rootDirectory : rootDirectory + sep,
    )
  ) {
    throw new Error(`migration target escapes repository: ${relative}`);
  }
  return absolute;
}

async function readRegularTarget(relative) {
  const absolute = safeTargetPath(relative);
  const metadata = await lstat(absolute);
  if (!metadata.isFile()) {
    throw new Error(`migration target is not a regular file: ${relative}`);
  }
  return readFile(absolute);
}

async function assertTargetAbsent(relative) {
  try {
    await lstat(safeTargetPath(relative));
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`excluded target is present: ${relative}`);
}

async function readJson(relative) {
  const bytes = await readFile(path(relative));
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

async function validateSchemas(documents) {
  for (const [schemaPath, documentPath] of schemaDocuments) {
    const schema = (await readJson(schemaPath)).value;
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    const document = documents.get(documentPath).value;
    if (!validate(document)) {
      throw new Error(
        `${documentPath} violates ${schemaPath}: ${JSON.stringify(validate.errors)}`,
      );
    }
  }
}

function assertSameJson(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} does not exactly match selected migration actions`);
  }
}

async function assertActionEvidence(projection, execution, sourceReader) {
  const rows = projection.selected_rows;
  const migrateRows = rows.filter(({ action }) => action === "migrate");
  const rewriteRows = rows.filter(({ action }) => action === "rewrite");
  const excludeRows = rows.filter(({ action }) => action === "exclude");

  const expectedMigrate = [];
  for (const row of migrateRows) {
    const targetBytes = await readRegularTarget(row.target_path_or_surface);
    if (sourceReader) {
      const sourceBytes = await sourceReader(row);
      assertMigratedBytesEqual(sourceBytes, targetBytes, row.target_path_or_surface);
    }
    const targetSha256 = digest(targetBytes);
    const targetBlobOid = gitBlobOid(targetBytes);
    if (targetSha256 !== row.content_sha256 || targetBlobOid !== row.source_blob_oid) {
      throw new Error(
        `migrated target bytes do not match frozen selected source: ${row.target_path_or_surface}`,
      );
    }
    expectedMigrate.push({
      source_repository: row.source_repository,
      source_ref: row.source_ref,
      source_commit: row.source_commit,
      source_path: row.source_path,
      source_blob_oid: row.source_blob_oid,
      source_sha256: `sha256:${row.content_sha256}`,
      target_path: row.target_path_or_surface,
      target_blob_oid: targetBlobOid,
      target_sha256: `sha256:${targetSha256}`,
      verification: "byte_and_blob_equal",
    });
  }
  assertSameJson(
    execution.action_evidence.migrate,
    expectedMigrate,
    "migrate evidence",
  );

  const expectedRewrite = rewriteRows.map((row) => ({
    source_repository: row.source_repository,
    source_ref: row.source_ref,
    source_commit: row.source_commit,
    source_path: row.source_path,
    target_path_or_surface: row.target_path_or_surface,
    source_objective_or_failure_mode: row.source_objective_or_failure_mode,
    replacement_observable_oracle: row.replacement_observable_oracle,
    verification: "observable_oracle_passed",
  }));
  assertSameJson(
    execution.action_evidence.rewrite,
    expectedRewrite,
    "rewrite evidence",
  );

  if (execution.action_evidence.exclude.length !== excludeRows.length) {
    throw new Error("exclude evidence does not exactly bound selected exclusions");
  }
  for (const [index, row] of excludeRows.entries()) {
    const evidence = execution.action_evidence.exclude[index];
    for (const field of [
      "source_repository",
      "source_ref",
      "source_commit",
      "source_path",
    ]) {
      if (evidence[field] !== row[field]) {
        throw new Error("exclude evidence does not identify its selected row");
      }
    }
    for (const checkedTarget of evidence.checked_target_paths) {
      await assertTargetAbsent(checkedTarget);
    }
  }
}

function assertSharedAuthorityHeaders(objective, projection, equality, execution) {
  if (
    objective.target_owner !== targetOwner ||
    projection.target_owner !== targetOwner ||
    equality.target_owner !== targetOwner ||
    execution.target_owner !== targetOwner ||
    objective.task !== taskId ||
    projection.task !== taskId ||
    equality.task !== taskId ||
    execution.task !== taskId ||
    objective.objective !== objectiveName ||
    projection.objective !== objectiveName ||
    equality.objective !== objectiveName ||
    execution.objective !== objectiveName
  ) {
    throw new Error("migration authority headers differ");
  }
}

async function migrationBase() {
  if (process.env.MIGRATION_BASE_SHA) return process.env.MIGRATION_BASE_SHA;
  const { stdout } = await execFileAsync("git", ["merge-base", "HEAD", "origin/main"], {
    cwd: rootDirectory,
  });
  return stdout.trim();
}

async function assertBaseContainsBootstrapAuthority(base) {
  for (const relative of authorityPaths) {
    try {
      const { stdout } = await execFileAsync("git", ["show", `${base}:${relative}`], {
        cwd: rootDirectory,
        encoding: "buffer",
      });
      if (digest(stdout) !== reviewedAuthorityDigests.get(relative)) {
        throw new Error(`base bootstrap authority digest differs: ${relative}`);
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("base bootstrap authority digest differs:")
      ) {
        throw error;
      }
      throw new Error(
        `base does not contain reviewed bootstrap authority: ${relative}`,
      );
    }
  }
}

async function main() {
  const documents = new Map(
    await Promise.all(
      authorityPaths.map(async (relative) => [relative, await readJson(relative)]),
    ),
  );
  const objective = documents.get(authorityPaths[0]);
  const projection = documents.get(authorityPaths[1]);
  const equality = documents.get(authorityPaths[2]);
  const execution = documents.get(authorityPaths[3]);
  const [packageJson, plan, registry, candidate] = await Promise.all([
    readJson("package.json"),
    readFile(path("PLAN.md"), "utf8"),
    readFile(path("src/registry.ts"), "utf8"),
    readFile(path("src/adapters/fake-candidate.ts"), "utf8"),
  ]);

  assertAuthorityDigestsMatch(
    reviewedAuthorityDigests,
    new Map(
      authorityPaths.map((relative) => [
        relative,
        digest(documents.get(relative).bytes),
      ]),
    ),
  );
  await validateSchemas(documents);
  assertSharedAuthorityHeaders(
    objective.value,
    projection.value,
    equality.value,
    execution.value,
  );
  if (
    objective.value.expected_ledger_sha256 !== expectedLedger ||
    projection.value.ledger_sha256 !== expectedLedger ||
    equality.value.ledger_sha256 !== expectedLedger
  ) {
    throw new Error(
      "migration ledger digest does not match frozen workspace authority",
    );
  }
  if (equality.value.generator_sha256 !== expectedGenerator) {
    throw new Error("migration equality receipt uses an unreviewed generator");
  }
  if (equality.value.objective_selection_sha256 !== digest(objective.bytes)) {
    throw new Error("migration equality receipt does not bind objective selection");
  }
  if (equality.value.projection_sha256 !== digest(projection.bytes)) {
    throw new Error("migration equality receipt does not bind exact projection bytes");
  }
  const classificationBytes = Buffer.from(
    canonicalJson({
      target_owner: projection.value.target_owner,
      task: projection.value.task,
      objective: projection.value.objective,
      changed_surface_classification: projection.value.changed_surface_classification,
    }),
  );
  if (
    equality.value.changed_surface_classification_sha256 !== digest(classificationBytes)
  ) {
    throw new Error("migration equality receipt does not bind classification bytes");
  }
  if (execution.value.projection_sha256 !== `sha256:${digest(projection.bytes)}`) {
    throw new Error("execution receipt does not bind exact projection bytes");
  }
  if (execution.value.equality_receipt_sha256 !== `sha256:${digest(equality.bytes)}`) {
    throw new Error("execution receipt does not bind exact equality receipt bytes");
  }
  if (
    execution.value.execution_class !== "fixture_only" ||
    execution.value.oracle !== "local_deterministic_checks"
  ) {
    throw new Error("baseline receipt must remain fixture-only and deterministic");
  }
  const base = await migrationBase();
  const migrationClass = classifyMigrationBase(base);
  if (migrationClass === "ordinary-pr") {
    await assertBaseContainsBootstrapAuthority(base);
  }
  await assertActionEvidence(
    projection.value,
    execution.value,
    migrationClass === "bootstrap" ? readPinnedSource : undefined,
  );

  const calver = readUniqueCalVerField(
    "package.json",
    packageJson.bytes.toString("utf8"),
    /^\s*"version": "([^"]+)",?$/u,
  );
  if (packageJson.value.version !== calver) {
    throw new Error("package.json CalVer source differs from parsed package version");
  }
  if (!isCalVer(calver)) {
    throw new Error(
      "package version must use four-digit-year unpadded calendar CalVer",
    );
  }
  const projections = [
    ["PLAN.md", readUniqueCalVerField("PLAN.md", plan, /^CalVer: `([^`]+)`$/u)],
    [
      "dry-run registry",
      readUniqueCalVerField(
        "dry-run registry",
        registry,
        /^\s*calver: "([^"]+)" as const,$/u,
      ),
    ],
    [
      "candidate receipt fixture",
      readUniqueCalVerField(
        "candidate receipt fixture",
        candidate,
        /^\s*calver: "([^"]+)",$/u,
      ),
    ],
  ];
  for (const [name, projectedCalVer] of projections) {
    if (projectedCalVer !== calver) {
      throw new Error(`${name} CalVer must exactly match package version`);
    }
  }

  if (migrationClass === "ordinary-pr") {
    return;
  }
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMRD", base],
    { cwd: rootDirectory },
  );
  const changedPaths = stdout.split("\n").filter(Boolean);
  const classifiedPaths = new Set(
    projection.value.changed_surface_classification.map(
      ({ target_path_or_surface }) => target_path_or_surface,
    ),
  );
  assertExactChangedSurface(changedPaths, classifiedPaths);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
