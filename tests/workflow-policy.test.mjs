import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

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

test("checked-in author gates admit only maintainers and Dependabot", async () => {
  const quality = await readFile(
    join(repositoryRoot, ".github/workflows/quality.yml"),
    "utf8",
  );
  const boundary = await readFile(
    join(repositoryRoot, ".github/workflows/secret-boundary.yml"),
    "utf8",
  );
  const policy = JSON.parse(
    await readFile(join(repositoryRoot, ".github/merge-policy.json"), "utf8"),
  );
  assert.match(quality, /dependabot\[bot\]/u);
  assert.match(boundary, /dependabot\[bot\]/u);
  assert.match(quality, /github\.actor/u);
  assert.match(quality, /head\.repo\.full_name/u);
  assert.match(boundary, /github\.actor/u);
  assert.match(boundary, /head\.repo\.full_name/u);
  assert.deepEqual(policy.eligible_bot_logins, ["dependabot[bot]"]);
  assert.equal(policy.merge_queue, false);
  assert.doesNotMatch(quality, /COLLABORATOR|CONTRIBUTOR/u);
});

test("maintainer gates bind actor, author, and same-repository head", async () => {
  const quality = parse(
    await readFile(join(repositoryRoot, ".github/workflows/quality.yml"), "utf8"),
  );
  const gate = quality.jobs.eligibility.steps[0].run;
  await assert.rejects(
    () =>
      execFileAsync("bash", ["-euo", "pipefail", "-c", gate], {
        env: {
          ...process.env,
          ACTOR: "different-maintainer",
          AUTHOR_ASSOCIATION: "OWNER",
          BASE_REPOSITORY: "openboa-ai/coffee-chat-eval",
          EVENT_NAME: "pull_request",
          HEAD_REPOSITORY: "attacker/coffee-chat-eval",
          PR_AUTHOR: "pull-request-author",
        },
      }),
    /Command failed/u,
  );
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

test("rejects a future workflow using the alternate YAML extension", async () => {
  await expectRejected(
    (fixture) =>
      writeFile(
        join(fixture, ".github/workflows/future.yaml"),
        "name: Future\non:\n  workflow_dispatch:\npermissions: {}\njobs:\n  future:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    permissions:\n      contents: read\n    steps:\n      - run: 'true'\n",
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
    /author eligibility job contract/u,
  );
});

test("rejects removing maintainer actor and author identity binding", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        '                  test "$ACTOR" = "$PR_AUTHOR"\n',
        "                  true\n",
      ),
    /author eligibility job contract/u,
  );
});

test("rejects removing trusted-boundary maintainer identity binding", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/secret-boundary.yml",
        "      github.actor == github.event.pull_request.user.login &&\n",
        "      github.actor != github.event.pull_request.user.login &&\n",
      ),
    /trusted author boundary/u,
  );
});

test("rejects removing the exact Dependabot identity", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        '              test "$PR_AUTHOR" = "dependabot[bot]"\n',
        "              exit 0\n",
      ),
    /author eligibility job contract/u,
  );
});

test("rejects disabling the author eligibility job", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "    name: author eligibility\n",
        "    name: author eligibility\n    if: ${{ false }}\n",
      ),
    /author eligibility job contract/u,
  );
});

for (const [name, field] of [
  ["conditional", "        if: ${{ false }}\n"],
  ["failure-tolerant", "        continue-on-error: true\n"],
]) {
  test(`rejects a ${name} author eligibility step`, async () => {
    await expectRejected(
      (fixture) =>
        replace(
          fixture,
          ".github/workflows/quality.yml",
          "      - name: Decide author eligibility\n",
          `      - name: Decide author eligibility\n${field}`,
        ),
      /author eligibility job contract/u,
    );
  });
}

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
  }, /exact fail-closed candidate quality steps/u);
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

test("rejects re-enabling a merge-group workflow", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "  pull_request:\n",
        "  pull_request:\n  merge_group:\n",
      ),
    /approved triggers/u,
  );
});

test("rejects a base-ref checkout in candidate quality or Harbor calibration", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "          fetch-depth: 0\n",
        "          fetch-depth: 0\n          ref: ${{ github.event.pull_request.base.sha }}\n",
      ),
    /exact fail-closed candidate quality steps/u,
  );
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "          persist-credentials: false\n      - name: Set up Node.js\n",
        "          persist-credentials: false\n          ref: ${{ github.event.pull_request.base.sha }}\n      - name: Set up Node.js\n",
      ),
    /exact hash-pinned Harbor calibration steps/u,
  );
});

test("rejects conditional required commands and a manufactured aggregate", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        "      - run: npm test\n",
        "      - run: npm test\n        continue-on-error: true\n",
      ),
    /exact fail-closed candidate quality steps/u,
  );
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/workflows/quality.yml",
        '          test "$ELIGIBILITY_RESULT" = success\n          test "$QUALITY_RESULT" = success\n          test "$DEPENDENCY_REVIEW_RESULT" = success\n          test "$HARBOR_CONTRACT_RESULT" = success\n',
        "          true\n",
      ),
    /aggregate contract/u,
  );
});

for (const [name, workflow, step] of [
  [
    "candidate quality",
    ".github/workflows/quality.yml",
    "      - name: Scan complete Git history and worktree\n",
  ],
  [
    "trusted boundary",
    ".github/workflows/secret-boundary.yml",
    "      - name: Scan candidate without executing it\n",
  ],
]) {
  test(`rejects a failure-tolerant ${name} secret scan`, async () => {
    await expectRejected(
      (fixture) =>
        replace(fixture, workflow, step, `${step}        continue-on-error: true\n`),
      /secret scan|trusted boundary/u,
    );
  });
}

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
        "          - version-update:semver-patch\n    groups:\n",
        "          - version-update:semver-patch\n          - version-update:semver-major\n    groups:\n",
      ),
    /major policy/u,
  );
});

test("rejects a Dependabot policy that can suppress major security updates", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/dependabot.yml",
        "    groups:\n",
        '    ignore:\n      - dependency-name: "*"\n        update-types: [version-update:semver-major]\n    groups:\n',
      ),
    /major policy/u,
  );
});

test("rejects removal of the exact CodeQL required check identity", async () => {
  await expectRejected(
    (fixture) =>
      replace(
        fixture,
        ".github/merge-policy.json",
        '"integration_id": 15368',
        '"integration_id": 0',
      ),
    /exact required checks/u,
  );
});

test("rejects removing an exact protected execution path", async () => {
  await expectRejected(
    (fixture) =>
      replace(fixture, ".github/merge-policy.json", '    "src/canary-cli.ts",\n', ""),
    /exact protected paths/u,
  );
});

test("rejects removing the Harbor task and verifier boundary", async () => {
  await expectRejected(
    (fixture) => replace(fixture, ".github/merge-policy.json", '    "evals/**",\n', ""),
    /exact protected paths/u,
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

for (const [script, replacement] of [
  [
    "canary:calibrate",
    "node --experimental-strip-types src/unreviewed-harbor.ts calibrate",
  ],
  [
    "benchmark:calibrate",
    "node --experimental-strip-types src/unreviewed-harbor.ts benchmark-calibrate",
  ],
  [
    "pcda:calibrate",
    "node --experimental-strip-types src/unreviewed-pcda.ts calibrate",
  ],
]) {
  test(`rejects redirecting the ${script} execution entrypoint`, async () => {
    await expectRejected(async (fixture) => {
      const target = join(fixture, "package.json");
      const packageJson = JSON.parse(await readFile(target, "utf8"));
      packageJson.scripts[script] = replacement;
      await writeFile(target, `${JSON.stringify(packageJson, null, 2)}\n`);
    }, /calibration package scripts/u);
  });
}

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

test("documents only the credential-free calibration boundary", async () => {
  const plan = await readFile(join(repositoryRoot, "PLAN.md"), "utf8");
  assert.match(plan, /credential-free Oracle\/no-op Harbor\s+calibration/u);
  assert.doesNotMatch(plan, /exact Coffee Chat commit installed/u);
  assert.doesNotMatch(plan, /public coffee-chat Skill invocation/u);
});
