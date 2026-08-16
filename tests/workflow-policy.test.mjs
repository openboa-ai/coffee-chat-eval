import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repositoryRoot, ".github/ci-policy.mjs");
const CENTRAL_CONTROL_SHA = "4c1d9742f8083a825b94e7d2cfa389eb5930a70e";

async function withFixture(mutate, check) {
  const fixture = await mkdtemp(join(tmpdir(), "eval-policy-"));
  try {
    for (const relativePath of [".github", "package.json", "package-lock.json"]) {
      await cp(join(repositoryRoot, relativePath), join(fixture, relativePath), {
        recursive: true,
      });
    }
    await mutate(fixture);
    await check(fixture);
  } finally {
    await rm(fixture, { force: true, recursive: true });
  }
}

async function runChecker(root) {
  try {
    const result = await execFileAsync(process.execPath, [checker], {
      env: { ...process.env, EVAL_CI_POLICY_ROOT: root },
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

async function expectRejected(name, mutate) {
  await test(name, async () => {
    await withFixture(mutate, async (fixture) => {
      const result = await runChecker(fixture);
      assert.notEqual(result.status, 0, result.output);
    });
  });
}

async function replaceOnce(root, relativePath, before, after) {
  const path = join(root, relativePath);
  const source = await readFile(path, "utf8");
  assert.ok(source.includes(before), `${relativePath}: fixture source missing`);
  await writeFile(path, source.replace(before, after));
}

async function mutateJson(root, relativePath, mutate) {
  const path = join(root, relativePath);
  const value = JSON.parse(await readFile(path, "utf8"));
  mutate(value);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("merge policy binds the trusted aggregate and protected Environment", async () => {
  const mergePolicy = JSON.parse(
    await readFile(join(repositoryRoot, ".github/merge-policy.json"), "utf8"),
  );
  assert.deepEqual(mergePolicy.required_checks, [
    {
      context: "OpenBoa Coffee trusted required / OpenBoa Coffee trusted required",
      integration_id: 15368,
    },
  ]);
  assert.deepEqual(mergePolicy.sensitive_review, {
    enforcement: "github_environment",
    environment: "coffee-security",
    required_approvals: 1,
    prevent_self_review: false,
  });
  for (const protectedPath of [
    "package.json",
    "package-lock.json",
    "src/bench.ts",
    "src/harbor.ts",
    "src/runner.ts",
  ]) {
    assert.ok(
      mergePolicy.protected_paths.includes(protectedPath),
      `${protectedPath} must require the protected Environment`,
    );
  }
});

test("target repository exposes only the exact trusted wrapper", async () => {
  assert.deepEqual(
    (await readdir(join(repositoryRoot, ".github/workflows")))
      .filter((name) => /\.ya?ml$/u.test(name))
      .sort(),
    ["trusted.yml"],
  );
  const wrapper = await readFile(
    join(repositoryRoot, ".github/workflows/trusted.yml"),
    "utf8",
  );
  assert.match(
    wrapper,
    new RegExp(`coffee-trusted-gate\\.yml@${CENTRAL_CONTROL_SHA}`, "u"),
  );
  assert.match(wrapper, new RegExp(`control_sha: ${CENTRAL_CONTROL_SHA}`, "u"));
  const result = await runChecker(repositoryRoot);
  assert.equal(result.status, 0, result.output);
});

await expectRejected("rejects a future yml workflow", async (root) => {
  await writeFile(
    join(root, ".github/workflows/untrusted.yml"),
    "name: untrusted\non: [pull_request]\njobs: {}\n",
  );
});

await expectRejected("rejects a future yaml workflow", async (root) => {
  await writeFile(
    join(root, ".github/workflows/untrusted.yaml"),
    "name: untrusted\non: [pull_request]\njobs: {}\n",
  );
});

await expectRejected("rejects a wrapper SHA and input mismatch", async (root) => {
  const path = join(root, ".github/workflows/trusted.yml");
  const source = await readFile(path, "utf8");
  await writeFile(
    path,
    source.replace(
      /coffee-trusted-gate\.yml@[0-9a-f]{40}/u,
      `coffee-trusted-gate.yml@${"0".repeat(40)}`,
    ),
  );
});

for (const relativePath of [
  ".npmrc",
  "npm-shrinkwrap.json",
  ".github/policy-parser/.npmrc",
  ".github/policy-parser/npm-shrinkwrap.json",
]) {
  await expectRejected(
    `rejects alternate npm authority ${relativePath}`,
    async (root) => {
      const path = join(root, relativePath);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "{}\n");
    },
  );
}

await expectRejected("rejects a package script mutation", async (root) => {
  await mutateJson(root, "package.json", (value) => {
    const scriptName = Object.keys(value.scripts).at(0);
    assert.ok(scriptName);
    value.scripts[scriptName] = "true";
  });
});

await expectRejected("rejects a protected-path policy weakening", async (root) => {
  await mutateJson(root, ".github/merge-policy.json", (value) => {
    value.protected_paths.pop();
  });
});

await expectRejected("rejects a dependency registry redirect", async (root) => {
  await replaceOnce(
    root,
    "package-lock.json",
    "https://registry.npmjs.org/",
    "https://attacker.invalid/",
  );
});

await expectRejected("rejects routine major Dependabot updates", async (root) => {
  await replaceOnce(
    root,
    ".github/dependabot.yml",
    "version-update:semver-minor",
    "version-update:semver-major",
  );
});

await expectRejected("rejects weakened Dependabot security grouping", async (root) => {
  await replaceOnce(
    root,
    ".github/dependabot.yml",
    "applies-to: security-updates",
    "applies-to: version-updates",
  );
});

await expectRejected("bounds Dependabot YAML bytes", async (root) => {
  const path = join(root, ".github/dependabot.yml");
  await writeFile(path, `${await readFile(path, "utf8")}#${"x".repeat(256 * 1024)}\n`);
});

await expectRejected("bounds Dependabot YAML depth", async (root) => {
  const path = join(root, ".github/dependabot.yml");
  let nested = "resource_test:\n";
  for (let depth = 0; depth < 40; depth += 1) {
    nested += `${"  ".repeat(depth + 1)}level_${depth}:\n`;
  }
  nested += `${"  ".repeat(41)}value: bounded\n`;
  await writeFile(path, `${await readFile(path, "utf8")}${nested}`);
});

await expectRejected("bounds Dependabot YAML aliases", async (root) => {
  const path = join(root, ".github/dependabot.yml");
  const aliases = Array.from({ length: 101 }, () => "*resource_anchor").join(", ");
  await writeFile(
    path,
    `${await readFile(path, "utf8")}resource_anchor: &resource_anchor [one, two]\nresource_aliases: [${aliases}]\n`,
  );
});
