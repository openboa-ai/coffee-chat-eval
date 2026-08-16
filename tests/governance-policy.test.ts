import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

test("credential-free Bench Oracle execution remains hash locked", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.["bench:oracle"],
    "node --experimental-strip-types src/cli.ts oracle-control",
  );
  assert.match(read(".github/harbor-requirements.txt"), /--hash=sha256:/u);
  assert.doesNotMatch(
    Object.values(packageJson.scripts ?? {}).join("\n"),
    /OPENAI_API_KEY/u,
  );
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
