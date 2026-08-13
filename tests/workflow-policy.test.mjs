import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repositoryRoot, ".github/ci-policy.mjs");

async function withFixture(mutate, check) {
  const fixture = await mkdtemp(join(tmpdir(), "eval-workflow-policy-"));
  try {
    await cp(join(repositoryRoot, "package.json"), join(fixture, "package.json"));
    await cp(join(repositoryRoot, ".github"), join(fixture, ".github"), {
      recursive: true,
    });
    await mutate(fixture);
    await check(fixture);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
}

async function replace(fixture, relativePath, from, to) {
  const target = join(fixture, relativePath);
  const source = await readFile(target, "utf8");
  assert.ok(source.includes(from), `fixture source must include ${from}`);
  await writeFile(target, source.replace(from, to));
}

async function runChecker(fixture) {
  try {
    const result = await execFileAsync(process.execPath, [checker], {
      env: { ...process.env, EVAL_CI_POLICY_ROOT: fixture },
    });
    return { output: `${result.stdout}${result.stderr}`, status: 0 };
  } catch (error) {
    const failure = /** @type {{code?: number, stderr?: string, stdout?: string}} */ (
      error
    );
    return {
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      status: failure.code,
    };
  }
}

async function expectRejected(mutate, message) {
  await withFixture(mutate, async (fixture) => {
    const result = await runChecker(fixture);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, message);
  });
}

test("accepts the checked-in workflow policy", async () => {
  const result = await runChecker(repositoryRoot);
  assert.equal(result.status, 0, result.output);
});

test("rejects duplicate YAML mapping keys", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "name: Eval\n",
        "name: Eval\nname: Duplicate Eval\n",
      ),
    /workflow must parse uniquely/u,
  );
});

test("rejects an escaped job-level permission override", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    name: required\n    needs: eligibility\n    runs-on: ubuntu-24.04\n    timeout-minutes: 20\n    permissions:\n      contents: read",
        '    name: required\n    needs: eligibility\n    runs-on: ubuntu-24.04\n    timeout-minutes: 20\n    "permiss\\u0069ons":\n      contents: write',
      ),
    /job permissions/u,
  );
});

test("rejects a flow-style escaped unpinned action", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    steps:\n      - name: Decide author eligibility",
        '    steps:\n      - { "u\\u0073es": actions/checkout@v7 }\n      - name: Decide author eligibility',
      ),
    /unapproved action/u,
  );
});

test("rejects a future workflow", async () => {
  await expectRejected(
    (fixture) =>
      writeFile(
        join(fixture, ".github/workflows/future.yml"),
        "name: Future\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  future:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: 'true'\n",
      ),
    /workflow set/u,
  );
});

test("rejects an escaped pull_request_target trigger", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "  pull_request:\n",
        '  pull_request:\n  "pull_request_targ\\u0065t": {}\n',
      ),
    /approved triggers/u,
  );
});

test("rejects root token permissions", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "permissions: {}",
        "permissions:\n  contents: write",
      ),
    /root permissions/u,
  );
});

test("rejects a missing bounded job timeout", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    timeout-minutes: 20\n",
        "",
      ),
    /bounded timeout/u,
  );
});

test("rejects a weakened candidate author gate", async () => {
  await expectRejected(
    (fixture) =>
      replace(fixture, ".github/workflows/quality.yml", "OWNER|MEMBER", "CONTRIBUTOR"),
    /OWNER\|MEMBER author gate/u,
  );
});

test("rejects a weakened dependency-review threshold", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "          fail-on-severity: moderate\n",
        "          fail-on-severity: critical\n",
      ),
    /dependency-review inputs/u,
  );
});

test("rejects moving the policy gate outside candidate execution", async () => {
  await expectRejected(async (fixture) => {
    await replace(
      fixture,
      ".github/workflows/quality.yml",
      "      - run: npm run ci:policy\n",
      "",
    );
    await replace(
      fixture,
      ".github/workflows/quality.yml",
      "jobs:\n",
      "jobs:\n  auxiliary:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: npm run ci:policy\n\n",
    );
  }, /quality job runs the policy command/u);
});

test("rejects live model execution in required CI", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "      - run: npm run pcda:calibrate\n",
        "      - run: npm run pcda:calibrate\n      - run: npm run pcda:codex\n",
      ),
    /live model execution/u,
  );
});

test("rejects restoring a credential-bearing manual execution command", async () => {
  await expectRejected(async (fixture) => {
    const target = join(fixture, "package.json");
    const packageJson = JSON.parse(await readFile(target, "utf8"));
    packageJson.scripts["pcda:codex"] =
      "node --experimental-strip-types src/pcda-cli.ts codex";
    await writeFile(target, `${JSON.stringify(packageJson, null, 2)}\n`);
  }, /credential-bearing live PCDA command/u);
});

test("rejects restoring a retired live candidate execution module", async () => {
  await expectRejected(async (fixture) => {
    await mkdir(join(fixture, "src"), { recursive: true });
    await writeFile(join(fixture, "src/pcda-runner.ts"), "export {};\n");
  }, /credential-bearing live PCDA module/u);
});

test("rejects an inexact merge-group head reference", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "${{ github.event.merge_group.head_sha }}",
        "${{ github.event.merge_group.head_ref }}",
      ),
    /exact merge-group refs/u,
  );
});

test("rejects removal of the raw Git blob scan", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/secret-boundary.yml",
        '              git -C candidate cat-file blob "$object_id" > "$blob_dir/$object_id"\n',
        "              printf '%s\\n' \"$object_id\" > /dev/null\n",
      ),
    /raw-blob scans/u,
  );
});

test("rejects routine Dependabot major updates", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/dependabot.yml",
        '    ignore:\n      - dependency-name: "*"\n        update-types: [version-update:semver-major]\n',
        "",
      ),
    /major policy/u,
  );
});

test("rejects removal of the CodeQL required context", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/merge-policy.json",
        ',\n    "JavaScript-TypeScript"',
        "",
      ),
    /require JavaScript-TypeScript/u,
  );
});

test("rejects workflow-prefixed required contexts that GitHub does not emit", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/merge-policy.json",
        '"aggregate"',
        '"Eval / aggregate"',
      ),
    /require aggregate/u,
  );
});

test("rejects weakening the package policy command", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        "package.json",
        '"ci:policy": "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs"',
        '"ci:policy": "node -e \\"process.exit(0)\\""',
      ),
    /package command/u,
  );
});

test("documents GitHub-native selective-review auto-merge", async () => {
  const [agentContract, pullRequestTemplate] = await Promise.all([
    readFile(join(repositoryRoot, "AGENTS.md"), "utf8"),
    readFile(join(repositoryRoot, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8"),
  ]);
  assert.match(agentContract, /GitHub-native squash\s+auto-merge/u);
  assert.match(agentContract, /human-only team approval/u);
  assert.match(agentContract, /custom\s+write-token merge automation/u);
  assert.match(pullRequestTemplate, /Sensitive path/u);
  assert.match(pullRequestTemplate, /GitHub-native squash auto-merge/u);
});
