import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const repository = new URL("..", import.meta.url);

function read(relative: string): string {
  return readFileSync(new URL(relative, repository), "utf8");
}

test("policy check accepts the central trusted workflow shape", () => {
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [".github/ci-policy.mjs"], {
      cwd: repository,
      stdio: "pipe",
    }),
  );
});

test("target CI delegates to one immutable central gate without local execution", () => {
  const wrapper = read(".github/workflows/trusted.yml");
  const controlSha = wrapper.match(
    /uses: openboa-ai\/\.github\/\.github\/workflows\/coffee-trusted-gate\.yml@([0-9a-f]{40})/u,
  )?.[1];
  assert.ok(controlSha);
  assert.match(wrapper, /pull_request_target:/u);
  assert.match(wrapper, new RegExp(`control_sha: ${controlSha}`, "u"));
  assert.doesNotMatch(wrapper, /^\s*run:/mu);
  assert.doesNotMatch(wrapper, /secrets\./u);
});

test("credential-free Harbor calibration remains hash locked", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.["canary:calibrate"],
    "node --experimental-strip-types src/canary-cli.ts calibrate",
  );
  assert.equal(
    packageJson.scripts?.["benchmark:calibrate"],
    "node --experimental-strip-types src/canary-cli.ts benchmark-calibrate",
  );
  assert.equal(
    packageJson.scripts?.["pcda:calibrate"],
    "node --experimental-strip-types src/pcda-cli.ts calibrate --oracle-result $PWD/tests/fixtures/pcda-calibration/oracle-result.json --noop-result $PWD/tests/fixtures/pcda-calibration/noop-result.json",
  );
  assert.match(read(".github/harbor-requirements.txt"), /--hash=sha256:/u);
  assert.doesNotMatch(
    Object.values(packageJson.scripts ?? {}).join("\n"),
    /canary:codex|pcda:codex|OPENAI_API_KEY/u,
  );
});

test("protocol canary image contains no unused online Codex install", () => {
  const dockerfile = read("evals/protocol-canary/environment/Dockerfile");
  assert.doesNotMatch(dockerfile, /@openai\/codex|npm install --global/u);
});

test("credential-bearing candidate execution remains absent until a broker exists", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(Object.hasOwn(packageJson.scripts ?? {}, "pcda:codex"), false);
  for (const source of [
    "src/pcda-bench.ts",
    "src/pcda-harbor.ts",
    "src/pcda-runner.ts",
  ]) {
    assert.equal(existsSync(new URL(source, repository)), false, source);
  }
  for (const document of ["AGENTS.md", "README.md", "SECURITY.md"]) {
    assert.match(read(document), /credential broker|brokered credential/u);
  }
});

test("the shell has no private Coffee Chat package dependency", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(
    Object.hasOwn(packageJson.dependencies ?? {}, "@openboa/coffee-chat"),
    false,
  );
});
