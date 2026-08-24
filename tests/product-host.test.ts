import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import type {
  CandidateRunResult,
  CandidateTransport,
  InteractiveAgentSession,
  InteractiveAgentTransport,
} from "../src/eval-core.ts";
import {
  calculateProductPackageDigest,
  prepareCoffeeChatProductCandidateTransport,
  ProductHostUnavailableError,
  productHostTestOnly,
  verifyCoffeeChatProductPackage,
  type CoffeeChatProductCandidateMetadata,
} from "../src/product-host.ts";
import type { CoffeeChatProductIdentity } from "../src/runtime-config.ts";

const execute = promisify(execFile);
const REPOSITORY = "https://github.com/openboa-ai/coffee-chat" as const;
const CALVER = "2026.8.23";
const CAPABILITIES = [
  ["init", "coffee-init", "available"],
  ["sync", "coffee-sync", "not_implemented"],
  ["unsync", "coffee-unsync", "not_implemented"],
  ["roast", "coffee-roast", "not_implemented"],
  ["brew", "coffee-brew", "not_implemented"],
  ["coffee-chat", "coffee-chat", "not_implemented"],
  ["coffee-blend", "coffee-blend", "not_implemented"],
] as const;

async function file(root: string, path: string, contents = `${path}\n`) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents);
}

async function git(root: string, ...arguments_: string[]): Promise<string> {
  const result = await execute("git", arguments_, { cwd: root, encoding: "utf8" });
  return result.stdout.trim();
}

async function createProductFixture(): Promise<{
  readonly root: string;
  readonly identity: CoffeeChatProductIdentity;
}> {
  const root = await mkdtemp(join(tmpdir(), "coffee-chat-product-host-"));
  const shared = {
    name: "coffee-chat",
    version: CALVER,
    repository: REPOSITORY,
  };
  await file(root, "plugin.json", `${JSON.stringify(shared, null, 2)}\n`);
  await file(
    root,
    ".codex-plugin/plugin.json",
    `${JSON.stringify({ ...shared, skills: "./skills/" }, null, 2)}\n`,
  );
  await file(
    root,
    "config/plugin-metadata.json",
    `${JSON.stringify(shared, null, 2)}\n`,
  );
  await file(
    root,
    "config/capabilities.json",
    `${JSON.stringify(
      {
        schema: "coffee-chat-capabilities-v1",
        product: "coffee-chat",
        calver: CALVER,
        interface: "skills",
        capabilities: CAPABILITIES.map(([id, skill, state]) => ({
          id,
          skill,
          entrypoint: `skills/${skill}/scripts/run.mjs`,
          state,
        })),
      },
      null,
      2,
    )}\n`,
  );

  for (const [, skill, state] of CAPABILITIES) {
    await file(
      root,
      `skills/${skill}/SKILL.md`,
      `---\nname: ${skill}\n---\nstatus: ${state}\n`,
    );
    await file(root, `skills/${skill}/scripts/run.mjs`, `// ${skill}\n`);
  }
  for (const path of [
    ".agents/plugins/marketplace.json",
    "contract/roastery/README.md",
    "docs/assets/readme/coffee-chat-hero.png",
    "docs/assets/readme/coffee-chat-judgment.png",
    "docs/assets/readme/coffee-chat-talk-work.png",
    "docs/product-boundaries.md",
    "docs/quality-map.md",
    "runtime/coffee-chat.mjs",
    "AGENTS.md",
    "INSTALL_FOR_AGENTS.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
  ]) {
    await file(root, path);
  }

  await git(root, "init", "--quiet");
  await git(root, "config", "user.name", "Eval Fixture");
  await git(root, "config", "user.email", "eval-fixture@example.invalid");
  await git(root, "remote", "add", "origin", `${REPOSITORY}.git`);
  await git(root, "add", ".");
  await git(root, "commit", "--quiet", "-m", "fixture");
  const commit = await git(root, "rev-parse", "HEAD");
  const packageDigest = await calculateProductPackageDigest(root);
  return {
    root,
    identity: {
      repository: REPOSITORY,
      commit,
      calver: CALVER,
      packageDigest,
      mode: "connectivity_only",
    },
  };
}

function measuredResult(): CandidateRunResult {
  return {
    state: "measured",
    output: {
      path: "/private/evidence/output",
      digest: `sha256:${"1".repeat(64)}`,
      mediaType: "application/json",
      bytes: 2,
    },
    outputDigest: `sha256:${"1".repeat(64)}`,
    latencyMs: 1,
    inputTokens: 1,
    outputTokens: 1,
  };
}

function assertMetadata(
  value: CoffeeChatProductCandidateMetadata,
  identity: CoffeeChatProductIdentity,
): void {
  assert.deepEqual(value, {
    candidateMode: "connectivity_only",
    capabilitiesUsed: [],
    productBehaviorExercised: false,
    referenceHost: "eval-skills-reference-host-v1",
    productIdentity: {
      repository: identity.repository,
      commit: identity.commit,
      calver: identity.calver,
      packageDigest: identity.packageDigest,
    },
  });
}

test("verifies the exact clean Product package and emits only public-safe metadata", async () => {
  const fixture = await createProductFixture();
  try {
    const result = await productHostTestOnly.verifyPackageAgainstSuppliedIdentity({
      packageRoot: fixture.root,
      identity: fixture.identity,
    });
    assert.equal(result.state, "verified");
    if (result.state !== "verified") return;
    assertMetadata(result.metadata, fixture.identity);
    assert.match(result.capabilityContractDigest, /^sha256:[0-9a-f]{64}$/u);
    const serialized = JSON.stringify(result.metadata);
    assert.equal(serialized.includes(fixture.root), false);
    assert.equal("packageRoot" in result.metadata, false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("production Product host rejects every identity outside the one admitted release", async () => {
  const fixture = await createProductFixture();
  try {
    const result = await verifyCoffeeChatProductPackage({
      packageRoot: fixture.root,
      identity: fixture.identity,
    });
    assert.deepEqual(result, {
      state: "unavailable",
      failureOwner: "host",
      reason: "Product candidate identity does not match the admitted release",
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Product verification never executes checkout-local Git fsmonitor hooks", async () => {
  const fixture = await createProductFixture();
  const marker = join(fixture.root, "fsmonitor-ran");
  const hook = join(fixture.root, "fsmonitor-hook.sh");
  try {
    await writeFile(
      hook,
      `#!/bin/sh\nprintf '%s' "\${OPENAI_API_KEY-unset}" > "${marker}"\nprintf '\\0'\n`,
    );
    await chmod(hook, 0o700);
    await git(fixture.root, "config", "core.fsmonitor", hook);
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "must-not-reach-product-git";
    try {
      const result = await productHostTestOnly.verifyPackageAgainstSuppliedIdentity({
        packageRoot: fixture.root,
        identity: fixture.identity,
      });
      assert.equal(result.state, "verified");
      assert.equal(existsSync(marker), false);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("fails closed for package tampering, dirty state, commit drift, and symlinks", async (t) => {
  await t.test("tampered committed package digest", async () => {
    const fixture = await createProductFixture();
    try {
      await file(fixture.root, "README.md", "tampered\n");
      await git(fixture.root, "add", "README.md");
      await git(fixture.root, "commit", "--quiet", "-m", "tamper");
      const identity = {
        ...fixture.identity,
        commit: await git(fixture.root, "rev-parse", "HEAD"),
      };
      const result = await productHostTestOnly.verifyPackageAgainstSuppliedIdentity({
        packageRoot: fixture.root,
        identity,
      });
      assert.deepEqual(result, {
        state: "unavailable",
        failureOwner: "host",
        reason: "Product package digest does not match candidate identity",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("dirty declared package surface", async () => {
    const fixture = await createProductFixture();
    try {
      await file(fixture.root, "plugin.json", "{}\n");
      const result = await productHostTestOnly.verifyPackageAgainstSuppliedIdentity({
        packageRoot: fixture.root,
        identity: fixture.identity,
      });
      assert.equal(result.state, "unavailable");
      if (result.state === "unavailable") {
        assert.equal(result.failureOwner, "host");
        assert.match(result.reason, /not clean/u);
        assert.equal(result.reason.includes(fixture.root), false);
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("commit drift", async () => {
    const fixture = await createProductFixture();
    try {
      const result = await productHostTestOnly.verifyPackageAgainstSuppliedIdentity({
        packageRoot: fixture.root,
        identity: { ...fixture.identity, commit: "0".repeat(40) },
      });
      assert.deepEqual(result, {
        state: "unavailable",
        failureOwner: "host",
        reason: "Product Git HEAD does not match candidate identity",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("repository remote drift", async () => {
    const fixture = await createProductFixture();
    try {
      await git(
        fixture.root,
        "remote",
        "set-url",
        "origin",
        "https://github.com/example/coffee-chat.git",
      );
      const result = await productHostTestOnly.verifyPackageAgainstSuppliedIdentity({
        packageRoot: fixture.root,
        identity: fixture.identity,
      });
      assert.deepEqual(result, {
        state: "unavailable",
        failureOwner: "host",
        reason: "Product Git remote does not match candidate identity",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("symlink in declared package surface", async () => {
    const fixture = await createProductFixture();
    try {
      await unlink(join(fixture.root, "README.md"));
      await symlink("LICENSE", join(fixture.root, "README.md"));
      const result = await productHostTestOnly.verifyPackageAgainstSuppliedIdentity({
        packageRoot: fixture.root,
        identity: fixture.identity,
      });
      assert.equal(result.state, "unavailable");
      if (result.state === "unavailable") {
        assert.equal(result.failureOwner, "host");
        assert.match(result.reason, /symlink/u);
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

test("fails closed when the capability contract deviates from the exact seven Skills", async () => {
  const fixture = await createProductFixture();
  try {
    const path = join(fixture.root, "config", "capabilities.json");
    const contract = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    contract.capabilities = [];
    await writeFile(path, `${JSON.stringify(contract)}\n`);
    await git(fixture.root, "add", "config/capabilities.json");
    await git(fixture.root, "commit", "--quiet", "-m", "bad contract");
    const identity = {
      ...fixture.identity,
      commit: await git(fixture.root, "rev-parse", "HEAD"),
      packageDigest: await calculateProductPackageDigest(fixture.root),
    };
    const result = await productHostTestOnly.verifyPackageAgainstSuppliedIdentity({
      packageRoot: fixture.root,
      identity,
    });
    assert.equal(result.state, "unavailable");
    if (result.state === "unavailable") {
      assert.equal(result.failureOwner, "host");
      assert.match(result.reason, /capability contract/u);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("wraps batch transport without changing calls or executing a Product Skill", async () => {
  const fixture = await createProductFixture();
  const inputs: unknown[] = [];
  const expected = measuredResult();
  const delegate: CandidateTransport = {
    kind: "agent_stack",
    run: async (input) => {
      inputs.push(input);
      return expected;
    },
  };
  try {
    const prepared = await productHostTestOnly.prepareCandidateTransport({
      packageRoot: fixture.root,
      identity: fixture.identity,
      delegate,
    });
    assert.equal(prepared.state, "verified");
    if (prepared.state !== "verified") return;
    const input = { input: "native track request" };
    assert.equal(await prepared.transport.run(input), expected);
    assert.deepEqual(inputs, [input]);
    assert.equal(prepared.transport.kind, "coffee_chat_product");
    assertMetadata(prepared.transport.productBoundary, fixture.identity);
    assert.deepEqual(prepared.transport.productHostPreflight, {
      state: "verified",
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("wraps interactive transport with unchanged session messages and cleanup", async () => {
  const fixture = await createProductFixture();
  const calls: unknown[] = [];
  let closed = false;
  const session: InteractiveAgentSession = {
    send: async (message) => {
      calls.push(message);
      return { echoed: message };
    },
    close: async () => {
      closed = true;
    },
  };
  const delegate: InteractiveAgentTransport = {
    kind: "agent_stack",
    run: async () => measuredResult(),
    openSession: async (input) => {
      calls.push(input);
      return session;
    },
  };
  try {
    const prepared = await productHostTestOnly.prepareInteractiveTransport({
      packageRoot: fixture.root,
      identity: fixture.identity,
      delegate,
    });
    assert.equal(prepared.state, "verified");
    if (prepared.state !== "verified") return;
    const wrapped = await prepared.transport.openSession({ suite: "workspace" });
    assert.deepEqual(await wrapped.send({ role: "user", content: "hello" }), {
      echoed: { role: "user", content: "hello" },
    });
    await wrapped.close();
    assert.deepEqual(calls, [
      { suite: "workspace" },
      { role: "user", content: "hello" },
    ]);
    assert.equal(closed, true);
    assert.equal(prepared.transport.kind, "coffee_chat_product");
    assertMetadata(prepared.transport.productBoundary, fixture.identity);
    assert.deepEqual(prepared.transport.productHostPreflight, {
      state: "verified",
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("transport factory returns an unavailable host transport instead of throwing", async () => {
  const fixture = await createProductFixture();
  try {
    const prepared = await productHostTestOnly.prepareCandidateTransport({
      packageRoot: fixture.root,
      identity: { ...fixture.identity, commit: "f".repeat(40) },
      delegate: { kind: "agent_stack", run: async () => measuredResult() },
    });
    assert.equal(prepared.state, "unavailable");
    if (prepared.state !== "unavailable") return;
    assert.equal(prepared.failureOwner, "host");
    assert.equal(prepared.reason, "Product Git HEAD does not match candidate identity");
    assertMetadata(prepared.metadata, {
      ...fixture.identity,
      commit: "f".repeat(40),
    });
    assert.deepEqual(prepared.transport.productHostPreflight, {
      state: "unavailable",
      reason: "Product Git HEAD does not match candidate identity",
    });
    assert.deepEqual(await prepared.transport.run({ prompt: "must not delegate" }), {
      state: "unavailable",
      reason: "Product Git HEAD does not match candidate identity",
      failureOwner: "host",
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("Product transport factory preserves Product identity when the reference host is missing", async () => {
  let delegateCalls = 0;
  const identity = {
    repository: REPOSITORY,
    commit: "e1ac82de77ab12b9b2499771a194ef3db356b3a6",
    calver: "2026.8.23",
    packageDigest:
      "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41",
    mode: "connectivity_only",
  } as const;
  const prepared = await prepareCoffeeChatProductCandidateTransport({
    identity,
    delegate: {
      kind: "agent_stack",
      run: async () => {
        delegateCalls += 1;
        return measuredResult();
      },
    },
  });
  assert.equal(prepared.state, "unavailable");
  if (prepared.state !== "unavailable") return;
  assert.equal(prepared.failureOwner, "host");
  assert.equal(
    prepared.reason,
    "coffee_chat_product runtime requires the reference product host",
  );
  assert.equal(prepared.transport.kind, "coffee_chat_product");
  assertMetadata(prepared.transport.productBoundary, identity);
  assert.deepEqual(prepared.transport.productHostPreflight, {
    state: "unavailable",
    reason: "coffee_chat_product runtime requires the reference product host",
  });
  assert.deepEqual(await prepared.transport.run({ prompt: "must not delegate" }), {
    state: "unavailable",
    reason: "coffee_chat_product runtime requires the reference product host",
    failureOwner: "host",
  });
  assert.equal(delegateCalls, 0);
});

test("interactive preflight failure reports unavailable host before a session can run", async () => {
  const fixture = await createProductFixture();
  const delegate: InteractiveAgentTransport = {
    kind: "agent_stack",
    run: async () => measuredResult(),
    openSession: async () => {
      throw new Error("delegate must not be reached");
    },
  };
  try {
    const prepared = await productHostTestOnly.prepareInteractiveTransport({
      packageRoot: fixture.root,
      identity: { ...fixture.identity, commit: "e".repeat(40) },
      delegate,
    });
    assert.equal(prepared.state, "unavailable");
    if (prepared.state !== "unavailable") return;
    await assert.rejects(
      () => prepared.transport.openSession({}),
      (error: unknown) =>
        error instanceof ProductHostUnavailableError &&
        error.state === "unavailable" &&
        error.failureOwner === "host",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
