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
  const workflow = read(".github/workflows/quality.yml");
  assert.match(workflow, /OWNER\|MEMBER/u);
  assert.doesNotMatch(workflow, /COLLABORATOR|pull_request\.user\.login/u);
  assert.match(workflow, /quality:\n    name: required\n    needs: eligibility/u);
  assert.match(
    workflow,
    /harbor-contract:\n    name: harbor contract\n    needs: eligibility/u,
  );
  assert.ok(
    workflow.indexOf("name: Decide author eligibility") <
      workflow.indexOf("uses: actions/checkout@"),
  );
});

test("required CI calibrates Harbor tasks without running model evaluation", () => {
  const workflow = read(".github/workflows/quality.yml");

  assert.match(workflow, /npm run canary:check/u);
  assert.match(workflow, /npm run canary:calibrate/u);
  assert.match(workflow, /npm run benchmark:calibrate/u);
  assert.match(workflow, /npm run pcda:calibrate/u);
  assert.doesNotMatch(
    workflow,
    /canary:codex|benchmark:smoke|pcda:codex|OPENAI_API_KEY/u,
  );
});

test("secret scanning uses trusted base controls and never executes candidate code", () => {
  const workflow = read(".github/workflows/secret-boundary.yml");
  assert.match(workflow, /pull_request_target:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /path: trusted/u);
  assert.match(workflow, /path: candidate/u);
  assert.match(workflow, /gitleaks git/u);
  assert.match(workflow, /gitleaks dir/u);
  assert.doesNotMatch(workflow, /npm |node |secrets\./u);
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
