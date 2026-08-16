import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  startResponsesProxy,
  type ResponsesProxyHandle,
} from "../src/responses-proxy.ts";
import { CODEX_MODELS, createHarborCodexPlan } from "../src/codex.ts";
import { createCandidateTaskOverlay } from "../src/codex-runner.ts";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test("Responses proxy forwards only an allowed model with a host-held provider key", async () => {
  let receivedAuthorization = "";
  let receivedBody = "";
  const upstream = createServer((request, response) => {
    receivedAuthorization = request.headers.authorization ?? "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (receivedBody += chunk));
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "resp-test", output: [] }));
    });
  });
  const upstreamPort = await listen(upstream);
  let proxy: ResponsesProxyHandle | undefined;
  try {
    proxy = await startResponsesProxy({
      apiKey: "provider-secret-test-only",
      allowedModels: ["gpt-5.6-luna"],
      upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/responses`,
      bindHost: "127.0.0.1",
      advertisedHost: "127.0.0.1",
    });
    const body = JSON.stringify({ model: "gpt-5.6-luna", input: "hello" });
    const response = await fetch(`${proxy.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${proxy.capabilityToken}`,
        "content-type": "application/json",
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { id: "resp-test", output: [] });
    assert.equal(receivedAuthorization, "Bearer provider-secret-test-only");
    assert.equal(receivedBody, body);
    assert.notEqual(proxy.capabilityToken, "provider-secret-test-only");
    assert.equal(proxy.stats().acceptedRequests, 1);
  } finally {
    await proxy?.close();
    await close(upstream);
  }
});

test("Responses proxy rejects missing capability and disallowed model without contacting upstream", async () => {
  let upstreamRequests = 0;
  const upstream = createServer((_request, response) => {
    upstreamRequests += 1;
    response.writeHead(500).end();
  });
  const upstreamPort = await listen(upstream);
  let proxy: ResponsesProxyHandle | undefined;
  try {
    proxy = await startResponsesProxy({
      apiKey: "provider-secret-test-only",
      allowedModels: ["gpt-5.6-terra"],
      upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/responses`,
      bindHost: "127.0.0.1",
      advertisedHost: "127.0.0.1",
      maxRequests: 1,
    });
    const missingCapability = await fetch(`${proxy.baseUrl}/responses`, {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.6-terra" }),
    });
    assert.equal(missingCapability.status, 401);
    const disallowed = await fetch(`${proxy.baseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${proxy.capabilityToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-5.6-luna" }),
    });
    assert.equal(disallowed.status, 403);
    assert.equal(upstreamRequests, 0);
    assert.equal(proxy.stats().rejectedRequests, 2);
  } finally {
    await proxy?.close();
    await close(upstream);
  }
});

test("Harbor Codex plan passes only a proxy capability to the candidate", () => {
  const plan = createHarborCodexPlan({
    task: {
      caseId: "case-1",
      condition: "task_only",
      trialId: "trial-000000000000000000000001",
      taskDigest: `sha256:${"a".repeat(64)}`,
      directory: "task-000000000000000000000001",
      taskBytesDigest: `sha256:${"b".repeat(64)}`,
      path: "/workspace/task-000000000000000000000001",
    },
    harborCommand: "/opt/harbor/bin/harbor",
    jobsRoot: "/workspace/jobs",
    model: CODEX_MODELS[0],
    proxyBaseUrl: "http://host.docker.internal:43123/v1",
    capabilityToken: "capability-token",
    proxyConfigPath: "/workspace/codex-proxy.toml",
  });

  assert.deepEqual(plan.args.slice(0, 8), [
    "run",
    "-p",
    "/workspace/task-000000000000000000000001",
    "-a",
    "codex",
    "-m",
    "gpt-5.6-luna",
    "-o",
  ]);
  assert.ok(plan.args.includes("--allow-agent-host"));
  assert.ok(plan.args.includes("host.docker.internal"));
  assert.ok(plan.args.includes("OPENAI_API_KEY=capability-token"));
  assert.ok(plan.args.includes("config=/workspace/codex-proxy.toml"));
  assert.doesNotMatch(JSON.stringify(plan), /OPENAI_BASE_URL/u);
  assert.doesNotMatch(JSON.stringify(plan), /provider-secret|OPENAI_API_KEY=[^c]/u);
});

test("candidate runtime overlay changes only the agent network phase", () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-overlay-"));
  const source = join(root, "source");
  const destination = join(root, "overlay");
  try {
    const sourceTask = join(source, "task.toml");
    mkdirSync(source, { recursive: true });
    writeFileSync(
      sourceTask,
      'schema_version = "1.4"\n[environment]\nnetwork_mode = "no-network"\n',
    );
    const overlay = createCandidateTaskOverlay({
      sourceTaskPath: source,
      destinationTaskPath: destination,
    });
    const text = readFileSync(join(destination, "task.toml"), "utf8");
    assert.match(text, /\[environment\][\s\S]*network_mode = "no-network"/u);
    assert.match(text, /\[agent\][\s\S]*network_mode = "allowlist"/u);
    assert.match(text, /host\.docker\.internal/u);
    assert.match(overlay.configurationDigest, /^sha256:[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
