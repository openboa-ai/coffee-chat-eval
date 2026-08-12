import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const hook = join(root, ".githooks", "pre-commit");
const workflow = join(root, ".github", "workflows", "quality.yml");
const installer = join(root, ".github", "scripts", "install-gitleaks.sh");

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

test("local credential files are ignored without hiding the example", () => {
  for (const path of [
    ".env",
    ".env.local",
    "credentials.json",
    "private.pem",
    "private.key",
    "identity.p12",
    "identity.pfx",
    "keystore.jks",
  ]) {
    const result = git(["check-ignore", "--no-index", "--quiet", path], root);
    assert.equal(result.status, 0, `${path} must be ignored`);
  }

  const example = git(["check-ignore", "--no-index", "--quiet", ".env.example"], root);
  assert.notEqual(example.status, 0, ".env.example must remain publishable");
});

test("the repository hook rejects a generated staged secret and redacts output", () => {
  assert.notEqual(statSync(hook).mode & 0o111, 0, "pre-commit must be executable");
  const directory = mkdtempSync(join(tmpdir(), "gitleaks-hook-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: directory });
    execFileSync("git", ["config", "user.name", "Security Test"], {
      cwd: directory,
    });
    execFileSync("git", ["config", "user.email", "security@example.invalid"], {
      cwd: directory,
    });
    writeFileSync(join(directory, "clean.txt"), "public data\n");
    execFileSync("git", ["add", "clean.txt"], { cwd: directory });

    const clean = spawnSync(hook, {
      cwd: directory,
      encoding: "utf8",
      env: process.env,
    });
    assert.equal(clean.status, 0, clean.stderr || clean.stdout);

    const alphabet = "Ab3De6Gh9Jk2Mn5Pq8St1Vw4Yz7";
    const body = Array.from(
      { length: 36 },
      (_, index) => alphabet[(index * 7) % alphabet.length],
    ).join("");
    const generatedCanary = ["ghp", "_", body].join("");
    writeFileSync(join(directory, "credential.txt"), `token = "${generatedCanary}"\n`);
    execFileSync("git", ["add", "credential.txt"], { cwd: directory });

    const rejected = spawnSync(hook, {
      cwd: directory,
      encoding: "utf8",
      env: process.env,
    });
    assert.notEqual(rejected.status, 0, "generated secret must be rejected");
    assert.doesNotMatch(
      `${rejected.stdout}${rejected.stderr}`,
      new RegExp(generatedCanary, "u"),
      "scanner output must redact the generated value",
    );

    const unavailable = spawnSync(hook, {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, GITLEAKS_BIN: "missing-gitleaks-test-binary" },
    });
    assert.notEqual(unavailable.status, 0, "missing scanner must fail closed");
    assert.match(unavailable.stderr, /install Gitleaks/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("required CI installs an immutable scanner and scans complete history", () => {
  const source = readFileSync(workflow, "utf8");
  assert.match(source, /fetch-depth:\s*0/u);
  assert.match(source, /\.github\/scripts\/install-gitleaks\.sh/u);
  assert.match(source, /gitleaks git --redact --no-banner \./u);

  const installSource = readFileSync(installer, "utf8");
  assert.match(installSource, /GITLEAKS_VERSION=8\.30\.1/u);
  assert.match(
    installSource,
    /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/u,
  );
  assert.match(installSource, /sha256sum --check/u);
});
