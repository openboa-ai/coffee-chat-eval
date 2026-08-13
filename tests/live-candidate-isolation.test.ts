import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { parseCanaryCliArgs } from "../src/canary-cli.ts";

const root = new URL("../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), "utf8");

test("rejects credential-bearing candidate commands", () => {
  for (const command of ["codex", "benchmark"]) {
    assert.throws(
      () =>
        parseCanaryCliArgs([
          command,
          "--candidate-repo",
          "/tmp/coffee-chat",
          "--candidate-commit",
          "a".repeat(40),
          "--model",
          "gpt-test",
        ]),
      /calibrate\|benchmark-calibrate/u,
    );
  }
});

test("ships no credential-bearing candidate execution surface", () => {
  const packageJson = JSON.parse(read("package.json")) as {
    scripts?: Record<string, string>;
  };
  const cli = read("src/canary-cli.ts");

  assert.equal(packageJson.scripts?.["canary:codex"], undefined);
  assert.equal(packageJson.scripts?.["benchmark:smoke"], undefined);
  assert.equal(
    existsSync(new URL("integrations/harbor/coffee_chat_codex.py", root)),
    false,
  );
  assert.doesNotMatch(cli, /CODEX_FORCE_AUTH_JSON|OPENAI_API_KEY/u);
  assert.doesNotMatch(cli, /candidateRepo|stageCandidate|CoffeeChatCodex/u);
});

test("deterministic calibration tasks default to no network", () => {
  for (const task of ["protocol-canary", "ifeval-smoke"]) {
    const source = read(`evals/${task}/task.toml`);
    assert.match(source, /network_mode = "no-network"/u);
    assert.doesNotMatch(source, /network_mode = "public"/u);
  }
});
