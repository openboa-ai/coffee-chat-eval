import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const repository = new URL("..", import.meta.url);

function read(relative: string): string {
  return readFileSync(new URL(relative, repository), "utf8");
}

test("policy check accepts the lean protected workflow shape", () => {
  assert.doesNotThrow(() =>
    execFileSync(process.execPath, [".github/ci-policy.mjs"], {
      cwd: repository,
      stdio: "pipe",
    }),
  );
});

test("candidate workflows admit only owners or members before checkout", () => {
  for (const workflowPath of [
    ".github/workflows/quality.yml",
    ".github/workflows/policy.yml",
  ]) {
    const workflow = read(workflowPath);
    assert.match(workflow, /OWNER\|MEMBER/u);
    assert.doesNotMatch(workflow, /COLLABORATOR|pull_request\.user\.login/u);
    assert.ok(
      workflow.indexOf("Verify trusted pull request author") <
        workflow.indexOf("uses: actions\/checkout@"),
    );
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
