import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repository = new URL("..", import.meta.url);
const migrationTask = "task-4-governance-and-deterministic-evaluator-baseline";

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(new URL(relative, repository), "utf8"));
}

function runOrdinaryMigrationCheck(options?: {
  changedPath?: string;
  sourceBytes?: Buffer;
  reportedBlobOid?: string;
}): void {
  const sourceRoot = fileURLToPath(repository);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "coffee-chat-eval-migration-"));
  const fixtureRoot = join(temporaryRoot, "repository");
  const preloadPath = join(temporaryRoot, "source-fetch.mjs");
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
  const sourceBytes =
    options?.sourceBytes ?? readFileSync(new URL("../.gitignore", import.meta.url));
  const reportedBlobOid =
    options?.reportedBlobOid ?? "06c3eac63718c15982a69c6bb19e2466184e6278";
  const expectedUrl =
    "https://api.github.com/repos/SonSangjoon/coffee-chat-eval/contents/.gitignore?ref=1571411f91363dbdfec1aee6b7b5b5709c2289dd";

  try {
    execFileSync("git", ["clone", "--quiet", "--no-local", sourceRoot, fixtureRoot], {
      stdio: "pipe",
    });
    execFileSync("git", ["checkout", "--quiet", "--detach", head], {
      cwd: fixtureRoot,
      stdio: "pipe",
    });
    copyFileSync(
      join(sourceRoot, "scripts/check-migration-receipt.mjs"),
      join(fixtureRoot, "scripts/check-migration-receipt.mjs"),
    );
    symlinkSync(
      join(sourceRoot, "node_modules"),
      join(fixtureRoot, "node_modules"),
      "dir",
    );
    if (options?.changedPath) {
      writeFileSync(join(fixtureRoot, options.changedPath), "unreviewed\n");
      execFileSync("git", ["add", "--", options.changedPath], {
        cwd: fixtureRoot,
        stdio: "pipe",
      });
    }
    writeFileSync(
      preloadPath,
      `const expectedUrl = ${JSON.stringify(expectedUrl)};
globalThis.fetch = async (input) => {
  if (String(input) !== expectedUrl) throw new Error("unexpected pinned source URL");
  return {
    ok: true,
    status: 200,
    json: async () => ({
      type: "file",
      encoding: "base64",
      sha: ${JSON.stringify(reportedBlobOid)},
      content: ${JSON.stringify(sourceBytes.toString("base64"))},
    }),
  };
};
`,
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(preloadPath).href,
        "scripts/check-migration-receipt.mjs",
      ],
      {
        cwd: fixtureRoot,
        env: { ...process.env, MIGRATION_BASE_SHA: head },
        stdio: "pipe",
      },
    );
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
}

test("repository governance validates least-privilege workflows and migration evidence", () => {
  assert.doesNotThrow(() => {
    execFileSync(process.execPath, [".github/ci-policy.mjs"], {
      cwd: new URL("..", import.meta.url),
      stdio: "pipe",
    });
  });
});

test("migration authorities satisfy executable closed JSON schemas", () => {
  assert.doesNotThrow(() =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import assert from "node:assert/strict";
         import { readFileSync } from "node:fs";
         import Ajv2020 from "ajv/dist/2020.js";
         const pairs = ${JSON.stringify([
           [
             ".github/migration-selection.schema.json",
             `docs/migration/selections/${migrationTask}.json`,
           ],
           [
             ".github/migration-equality-receipt.schema.json",
             `docs/migration/equality/${migrationTask}.json`,
           ],
           [
             ".github/migration-receipt.schema.json",
             `docs/migration/receipts/${migrationTask}.json`,
           ],
         ])};
         for (const [schemaPath, documentPath] of pairs) {
           const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
           const document = JSON.parse(readFileSync(documentPath, "utf8"));
           const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
           assert.equal(validate(document), true, JSON.stringify(validate.errors));
         }`,
      ],
      { cwd: repository, stdio: "pipe" },
    ),
  );
});

test("bootstrap receipt binds exact migrate bytes and bounds all selected actions", () => {
  const receipt = readJson(`docs/migration/receipts/${migrationTask}.json`) as Record<
    string,
    unknown
  >;

  assert.deepEqual(receipt.action_evidence, {
    migrate: [
      {
        source_repository: "SonSangjoon/coffee-chat-eval",
        source_ref: "origin/main",
        source_commit: "1571411f91363dbdfec1aee6b7b5b5709c2289dd",
        source_path: ".gitignore",
        source_blob_oid: "06c3eac63718c15982a69c6bb19e2466184e6278",
        source_sha256:
          "sha256:29f81bde2020654cd0ddab07d8988c8d3ad85209f63016c949e7ea4a7a661c4a",
        target_path: ".gitignore",
        target_blob_oid: "06c3eac63718c15982a69c6bb19e2466184e6278",
        target_sha256:
          "sha256:29f81bde2020654cd0ddab07d8988c8d3ad85209f63016c949e7ea4a7a661c4a",
        verification: "byte_and_blob_equal",
      },
    ],
    rewrite: [],
    exclude: [],
  });
});

test("migration policy rejects a changed surface with no pre-PR classification", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'import { assertChangedPathsAreClassified } from "./scripts/check-migration-receipt.mjs"; assertChangedPathsAreClassified(["src/unclassified.ts"], new Set(["src/runner.ts"]));',
        ],
        { cwd: new URL("..", import.meta.url), stdio: "pipe" },
      ),
    /unclassified changed surface/u,
  );
});

test("migration policy rejects authority bytes that do not match the reviewed digests", () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'import { assertAuthorityDigestsMatch } from "./scripts/check-migration-receipt.mjs"; assertAuthorityDigestsMatch(new Map([["docs/migration/a.json", "expected"]]), new Map([["docs/migration/a.json", "actual"]]));',
        ],
        { cwd: new URL("..", import.meta.url), stdio: "pipe" },
      ),
    /reviewed migration authority digest differs/u,
  );
});

test("migration classification is bootstrap-only after immutable authority exists", () => {
  assert.doesNotThrow(() =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        'import assert from "node:assert/strict"; import { classifyMigrationBase } from "./scripts/check-migration-receipt.mjs"; assert.equal(classifyMigrationBase("post-bootstrap-base"), "ordinary-pr");',
      ],
      { cwd: repository, stdio: "pipe" },
    ),
  );
});

test("ordinary migration bases still reject changes outside the active task scope", () => {
  assert.throws(
    () => runOrdinaryMigrationCheck({ changedPath: "unreviewed.txt" }),
    /unclassified changed surface/u,
  );
});

test("migrate evidence rejects spoofed bytes from the pinned source object", () => {
  assert.throws(
    () => runOrdinaryMigrationCheck({ sourceBytes: Buffer.from("spoofed source\n") }),
    /pinned source blob mismatch/u,
  );
});

test("migrate source verification independently rejects a SHA-256 mismatch", () => {
  assert.doesNotThrow(() =>
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import assert from "node:assert/strict";
         import { gitBlobOid, readPinnedSource } from "./scripts/check-migration-receipt.mjs";
         const bytes = Buffer.from("source with a different declared digest\\n");
         const blob = gitBlobOid(bytes);
         const row = {
           source_repository: "example/source",
           source_commit: "a".repeat(40),
           source_path: "source.txt",
           source_blob_oid: blob,
           content_sha256: "0".repeat(64),
         };
         const fakeFetch = async () => ({
           ok: true,
           status: 200,
           json: async () => ({
             type: "file",
             encoding: "base64",
             sha: blob,
             content: bytes.toString("base64"),
           }),
         });
         await assert.rejects(
           () => readPinnedSource(row, fakeFetch),
           /pinned source digest mismatch/u,
         );`,
      ],
      { cwd: repository, stdio: "pipe" },
    ),
  );
});

test("merge policy requires the contexts actually named by Eval workflows", () => {
  const policy = JSON.parse(
    readFileSync(new URL("../.github/merge-policy.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(policy.required_contexts, [
    "Eval / aggregate",
    "Eval / dependency review",
  ]);
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
    "scripts/check-migration-receipt.mjs",
    "src/identity.ts",
    "src/registry.ts",
    "src/report.ts",
    "src/types.ts",
  ]) {
    assert.equal(protectedPaths.has(protectedPath), true, protectedPath);
  }

  const codeowners = readFileSync(new URL(".github/CODEOWNERS", repository), "utf8");
  for (const ownedPath of [
    "/LICENSE",
    "/package.json",
    "/package-lock.json",
    "/scripts/check-migration-receipt.mjs",
    "/src/identity.ts",
    "/src/registry.ts",
    "/src/report.ts",
    "/src/types.ts",
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

test("quality CI supplies a merge-base to the change-aware migration check", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/quality.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /MIGRATION_BASE_SHA:/u);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/u);
  assert.match(workflow, /github\.event\.merge_group\.base_sha/u);
  assert.doesNotMatch(workflow, /MIGRATION_AUTHORITY_SHA/u);
  assert.match(workflow, /needs\.dependency-review\.result/u);
  assert.match(workflow, /^name: Eval$/mu);
  assert.match(workflow, /name: required/u);
  assert.match(workflow, /name: dependency review/u);
});

test("coverage CI uploads same-repository Cobertura evidence to GitHub", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/github-coverage.yml", import.meta.url),
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
