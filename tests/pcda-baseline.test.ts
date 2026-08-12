import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  attestAndJudgeWithStagedBench,
  projectPcdaFamily,
  stageBenchSnapshot,
  type BenchSnapshot,
  type ProjectedPcdaCondition,
} from "../src/pcda-bench.ts";
import {
  buildPcdaHarborArgs,
  executePcdaSpawn,
  resolveUvxTool,
  type CandidateCredentialMetadata,
  type PcdaHarborInput,
  type UvxTrustPolicy,
} from "../src/pcda-harbor.ts";
import {
  authorizeCombinedBudget,
  buildPcdaFailureReceipt,
  buildUnsignedPcdaAttestation,
  buildPcdaCampaignReceipt,
  calibratePcdaNativeResults,
  parsePcdaNativeResult,
} from "../src/pcda-receipt.ts";
import { runPcdaCli } from "../src/pcda-cli.ts";
import { candidateSettledNanoUsd, debitJudgeCost } from "../src/pcda-runner.ts";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const canonicalTemporaryRoot = realpathSync(tmpdir());
const SECRET_CANARY = "sk-task1-must-never-serialize-canary";

function assertRecursivelyExcludes(value: unknown, forbidden: string): void {
  if (typeof value === "string") {
    assert.equal(value.includes(forbidden), false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => assertRecursivelyExcludes(entry, forbidden));
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach((entry) =>
      assertRecursivelyExcludes(entry, forbidden),
    );
  }
}

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(join(canonicalTemporaryRoot, prefix));
}

function fakeUvx(root: string, name = "uvx", version = "uvx 0.8.3"): string {
  const path = join(root, name);
  writeFileSync(
    path,
    `#!/bin/sh
if [ -n "\${OPENAI_API_KEY:-}" ] || [ -n "\${CODEX_HOME:-}" ]; then
  exit 71
fi
printf '%s\\n' '${version}'
`,
    "utf8",
  );
  chmodSync(path, 0o700);
  return path;
}

function uvxTrustPolicy(path: string, expectedVersion = "uvx 0.8.3"): UvxTrustPolicy {
  return Object.freeze({
    expectedDigest: `sha256:${createHash("sha256")
      .update(readFileSync(path))
      .digest("hex")}`,
    expectedVersion,
  }) as UvxTrustPolicy;
}

const UNMATCHED_UVX_POLICY = Object.freeze({
  expectedDigest: `sha256:${"0".repeat(64)}`,
  expectedVersion: "uvx 0.8.3",
}) as UvxTrustPolicy;

function runGit(repository: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  }).trim();
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createBenchRepository(): {
  readonly repository: string;
  readonly commit: string;
  readonly projectionInvocationLog: string;
} {
  const repository = temporaryDirectory("pcda-bench-fixture-");
  const projectionInvocationLog = `${repository}-projection-invocations.log`;
  mkdirSync(join(repository, "src"));
  for (const partition of ["development", "calibration", "release", "bridge"]) {
    mkdirSync(join(repository, "bank", "campaign", partition), { recursive: true });
  }

  writeJson(join(repository, "package.json"), {
    name: "pcda-bench-fixture",
    private: true,
    version: "2026.8.12",
    type: "module",
    scripts: {
      preinstall:
        "node -e \"require('node:fs').writeFileSync('preinstall-ran.txt','executed')\"",
    },
  });
  writeJson(join(repository, "package-lock.json"), {
    name: "pcda-bench-fixture",
    version: "2026.8.12",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "pcda-bench-fixture",
        version: "2026.8.12",
        hasInstallScript: true,
      },
    },
  });
  writeJson(join(repository, "bank", "campaign", "campaign.json"), {
    release: "2026.8.12",
    selectedBankDigest: `sha256:${"5".repeat(64)}`,
    auditState: "valid",
  });
  writeJson(join(repository, "bank", "campaign", "development", "case.json"), {
    release: "2026.8.12",
    caseId: "case-fixture-001",
    sourceDigest: `sha256:${"4".repeat(64)}`,
    perspectives: {
      A: { id: "perspective-a", content: "Prefer rapid feedback." },
      B: { id: "perspective-b", content: "Prefer stronger assurance." },
    },
  });
  for (const [name, fixtureMutationTarget, fixtureMalformedOutput] of [
    ["mutate-source", "src/cli.ts", false],
    ["mutate-dependency", "package-lock.json", true],
  ] as const) {
    writeJson(join(repository, "bank", "campaign", "development", `${name}.json`), {
      release: "2026.8.12",
      caseId: `case-fixture-${name}`,
      sourceDigest: `sha256:${"4".repeat(64)}`,
      perspectives: {
        A: { id: "perspective-a", content: "Prefer rapid feedback." },
        B: { id: "perspective-b", content: "Prefer stronger assurance." },
      },
      fixtureInvocationLog: projectionInvocationLog,
      fixtureMutationTarget,
      fixtureMalformedOutput,
    });
  }

  writeFileSync(
    join(repository, "src", "cli.ts"),
    `import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const digest = (character) => \`sha256:\${character.repeat(64)}\`;
const json = (path, value) => writeFileSync(path, \`\${JSON.stringify(value, null, 2)}\\n\`, "utf8");
const [command, first, second, third] = process.argv.slice(2);

if (command === "validate" && first) {
  const partition = basename(resolve(first));
  const valid = ["development", "calibration", "release", "bridge"].includes(partition);
  process.stdout.write(JSON.stringify({
    state: valid ? "valid" : "invalid",
    digest: digest(partition === "development" ? "a" : partition === "calibration" ? "b" : partition === "release" ? "c" : "d"),
    files: valid ? [] : [{ file: "campaign.json", state: "invalid", errors: ["not a case"] }],
  }) + "\\n");
  if (!valid) process.exitCode = 1;
} else if (command === "project" && first && second && third) {
  const conditionLabels = { none: "T0", a: "T1-A", b: "T1-B" };
  const characters = { none: "1", a: "2", b: "3" };
  const label = conditionLabels[second];
  const character = characters[second];
  if (!label || !character) throw new Error("unsupported condition");
  const source = JSON.parse(readFileSync(first, "utf8"));
  if (source.fixtureInvocationLog) {
    appendFileSync(source.fixtureInvocationLog, second + "\\n", "utf8");
  }
  const root = resolve(third);
  const candidateDirectory = join(root, "candidate");
  const verifierDirectory = join(root, "verifier");
  const harborDirectory = join(root, "harbor");
  const trialId = \`trial-\${character.repeat(64)}\`;
  mkdirSync(candidateDirectory, { recursive: true });
  mkdirSync(verifierDirectory, { recursive: true });
  mkdirSync(join(harborDirectory, "environment", "input"), { recursive: true });
  mkdirSync(join(harborDirectory, "tests"), { recursive: true });
  const candidateFiles = {
    "task.json": { caseId: source.caseId, condition: label, trialId },
    "evidence.json": { evidence: [{ ref: "fixture-evidence" }] },
    "output-contract.json": { outputPath: "/app/output.json" },
  };
  if (second !== "none") candidateFiles["perspective.json"] = source.perspectives[second === "a" ? "A" : "B"];
  for (const [file, value] of Object.entries(candidateFiles)) {
    json(join(candidateDirectory, file), value);
    json(join(harborDirectory, "environment", "input", file), value);
  }
  json(join(verifierDirectory, "judgment.json"), { acceptedRegions: ["sealed"] });
  json(join(verifierDirectory, "oracle.json"), { answer: "sealed" });
  json(join(harborDirectory, "tests", "judgment.json"), { acceptedRegions: ["sealed"] });
  writeFileSync(join(harborDirectory, "instruction.md"), "Produce /app/output.json.\\n", "utf8");
  writeFileSync(
    join(harborDirectory, "environment", "Dockerfile"),
    "FROM python:3.13-alpine\\nWORKDIR /app\\nCOPY input/ /app/\\n",
    "utf8",
  );
  writeFileSync(join(harborDirectory, "tests", "Dockerfile"), "FROM scratch\\n", "utf8");
  writeFileSync(join(harborDirectory, "tests", "test.sh"), "#!/bin/sh\\nexit 0\\n", "utf8");
  writeFileSync(join(harborDirectory, "tests", "verifier.py"), "raise SystemExit(0)\\n", "utf8");
  writeFileSync(join(harborDirectory, "task.toml"), [
    "schema_version = \\\"1.4\\\"",
    "artifacts = [\\\"/app/output.json\\\"]",
    "",
    "[task]",
    "name = \\\"openboa-ai/pcda-case-projection\\\"",
    "",
    "[agent]",
    "network_mode = \\\"no-network\\\"",
    "",
    "[verifier]",
    "environment_mode = \\\"separate\\\"",
    "",
    "[environment]",
    "network_mode = \\\"no-network\\\"",
    "",
    "[verifier.environment]",
    "network_mode = \\\"no-network\\\"",
    "",
  ].join("\\n"), "utf8");
  const report = {
    release: "2026.8.12",
    caseId: source.caseId,
    condition: second,
    sourceDigest: source.sourceDigest,
    candidateDirectory,
    verifierDirectory,
    harborDirectory,
    candidateDigest: digest(character),
    verifierDigest: digest("6"),
    projectionDigest: digest(character === "1" ? "7" : character === "2" ? "8" : "9"),
  };
  json(join(root, "projection.json"), report);
  if (second === "none" && source.fixtureMutationTarget) {
    appendFileSync(resolve(source.fixtureMutationTarget), "\\n// fixture mutation\\n", "utf8");
  }
  process.stdout.write(source.fixtureMalformedOutput ? "not-json\\n" : JSON.stringify(report) + "\\n");
} else {
  process.stdout.write(JSON.stringify({ state: "invalid" }) + "\\n");
  process.exitCode = 1;
}
`,
    "utf8",
  );

  execFileSync("git", ["init", "-b", "main", repository]);
  runGit(repository, ["config", "user.name", "PCDA fixture"]);
  runGit(repository, ["config", "user.email", "pcda-fixture@example.invalid"]);
  runGit(repository, ["add", "."]);
  runGit(repository, ["commit", "-m", "fixture"]);
  return {
    repository,
    commit: runGit(repository, ["rev-parse", "HEAD"]),
    projectionInvocationLog,
  };
}

test("stageBenchSnapshot requires an exact reachable clean commit and a fresh destination", () => {
  const fixture = createBenchRepository();
  const root = temporaryDirectory("pcda-stage-test-");

  assert.throws(
    () =>
      stageBenchSnapshot({
        repo: fixture.repository,
        commit: fixture.commit.slice(0, 12),
        destination: join(root, "short"),
      }),
    /40-character lowercase commit/u,
  );
  assert.throws(
    () =>
      stageBenchSnapshot({
        repo: fixture.repository,
        commit: "f".repeat(40),
        destination: join(root, "missing"),
      }),
    /requested commit/u,
  );
  const tree = runGit(fixture.repository, ["write-tree"]);
  const unreachable = execFileSync(
    "git",
    ["-C", fixture.repository, "commit-tree", tree],
    { encoding: "utf8", input: "unreachable fixture\n" },
  ).trim();
  assert.throws(
    () =>
      stageBenchSnapshot({
        repo: fixture.repository,
        commit: unreachable,
        destination: join(root, "unreachable"),
      }),
    /not reachable/u,
  );

  writeFileSync(join(fixture.repository, "dirty.txt"), "dirty\n", "utf8");
  assert.throws(
    () =>
      stageBenchSnapshot({
        repo: fixture.repository,
        commit: fixture.commit,
        destination: join(root, "dirty"),
      }),
    /clean/u,
  );
  runGit(fixture.repository, ["clean", "-f", "dirty.txt"]);

  const destination = join(root, "snapshot");
  stageBenchSnapshot({ repo: fixture.repository, commit: fixture.commit, destination });
  assert.throws(
    () =>
      stageBenchSnapshot({
        repo: fixture.repository,
        commit: fixture.commit,
        destination,
      }),
    /destination must not exist/u,
  );
});

test("stageBenchSnapshot binds stable archive, bank, release, and commit identities", () => {
  const fixture = createBenchRepository();
  const root = temporaryDirectory("pcda-stage-identity-");
  const first = stageBenchSnapshot({
    repo: fixture.repository,
    commit: fixture.commit,
    destination: join(root, "first"),
  });
  const second = stageBenchSnapshot({
    repo: fixture.repository,
    commit: fixture.commit,
    destination: join(root, "second"),
  });

  assert.equal(first.commit, fixture.commit);
  assert.equal(first.release, "2026.8.12");
  assert.equal(first.bankDigest, `sha256:${"5".repeat(64)}`);
  assert.match(first.archiveDigest, DIGEST_PATTERN);
  assert.match(first.stagedTreeDigest, DIGEST_PATTERN);
  assert.equal(second.archiveDigest, first.archiveDigest);
  assert.equal(second.bankDigest, first.bankDigest);
  assert.equal(second.stagedTreeDigest, first.stagedTreeDigest);
  assert.equal(existsSync(join(first.root, "preinstall-ran.txt")), false);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.getOwnPropertySymbols(first).length, 1);
  assert.deepEqual(Object.keys(first).sort(), [
    "archiveDigest",
    "bankDigest",
    "commit",
    "release",
    "root",
    "stagedTreeDigest",
  ]);
});

test("projectPcdaFamily rejects forged or mutated staged Bench capabilities", () => {
  const fixture = createBenchRepository();
  const root = temporaryDirectory("pcda-stage-authority-");
  const snapshot = stageBenchSnapshot({
    repo: fixture.repository,
    commit: fixture.commit,
    destination: join(root, "snapshot"),
  });
  const project = (name: string, candidate: BenchSnapshot = snapshot) =>
    projectPcdaFamily({
      snapshot: candidate,
      casePath: "bank/campaign/development/case.json",
      destination: join(root, name),
    });

  assert.throws(
    () => project("forged", { ...snapshot } as unknown as BenchSnapshot),
    /stageBenchSnapshot/u,
  );

  const cli = join(snapshot.root, "src", "cli.ts");
  const originalBytes = readFileSync(cli);
  const originalMode = lstatSync(cli).mode & 0o7777;

  writeFileSync(cli, Buffer.concat([originalBytes, Buffer.from("// tamper\n")]));
  assert.throws(() => project("byte-tamper"), /staged tree digest/u);
  writeFileSync(cli, originalBytes);

  const added = join(snapshot.root, "added.txt");
  writeFileSync(added, "added\n", "utf8");
  assert.throws(() => project("add-tamper"), /staged tree digest/u);
  rmSync(added);

  rmSync(cli);
  assert.throws(() => project("delete-tamper"), /staged tree digest/u);
  writeFileSync(cli, originalBytes);
  chmodSync(cli, originalMode);

  chmodSync(cli, 0o600);
  assert.throws(() => project("mode-tamper"), /staged tree digest/u);
  chmodSync(cli, originalMode);

  const link = join(snapshot.root, "staged-link");
  symlinkSync(cli, link);
  assert.throws(() => project("symlink-tamper"), /staged tree digest/u);
  rmSync(link);

  assert.equal(project("valid").length, 3);

  const sourceMutation = join(fixture.repository, "untracked-after-stage.txt");
  writeFileSync(sourceMutation, "changed provenance\n", "utf8");
  assert.throws(() => project("source-provenance-tamper"), /clean/u);
  rmSync(sourceMutation);
});

test("projectPcdaFamily distrusts projection output when its Bench process mutates the staged tree", () => {
  for (const caseName of ["mutate-source", "mutate-dependency"] as const) {
    const fixture = createBenchRepository();
    const root = temporaryDirectory(`pcda-stage-process-${caseName}-`);
    const snapshot = stageBenchSnapshot({
      repo: fixture.repository,
      commit: fixture.commit,
      destination: join(root, "snapshot"),
    });
    const destination = join(root, "projected");

    assert.throws(
      () =>
        projectPcdaFamily({
          snapshot,
          casePath: `bank/campaign/development/${caseName}.json`,
          destination,
        }),
      /staged tree digest/u,
    );
    assert.deepEqual(
      readFileSync(fixture.projectionInvocationLog, "utf8").trim().split("\n"),
      ["none"],
    );
    assert.equal(existsSync(join(destination, "t1-a")), false);
  }
});

test("staging and projection return realpath-canonical paths from caller aliases", () => {
  const fixture = createBenchRepository();
  const callerRoot = mkdtempSync(join(tmpdir(), "pcda-caller-alias-"));
  const snapshotDestination = join(callerRoot, "snapshot");
  const snapshot = stageBenchSnapshot({
    repo: fixture.repository,
    commit: fixture.commit,
    destination: snapshotDestination,
  });
  assert.equal(snapshot.root, realpathSync(snapshotDestination));

  const projectionDestination = join(callerRoot, "projected");
  const projections = projectPcdaFamily({
    snapshot,
    casePath: "bank/campaign/development/case.json",
    destination: projectionDestination,
  });
  for (const projection of projections) {
    assert.equal(projection.projectionRoot, realpathSync(projection.projectionRoot));
    assert.equal(projection.taskPath, realpathSync(projection.taskPath));
    assert.equal(projection.taskTomlPath, realpathSync(projection.taskTomlPath));
    if (projection.perspectivePath !== null) {
      assert.equal(
        projection.perspectivePath,
        realpathSync(projection.perspectivePath),
      );
    }
  }
});

test("projectPcdaFamily projects exactly T0, T1-A, and T1-B without sealed candidate data", () => {
  const fixture = createBenchRepository();
  const root = temporaryDirectory("pcda-project-");
  const snapshot = stageBenchSnapshot({
    repo: fixture.repository,
    commit: fixture.commit,
    destination: join(root, "snapshot"),
  });
  const projected = projectPcdaFamily({
    snapshot,
    casePath: "bank/campaign/development/case.json",
    destination: join(root, "projected"),
  });

  assert.deepEqual(
    projected.map(({ benchCondition, condition }) => ({ benchCondition, condition })),
    [
      { benchCondition: "none", condition: "T0" },
      { benchCondition: "a", condition: "T1-A" },
      { benchCondition: "b", condition: "T1-B" },
    ],
  );
  for (const condition of projected) {
    assert.equal(condition.benchCommit, fixture.commit);
    assert.equal(condition.bankDigest, snapshot.bankDigest);
    assert.equal(condition.archiveDigest, snapshot.archiveDigest);
    assert.equal(condition.release, "2026.8.12");
    assert.equal(condition.caseSourceDigest, `sha256:${"4".repeat(64)}`);
    assert.match(condition.candidateDigest, DIGEST_PATTERN);
    assert.match(condition.verifierDigest, DIGEST_PATTERN);
    assert.match(condition.projectionDigest, DIGEST_PATTERN);
    assert.match(condition.executionTreeDigest, DIGEST_PATTERN);
    assert.match(condition.trialId, /^trial-[0-9a-f]{64}$/u);
    assert.equal(condition.taskPath, join(condition.projectionRoot, "harbor"));
    assert.equal(condition.taskTomlPath, join(condition.taskPath, "task.toml"));
    assert.equal(condition.taskPath.endsWith("/harbor"), true);
    assert.deepEqual(condition.candidateForbiddenFindings, []);
  }

  const t0 = projected[0];
  const t1a = projected[1];
  const t1b = projected[2];
  assert.ok(t0);
  assert.ok(t1a);
  assert.ok(t1b);
  assert.equal(t0.perspectivePath, null);
  assert.equal(
    JSON.parse(readFileSync(t1a.perspectivePath!, "utf8")).id,
    "perspective-a",
  );
  assert.equal(
    JSON.parse(readFileSync(t1b.perspectivePath!, "utf8")).id,
    "perspective-b",
  );
});

function projectedFixture(condition: "T0" | "T1-A" | "T1-B" = "T1-A"): {
  readonly root: string;
  readonly snapshot: ReturnType<typeof stageBenchSnapshot>;
  readonly projection: ProjectedPcdaCondition;
  readonly uvxPath: string;
} {
  const fixture = createBenchRepository();
  const root = temporaryDirectory("pcda-harbor-");
  const snapshot = stageBenchSnapshot({
    repo: fixture.repository,
    commit: fixture.commit,
    destination: join(root, "snapshot"),
  });
  const projections = projectPcdaFamily({
    snapshot,
    casePath: "bank/campaign/development/case.json",
    destination: join(root, "projected"),
  });
  const projection = projections.find((entry) => entry.condition === condition);
  assert.ok(projection);
  return { root, snapshot, projection, uvxPath: fakeUvx(root) };
}

function readyInput(fixture: ReturnType<typeof projectedFixture>): PcdaHarborInput {
  return {
    projection: fixture.projection,
    uvxTool: resolveUvxTool(fixture.uvxPath, uvxTrustPolicy(fixture.uvxPath)),
    candidateProviderHost: "api.openai.com",
    candidateModel: "gpt-5.6-terra",
    dockerHost: "unix:///tmp/coffee-chat-docker.sock",
    jobsRoot: join(fixture.root, "jobs"),
    candidateCredential: {
      available: true,
      source: "saved-openai-api-key",
      authorization: "candidate-and-judge",
    },
  };
}

test("buildPcdaHarborArgs maps only the explicit candidate key into a phase-bounded native launch", () => {
  const fixture = projectedFixture();
  const ambientCanaries = {
    OPENAI_API_KEY: SECRET_CANARY,
    COFFEE_CHAT_EVAL_ATTESTATION_KEY: "attestation-canary",
    CODEX_HOME: "/host/codex",
    HOME: "/host/home",
    ANTHROPIC_API_KEY: "anthropic-canary",
    GOOGLE_API_KEY: "google-canary",
    AWS_ACCESS_KEY_ID: "aws-canary",
  };
  const originals = Object.fromEntries(
    Object.keys(ambientCanaries).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, ambientCanaries);

  let launch: ReturnType<typeof buildPcdaHarborArgs>;
  try {
    launch = buildPcdaHarborArgs({
      ...readyInput(fixture),
    });
  } finally {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  assert.equal(launch.state, "ready");
  if (launch.state !== "ready") return;
  assert.equal(launch.command, fixture.uvxPath);
  assert.deepEqual(launch.uvx, {
    path: fixture.uvxPath,
    observedDigest: launch.uvx.observedDigest,
    observedVersion: "uvx 0.8.3",
    policyDigest: launch.uvx.observedDigest,
    policyVersion: "uvx 0.8.3",
  });
  assert.match(launch.uvx.observedDigest, DIGEST_PATTERN);
  assert.deepEqual(launch.args.slice(0, 14), [
    "--from",
    "harbor==0.21.0",
    "harbor",
    "run",
    "--path",
    fixture.projection.taskPath,
    "--agent",
    "codex",
    "--model",
    "gpt-5.6-terra",
    "--agent-kwarg",
    "version=0.147.0",
    "--env",
    "docker",
  ]);
  assert.equal(launch.args.includes("--n-concurrent"), true);
  assert.equal(launch.args.includes("--agent-kwarg"), true);
  assert.equal(
    launch.args[launch.args.indexOf("--agent-kwarg") + 1],
    "version=0.147.0",
  );
  assert.equal(launch.args[launch.args.indexOf("--n-concurrent") + 1], "1");
  assert.equal(launch.args.includes("--yes"), true);
  assert.equal(launch.args.includes("--quiet"), true);
  assert.equal(Object.hasOwn(launch.environmentTemplate, "OPENAI_API_KEY"), false);
  assert.equal(launch.environmentTemplate.HOME, join(launch.jobDirectory, "home"));
  assert.equal(
    launch.environmentTemplate.XDG_CONFIG_HOME,
    join(launch.jobDirectory, "config"),
  );
  assert.equal(
    launch.environmentTemplate.PATH,
    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
  );
  assert.equal(
    launch.environmentTemplate.DOCKER_HOST,
    "unix:///tmp/coffee-chat-docker.sock",
  );
  assert.equal(
    launch.environmentTemplate.DOCKER_CONFIG,
    join(launch.jobDirectory, "docker-config"),
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(launch.environmentTemplate.DOCKER_CONFIG, "config.json"),
        "utf8",
      ),
    ),
    {
      cliPluginsExtraDirs: ["/opt/homebrew/lib/docker/cli-plugins"],
    },
  );
  assert.deepEqual(launch.credentialBinding, {
    childVariable: "OPENAI_API_KEY",
    source: "saved-openai-api-key",
    authorization: "candidate-and-judge",
  });
  for (const forbidden of Object.keys(ambientCanaries)) {
    if (forbidden === "HOME" || forbidden === "OPENAI_API_KEY") continue;
    assert.equal(Object.hasOwn(launch.environmentTemplate, forbidden), false);
  }
  assert.equal(Object.values(launch.environmentTemplate).includes("/host/home"), false);
  assertRecursivelyExcludes(launch, SECRET_CANARY);
  assert.equal(JSON.stringify(launch).includes(SECRET_CANARY), false);
  assert.equal(
    launch.args.filter((argument) => argument === "--allow-agent-host").length,
    1,
  );
  assert.equal(
    launch.args[launch.args.indexOf("--allow-agent-host") + 1],
    "api.openai.com",
  );
  const setupHosts = launch.args.flatMap((argument, index) =>
    argument === "--allow-environment-host" ? [launch.args[index + 1]!] : [],
  );
  assert.deepEqual(setupHosts, [
    "snapshot.debian.org",
    "raw.githubusercontent.com",
    "nodejs.org",
    "registry.npmjs.org",
  ]);
  assert.equal(launch.args.includes("public"), false);
  assert.equal(launch.args.includes("--network"), false);
  assert.equal(
    launch.args.filter((argument) => argument === "--allow-environment-host").length,
    4,
  );
  assert.deepEqual(launch.network, {
    networkBaseline: "no-network",
    setupAllowlist: [
      "snapshot.debian.org",
      "raw.githubusercontent.com",
      "nodejs.org",
      "registry.npmjs.org",
    ],
    agentAllowlist: ["api.openai.com"],
    verifierNetwork: "no-network",
  });

  const second = buildPcdaHarborArgs(readyInput(fixture));
  assert.equal(second.state, "ready");
  if (second.state === "ready") {
    assert.notEqual(second.jobDirectory, launch.jobDirectory);
  }
});

test("every serializable Task 1 result excludes ambient credential bytes", () => {
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.OPENAI_API_KEY = SECRET_CANARY;
  process.env.CODEX_HOME = "/ambient/codex";
  let fixture: ReturnType<typeof projectedFixture>;
  let input: PcdaHarborInput;
  let launch: ReturnType<typeof buildPcdaHarborArgs>;
  try {
    fixture = projectedFixture();
    input = readyInput(fixture);
    launch = buildPcdaHarborArgs(input);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
  for (const evidence of [
    fixture.snapshot,
    fixture.projection,
    input.uvxTool,
    launch,
  ]) {
    assertRecursivelyExcludes(evidence, SECRET_CANARY);
    assert.equal(JSON.stringify(evidence).includes(SECRET_CANARY), false);
  }
});

test("buildPcdaHarborArgs requires an explicit key and accepts authorized shared-key reuse", () => {
  const fixture = projectedFixture("T0");
  const { candidateCredential: _candidateCredential, ...withoutCredential } =
    readyInput(fixture);

  assert.deepEqual(buildPcdaHarborArgs(withoutCredential), {
    state: "unavailable",
    reason: "candidate credential was not supplied",
  });
  assert.throws(
    () =>
      buildPcdaHarborArgs({
        ...withoutCredential,
        candidateCredential: {
          available: true,
          source: "ambient-openai-api-key",
          authorization: "candidate-and-judge",
        } as unknown as CandidateCredentialMetadata,
      }),
    /ambient/u,
  );
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = SECRET_CANARY;
  let shared: ReturnType<typeof buildPcdaHarborArgs>;
  try {
    shared = buildPcdaHarborArgs({
      ...withoutCredential,
      candidateCredential: {
        available: true,
        source: "saved-openai-api-key",
        authorization: "candidate-and-judge",
      },
    });
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
  assert.equal(shared.state, "ready");
  if (shared.state === "ready") {
    assertRecursivelyExcludes(shared, SECRET_CANARY);
    assert.equal(JSON.stringify(shared).includes(SECRET_CANARY), false);
  }
});

test("resolveUvxTool validates a secret-free owned immutable uvx executable", () => {
  const fixture = projectedFixture();
  assert.throws(() => resolveUvxTool("uvx", UNMATCHED_UVX_POLICY), /absolute uvxPath/u);

  const nonExecutable = join(fixture.root, "uvx-no-exec");
  writeFileSync(nonExecutable, "#!/bin/sh\n", "utf8");
  assert.throws(
    () => resolveUvxTool(nonExecutable, UNMATCHED_UVX_POLICY),
    /executable regular file/u,
  );

  const linkedExecutable = join(fixture.root, "uvx-link");
  symlinkSync(fixture.uvxPath, linkedExecutable);
  assert.throws(
    () => resolveUvxTool(linkedExecutable, UNMATCHED_UVX_POLICY),
    /symbolic link/u,
  );

  const executableDirectory = join(fixture.root, "uvx-real-parent");
  mkdirSync(executableDirectory);
  const nestedExecutable = fakeUvx(executableDirectory, "nested-uvx");
  const linkedDirectory = join(fixture.root, "uvx-linked-parent");
  symlinkSync(executableDirectory, linkedDirectory);
  assert.throws(
    () =>
      resolveUvxTool(
        join(linkedDirectory, nestedExecutable.split("/").at(-1)!),
        UNMATCHED_UVX_POLICY,
      ),
    /symbolic link/u,
  );

  const writable = fakeUvx(fixture.root, "uvx-writable");
  chmodSync(writable, 0o722);
  assert.throws(
    () => resolveUvxTool(writable, UNMATCHED_UVX_POLICY),
    /group or world writable/u,
  );

  const invalidVersion = fakeUvx(fixture.root, "uvx-invalid-version", "uvx latest");
  assert.throws(
    () => resolveUvxTool(invalidVersion, uvxTrustPolicy(invalidVersion)),
    /version/u,
  );

  const digestMismatch = fakeUvx(fixture.root, "uvx-digest-mismatch");
  assert.throws(
    () => resolveUvxTool(digestMismatch, UNMATCHED_UVX_POLICY),
    /digest.*trust policy/u,
  );
  assert.throws(
    () => resolveUvxTool(fixture.uvxPath, uvxTrustPolicy(fixture.uvxPath, "uvx 0.8.4")),
    /version.*trust policy/u,
  );
  assert.throws(
    () =>
      resolveUvxTool(fixture.uvxPath, {
        ...uvxTrustPolicy(fixture.uvxPath),
      }),
    /frozen/u,
  );

  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.OPENAI_API_KEY = SECRET_CANARY;
  process.env.CODEX_HOME = "/ambient/codex";
  try {
    const policy = uvxTrustPolicy(fixture.uvxPath);
    const resolved = resolveUvxTool(fixture.uvxPath, policy);
    assert.equal(resolved.path, fixture.uvxPath);
    assert.equal(resolved.observedVersion, "uvx 0.8.3");
    assert.equal(resolved.policyVersion, "uvx 0.8.3");
    assert.match(resolved.observedDigest, DIGEST_PATTERN);
    assert.equal(resolved.policyDigest, resolved.observedDigest);
    assert.equal(Object.isFrozen(resolved), true);
    assertRecursivelyExcludes(resolved, SECRET_CANARY);
  } finally {
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});

test("buildPcdaHarborArgs rejects unbranded or changed uvx evidence", () => {
  const fixture = projectedFixture();
  const common = readyInput(fixture);
  assert.throws(
    () =>
      buildPcdaHarborArgs({
        ...common,
        uvxTool: { ...common.uvxTool } as unknown as typeof common.uvxTool,
      }),
    /resolved by resolveUvxTool/u,
  );

  const originalBytes = readFileSync(fixture.uvxPath);
  writeFileSync(
    fixture.uvxPath,
    Buffer.concat([originalBytes, Buffer.from("# tampered\n")]),
  );
  assert.throws(() => buildPcdaHarborArgs(common), /uvx digest changed/u);

  writeFileSync(fixture.uvxPath, originalBytes);
  chmodSync(fixture.uvxPath, 0o500);
  assert.throws(() => buildPcdaHarborArgs(common), /uvx mode or ownership changed/u);
});

test("buildPcdaHarborArgs accepts only the trusted projection root and regular task files", () => {
  const fixture = projectedFixture();
  const common = readyInput(fixture);
  const arbitrary = join(fixture.root, "arbitrary", "harbor");
  mkdirSync(arbitrary, { recursive: true });
  assert.throws(
    () =>
      buildPcdaHarborArgs({
        ...common,
        projection: {
          ...fixture.projection,
          taskPath: arbitrary,
          taskTomlPath: join(arbitrary, "task.toml"),
        },
      }),
    /trusted projection root/u,
  );

  const alias = join(fixture.root, "projection-alias");
  symlinkSync(fixture.projection.projectionRoot, alias);
  assert.throws(
    () =>
      buildPcdaHarborArgs({
        ...common,
        projection: {
          ...fixture.projection,
          projectionRoot: alias,
          taskPath: join(alias, "harbor"),
          taskTomlPath: join(alias, "harbor", "task.toml"),
        },
      }),
    /symbolic link/u,
  );

  const missingFixture = projectedFixture();
  unlinkSync(join(missingFixture.projection.taskPath, "instruction.md"));
  mkdirSync(join(missingFixture.projection.taskPath, "instruction.md"));
  assert.throws(
    () => buildPcdaHarborArgs(readyInput(missingFixture)),
    /required regular file/u,
  );

  const symlinkFixture = projectedFixture();
  symlinkSync(
    symlinkFixture.uvxPath,
    join(symlinkFixture.projection.taskPath, "environment", "unexpected-link"),
  );
  assert.throws(
    () => buildPcdaHarborArgs(readyInput(symlinkFixture)),
    /symbolic link/u,
  );
});

test("buildPcdaHarborArgs rejects every projection tree mutation after projection", () => {
  const fixture = projectedFixture();
  const common = readyInput(fixture);
  const dockerfile = join(fixture.projection.taskPath, "environment", "Dockerfile");
  const originalBytes = readFileSync(dockerfile);
  const originalMode = lstatSync(dockerfile).mode & 0o7777;
  const extra = join(fixture.projection.projectionRoot, "unexpected.txt");
  const emptyDirectory = join(
    fixture.projection.projectionRoot,
    "unexpected-empty-directory",
  );
  const candidateDirectory = join(fixture.projection.projectionRoot, "candidate");
  const candidateDirectoryMode = lstatSync(candidateDirectory).mode & 0o7777;
  const link = join(fixture.projection.projectionRoot, "unexpected-link");

  writeFileSync(dockerfile, Buffer.concat([originalBytes, Buffer.from("# tamper\n")]));
  assert.throws(() => buildPcdaHarborArgs(common), /execution tree digest/u);
  writeFileSync(dockerfile, originalBytes);

  writeFileSync(extra, "added\n", "utf8");
  assert.throws(() => buildPcdaHarborArgs(common), /execution tree digest/u);
  rmSync(extra);

  mkdirSync(emptyDirectory);
  assert.throws(() => buildPcdaHarborArgs(common), /execution tree digest/u);
  rmSync(emptyDirectory, { recursive: true });

  chmodSync(candidateDirectory, 0o700);
  assert.throws(() => buildPcdaHarborArgs(common), /execution tree digest/u);
  chmodSync(candidateDirectory, candidateDirectoryMode);

  rmSync(dockerfile);
  assert.throws(() => buildPcdaHarborArgs(common), /required task file/u);
  writeFileSync(dockerfile, originalBytes);
  chmodSync(dockerfile, originalMode);

  chmodSync(dockerfile, 0o600);
  assert.throws(() => buildPcdaHarborArgs(common), /execution tree digest/u);
  chmodSync(dockerfile, originalMode);

  symlinkSync(dockerfile, link);
  assert.throws(() => buildPcdaHarborArgs(common), /symbolic link/u);
  rmSync(link);

  assert.equal(buildPcdaHarborArgs(common).state, "ready");
});

test("buildPcdaHarborArgs rejects missing, duplicate, or conflicting task TOML isolation", () => {
  const fixture = projectedFixture();
  const original = readFileSync(fixture.projection.taskTomlPath, "utf8");
  const invalid = [
    original.replace('artifacts = ["/app/output.json"]\n', ""),
    original.replace(
      'artifacts = ["/app/output.json"]\n',
      'artifacts = ["/app/output.json"]\nartifacts = ["/app/output.json"]\n',
    ),
    original.replace(
      '[environment]\nnetwork_mode = "no-network"',
      '[environment]\nnetwork_mode = "public"',
    ),
    original.replace('[verifier.environment]\nnetwork_mode = "no-network"', ""),
    `${original}\n[agent]\nnetwork_mode = "no-network"\n`,
  ];
  for (const source of invalid) {
    writeFileSync(fixture.projection.taskTomlPath, source, "utf8");
    assert.throws(() => buildPcdaHarborArgs(readyInput(fixture)), /task\.toml/u);
  }
  writeFileSync(fixture.projection.taskTomlPath, original, "utf8");
});

test("buildPcdaHarborArgs allows only the first-baseline provider hostname", () => {
  const fixture = projectedFixture();
  for (const candidateProviderHost of [
    "https://api.openai.com",
    "api.openai.com/v1",
    "*.openai.com",
    "127.0.0.1",
    "localhost",
    "api.anthropic.com",
  ]) {
    assert.throws(
      () =>
        buildPcdaHarborArgs({
          ...readyInput(fixture),
          candidateProviderHost,
        }),
      /api\.openai\.com/u,
    );
  }
});

test("buildPcdaHarborArgs allows only the explicitly authorized candidate model", () => {
  const fixture = projectedFixture();
  assert.throws(
    () =>
      buildPcdaHarborArgs({
        ...readyInput(fixture),
        candidateModel: "gpt-5.6-luna",
      }),
    /candidateModel must be gpt-5\.6-terra/u,
  );
});

function pcdaNativeResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "native-trial-t1-a",
    trial_name: "coffee-chat-pcda-t1-a__codex__1",
    task_name: "openboa-ai/pcda-case-projection",
    exception_info: null,
    verifier_environment_mode: "separate",
    verifier_result: { rewards: { reward: 1 } },
    agent_info: {
      name: "codex",
      version: "0.147.0",
      model_info: { name: "gpt-5.6-terra" },
    },
    config: { environment: { type: "docker", delete: true } },
    artifact_paths: ["/app/output.json"],
    ...overrides,
  };
}

test("PCDA calibration accepts Oracle=1 and no-op=0 and rejects reversed evidence", () => {
  assert.deepEqual(
    calibratePcdaNativeResults({
      oracle: pcdaNativeResult(),
      noop: pcdaNativeResult({
        id: "native-trial-nop",
        trial_name: "coffee-chat-pcda-nop__nop__1",
        agent_info: { name: "nop", version: "0.1.0" },
        verifier_result: { rewards: { reward: 0 } },
      }),
    }),
    { state: "accepted", oracleReward: 1, noopReward: 0 },
  );
  assert.deepEqual(
    calibratePcdaNativeResults({
      oracle: pcdaNativeResult({ verifier_result: { rewards: { reward: 0 } } }),
      noop: pcdaNativeResult({
        agent_info: { name: "nop", version: "0.1.0" },
        verifier_result: { rewards: { reward: 1 } },
      }),
    }),
    { state: "rejected", reason: "Oracle must be 1 and no-op must be 0" },
  );
});

test("PCDA native evidence preserves malformed, missing-output, and verifier failures", () => {
  assert.deepEqual(parsePcdaNativeResult("bad"), {
    state: "invalid",
    failureClass: "artifact",
    reason: "Harbor result must be a JSON object",
  });
  assert.deepEqual(parsePcdaNativeResult(pcdaNativeResult({ artifact_paths: [] })), {
    state: "invalid",
    failureClass: "artifact",
    reason: "Harbor result must expose exactly one /app/output.json artifact",
  });
  const verifierFailure = parsePcdaNativeResult(
    pcdaNativeResult({
      exception_info: { exception_type: "VerifierError" },
      verifier: {},
    }),
  );
  assert.equal(verifierFailure.state, "invalid");
  if (verifierFailure.state === "invalid") {
    assert.equal(verifierFailure.failureClass, "verifier");
  }
});

test("PCDA live evidence requires the exact Codex Terra candidate identity", () => {
  assert.equal(
    parsePcdaNativeResult(pcdaNativeResult(), {
      agentName: "codex",
      modelName: "gpt-5.6-terra",
    }).state,
    "accepted",
  );
  for (const evidence of [
    pcdaNativeResult({ agent_info: { name: "other", version: "1" } }),
    pcdaNativeResult({
      agent_info: {
        name: "codex",
        version: "0.147.0",
        model_info: { name: "gpt-5.6-luna" },
      },
    }),
  ]) {
    const parsed = parsePcdaNativeResult(evidence, {
      agentName: "codex",
      modelName: "gpt-5.6-terra",
    });
    assert.equal(parsed.state, "invalid");
    if (parsed.state === "invalid") assert.equal(parsed.failureClass, "candidate");
  }
});

test("spawn-local credential boundary maps only an explicit dedicated key", () => {
  const fixture = projectedFixture("T0");
  const launch = buildPcdaHarborArgs(readyInput(fixture));
  assert.equal(launch.state, "ready");
  if (launch.state !== "ready") return;
  const secret = "task2-secret-canary";
  let captured: Readonly<Record<string, string>> | undefined;
  const result = executePcdaSpawn({
    launch,
    credentialName: "COFFEE_CHAT_CANDIDATE_API_KEY",
    loadCredential(name) {
      assert.equal(name, "COFFEE_CHAT_CANDIDATE_API_KEY");
      return secret;
    },
    spawn(_command, args, environment) {
      assert.equal(args.includes(secret), false);
      captured = environment;
      return { exitCode: 0 };
    },
  });
  assert.equal(captured?.OPENAI_API_KEY, secret);
  assert.deepEqual(Object.keys(captured!).sort(), [
    "DOCKER_CONFIG",
    "DOCKER_HOST",
    "HOME",
    "LANG",
    "OPENAI_API_KEY",
    "PATH",
    "XDG_CONFIG_HOME",
  ]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.throws(
    () =>
      executePcdaSpawn({
        launch,
        credentialName: "OPENAI_API_KEY",
        loadCredential: () => secret,
        spawn: () => ({ exitCode: 0 }),
      }),
    /dedicated parent credential name/u,
  );
});

test("spawn-local credential boundary rejects leaked child output on success or failure", () => {
  const fixture = projectedFixture("T0");
  const launch = buildPcdaHarborArgs(readyInput(fixture));
  assert.equal(launch.state, "ready");
  if (launch.state !== "ready") return;
  const credential = "candidate-output-leak-canary";
  for (const exitCode of [0, 1]) {
    assert.throws(
      () =>
        executePcdaSpawn({
          launch,
          credentialName: "COFFEE_CHAT_CANDIDATE_API_KEY",
          loadCredential: () => credential,
          spawn: () => ({ exitCode, boundedOutput: `log:${credential}` }),
        }),
      /output contained credential/u,
    );
  }
});

test("combined candidate and judge budget fails closed at USD 50", () => {
  assert.deepEqual(
    authorizeCombinedBudget({
      capNanoUsd: 50_000_000_000,
      candidatePlannedNanoUsd: 20_000_000_000,
      candidateSettledNanoUsd: 12_000_000_000,
      judgeWorstCaseNanoUsd: 38_000_000_000,
    }),
    { state: "authorized", judgeBudgetNanoUsd: 38_000_000_000 },
  );
  assert.equal(
    authorizeCombinedBudget({
      capNanoUsd: 50_000_000_000,
      candidatePlannedNanoUsd: 20_000_000_000,
      candidateSettledNanoUsd: 12_000_000_000,
      judgeWorstCaseNanoUsd: 38_000_000_001,
    }).state,
    "budget_exceeded",
  );
  assert.equal(
    authorizeCombinedBudget({
      capNanoUsd: 50_000_000_000,
      candidatePlannedNanoUsd: 20_000_000_000,
      candidateSettledNanoUsd: null,
      judgeWorstCaseNanoUsd: 1,
    }).state,
    "unmeasured",
  );
});

test("every invoked judge requires settled cost before another call", () => {
  assert.equal(debitJudgeCost(10_000, 4_000), 6_000);
  assert.throws(() => debitJudgeCost(10_000, undefined), /cost evidence/u);
  assert.throws(() => debitJudgeCost(10_000, 10_001), /exceeded USD 50/u);
});

test("candidate cost uses the conservative pinned Terra estimate and never invents zero", () => {
  assert.equal(
    candidateSettledNanoUsd({
      agent_result: {
        n_input_tokens: 1_000_000,
        n_cache_tokens: 500_000,
        n_output_tokens: 1_000_000,
        cost_usd: 10,
      },
    }),
    14_000_000_000,
  );
  assert.equal(
    candidateSettledNanoUsd({
      agent_result: {
        n_input_tokens: 1,
        n_cache_tokens: 0,
        n_output_tokens: 0,
        cost_usd: null,
      },
    }),
    2_000,
  );
  assert.equal(candidateSettledNanoUsd({ agent_result: {} }), null);
});

test("campaign receipt preserves measured, disagreement, and unavailable judge states", () => {
  const conditions = (["T0", "T1-A", "T1-B"] as const).map((condition, index) => ({
    condition,
    native: parsePcdaNativeResult(pcdaNativeResult()),
    artifactDigest: `sha256:${"6".repeat(64)}` as const,
    candidateSettledNanoUsd: 1_000_000_000,
    cleanup: { state: "completed" as const, matchingContainers: 0 },
    judge: {
      state: (["measured", "judge_disagreement", "judge_unavailable"] as const)[index]!,
      resultDigest: `sha256:${String(index + 7).repeat(64)}` as const,
      settledNanoUsd: 1_000_000_000,
    },
  }));
  const receipt = buildPcdaCampaignReceipt({
    evaluatorCommit: "d".repeat(40),
    evaluatorTreeClean: true,
    benchCommit: "a".repeat(40),
    bankDigest: `sha256:${"b".repeat(64)}`,
    candidateModel: "gpt-5.6-terra",
    campaignCapNanoUsd: 50_000_000_000,
    candidateReservationNanoUsd: 20_000_000_000,
    candidateCallReservationNanoUsd: 6_000_000_000,
    remainingBudgetNanoUsd: 44_000_000_000,
    conditions,
  });
  assert.equal(receipt.conditions.length, 3);
  assert.deepEqual(receipt.cost, {
    campaignCapNanoUsd: 50_000_000_000,
    candidateReservationNanoUsd: 20_000_000_000,
    candidateCallReservationNanoUsd: 6_000_000_000,
    candidateSettledNanoUsd: 3_000_000_000,
    judgeSettledNanoUsd: 3_000_000_000,
    remainingBudgetNanoUsd: 44_000_000_000,
  });
  assert.deepEqual(
    receipt.conditions.map((condition) => [
      condition.judgeState,
      condition.measurementState,
    ]),
    [
      ["measured", "measured"],
      ["disagreement", "unmeasured"],
      ["unavailable", "unmeasured"],
    ],
  );
  const serialized = JSON.stringify(receipt);
  for (const forbidden of ["response", "prompt", "Authorization", "OPENAI_API_KEY"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.throws(
    () =>
      buildPcdaCampaignReceipt({
        evaluatorCommit: "d".repeat(40),
        evaluatorTreeClean: false,
        benchCommit: "a".repeat(40),
        bankDigest: `sha256:${"b".repeat(64)}`,
        candidateModel: "gpt-5.6-terra",
        campaignCapNanoUsd: 50_000_000_000,
        candidateReservationNanoUsd: 20_000_000_000,
        candidateCallReservationNanoUsd: 6_000_000_000,
        remainingBudgetNanoUsd: 44_000_000_000,
        conditions,
      }),
    /clean evaluator commit/u,
  );
  assert.throws(
    () =>
      buildPcdaCampaignReceipt({
        evaluatorCommit: "d".repeat(40),
        evaluatorTreeClean: true,
        benchCommit: "a".repeat(40),
        bankDigest: `sha256:${"b".repeat(64)}`,
        candidateModel: "gpt-5.6-terra",
        campaignCapNanoUsd: 50_000_000_000,
        candidateReservationNanoUsd: 20_000_000_000,
        candidateCallReservationNanoUsd: 6_000_000_000,
        remainingBudgetNanoUsd: 44_000_000_000,
        conditions: conditions.map((condition, index) =>
          index === 2
            ? {
                ...condition,
                cleanup: { state: "failed" as const, matchingContainers: 1 },
              }
            : condition,
        ),
      }),
    /cleanup/u,
  );
});

test("campaign receipt preserves candidate and verifier failure dimensions", () => {
  const states = [
    "candidate_invalid",
    "candidate_failure",
    "verifier_failure",
  ] as const;
  const conditions = (["T0", "T1-A", "T1-B"] as const).map((condition, index) => ({
    condition,
    native: parsePcdaNativeResult(pcdaNativeResult()),
    artifactDigest: `sha256:${"6".repeat(64)}` as const,
    candidateSettledNanoUsd: 1_000_000_000,
    cleanup: { state: "completed" as const, matchingContainers: 0 },
    judge: {
      state: states[index]!,
      resultDigest: `sha256:${String(index + 7).repeat(64)}` as const,
      settledNanoUsd: 1_000_000_000,
    },
  }));
  const receipt = buildPcdaCampaignReceipt({
    evaluatorCommit: "d".repeat(40),
    evaluatorTreeClean: true,
    benchCommit: "a".repeat(40),
    bankDigest: `sha256:${"b".repeat(64)}`,
    candidateModel: "gpt-5.6-terra",
    campaignCapNanoUsd: 50_000_000_000,
    candidateReservationNanoUsd: 20_000_000_000,
    candidateCallReservationNanoUsd: 6_000_000_000,
    remainingBudgetNanoUsd: 44_000_000_000,
    conditions,
  });
  assert.deepEqual(
    receipt.conditions.map(({ candidateState, verifierState, judgeState }) => ({
      candidateState,
      verifierState,
      judgeState,
    })),
    [
      { candidateState: "invalid", verifierState: "unmeasured", judgeState: "skipped" },
      { candidateState: "failed", verifierState: "unmeasured", judgeState: "skipped" },
      { candidateState: "completed", verifierState: "failed", judgeState: "skipped" },
    ],
  );
});

test("candidate failure receipt preserves cleanup and unknown failed-call cost", () => {
  const receipt = buildPcdaFailureReceipt({
    evaluatorCommit: "d".repeat(40),
    evaluatorTreeClean: true,
    benchCommit: "a".repeat(40),
    bankDigest: `sha256:${"b".repeat(64)}`,
    candidateModel: "gpt-5.6-terra",
    failedCondition: "T1-A",
    completedCandidateSettledNanoUsd: 2_000_000_000,
    reason: "Harbor candidate failed after verified cleanup",
    cleanup: { state: "completed", matchingContainers: 0 },
  });
  assert.equal(receipt.state, "unmeasured");
  assert.equal(receipt.failure.candidateState, "failed");
  assert.equal(receipt.failure.cleanup.state, "completed");
  assert.equal(receipt.cost.observedCandidateSettledNanoUsd, 2_000_000_000);
  assert.equal(receipt.cost.failedCallSettledNanoUsd, null);
  assert.equal(receipt.cost.remainingBudgetNanoUsd, null);
});

test("Eval calls staged Bench attest then judge with explicit remaining cap and key", async () => {
  const fixture = projectedFixture("T1-A");
  const artifactPath = join(fixture.root, "output.json");
  writeJson(artifactPath, { artifact: "candidate" });
  const unsigned = buildUnsignedPcdaAttestation({
    projection: fixture.projection,
    artifactDigest: `sha256:${"6".repeat(64)}`,
    benchCommit: fixture.snapshot.commit,
    bankDigest: fixture.snapshot.bankDigest,
    deterministic: {
      state: "unmeasured",
      accepted: true,
      criticalFailure: false,
      reasonCode: "none",
    },
  });
  const capability = "c".repeat(43);
  const calls: string[] = [];
  const judgeCredential = "test-judge-credential";
  const credentialLoads: string[] = [];
  const result = await attestAndJudgeWithStagedBench({
    snapshot: fixture.snapshot,
    projection: fixture.projection,
    artifactPath,
    unsignedAttestation: unsigned,
    capabilityKey: capability,
    remainingJudgeCapNanoUsd: 38_000_000_000,
    credentialName: "COFFEE_CHAT_CANDIDATE_API_KEY",
    loadCredential: (name) => {
      credentialLoads.push(name);
      assert.deepEqual(calls, ["attest"]);
      return judgeCredential;
    },
    workspace: join(fixture.root, "judgment"),
    invoke: async ({ args, environment }) => {
      const command = args[2];
      calls.push(String(command));
      assert.equal(args.includes(capability), false);
      assert.equal(environment.COFFEE_CHAT_EVAL_ATTESTATION_KEY, capability);
      if (command === "attest") {
        assert.equal(Object.hasOwn(environment, "OPENAI_API_KEY"), false);
        assert.equal(
          Object.hasOwn(environment, "COFFEE_CHAT_EVAL_JUDGE_CAP_NANO_USD"),
          false,
        );
        const unsignedPath = args[3]!;
        const signedPath = args[4]!;
        const parsed = JSON.parse(readFileSync(unsignedPath, "utf8"));
        assert.equal(Object.hasOwn(parsed, "attestationMac"), false);
        writeFileSync(
          signedPath,
          `${JSON.stringify({ ...parsed, attestationMac: "m".repeat(43) })}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        return { exitCode: 0, stdout: '{"state":"signed"}\n' };
      }
      assert.equal(command, "judge");
      assert.equal(environment.OPENAI_API_KEY, judgeCredential);
      assert.equal(environment.COFFEE_CHAT_EVAL_JUDGE_CAP_NANO_USD, "38000000000");
      assert.equal(args.includes(judgeCredential), false);
      return {
        exitCode: 0,
        stdout: `${JSON.stringify({
          state: "measured",
          resultDigest: `sha256:${"7".repeat(64)}`,
          campaign: { settledNanoUsd: 1_000_000_000 },
        })}\n`,
      };
    },
  });
  assert.deepEqual(calls, ["attest", "judge"]);
  assert.deepEqual(credentialLoads, ["COFFEE_CHAT_CANDIDATE_API_KEY"]);
  assert.deepEqual(result, {
    state: "judged",
    judgeState: "measured",
    measurementState: "measured",
    resultDigest: `sha256:${"7".repeat(64)}`,
    settledNanoUsd: 1_000_000_000,
  });
  assert.equal(JSON.stringify(result).includes(capability), false);
  assert.equal(JSON.stringify(result).includes(judgeCredential), false);
});

test("PCDA CLI keeps calibration deterministic and live Codex manual-only", async () => {
  const calibration = await runPcdaCli([
    "calibrate",
    "--oracle-result",
    join(process.cwd(), "tests/fixtures/pcda-calibration/oracle-result.json"),
    "--noop-result",
    join(process.cwd(), "tests/fixtures/pcda-calibration/noop-result.json"),
  ]);
  assert.deepEqual(calibration, {
    exitCode: 0,
    report: { state: "accepted", oracleReward: 1, noopReward: 0 },
  });

  let dispatched = false;
  const manual = await runPcdaCli(
    [
      "codex",
      "--bench-repo",
      "/tmp/coffee-chat-bench",
      "--bench-commit",
      "1a743f17a88a1e5b50b4b7e19c2cbeaef76922fa",
      "--case",
      "bank/campaign/development/000.json",
      "--candidate-model",
      "gpt-5.6-terra",
      "--candidate-credential-env",
      "COFFEE_CHAT_CANDIDATE_API_KEY",
      "--uvx-path",
      "/tmp/uvx",
      "--uvx-digest",
      `sha256:${"a".repeat(64)}`,
      "--uvx-version",
      "uvx 0.8.13",
      "--jobs-root",
      "/tmp/pcda-jobs",
    ],
    {
      runManual: async (request) => {
        dispatched = true;
        assert.equal(request.benchCommit, "1a743f17a88a1e5b50b4b7e19c2cbeaef76922fa");
        assert.equal(request.credentialName, "COFFEE_CHAT_CANDIDATE_API_KEY");
        return { exitCode: 0, report: { state: "completed" } };
      },
    },
  );
  assert.deepEqual(manual, {
    exitCode: 0,
    report: { state: "completed" },
  });
  assert.equal(dispatched, true);
  await assert.rejects(
    async () =>
      await runPcdaCli([
        "codex",
        "--bench-repo",
        "/tmp/coffee-chat-bench",
        "--bench-commit",
        "1a743f17a88a1e5b50b4b7e19c2cbeaef76922fa",
        "--case",
        "bank/campaign/development/000.json",
        "--candidate-model",
        "gpt-5.6-terra",
        "--candidate-credential-env",
        "OPENAI_API_KEY",
        "--uvx-path",
        "/tmp/uvx",
        "--uvx-digest",
        `sha256:${"a".repeat(64)}`,
        "--uvx-version",
        "uvx 0.8.13",
        "--jobs-root",
        "/tmp/pcda-jobs",
      ]),
    /dedicated parent credential name/u,
  );
});
