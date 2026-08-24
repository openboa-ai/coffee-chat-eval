import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  startResponsesProxyProcess,
  validateResponsesUpstreamUrl,
} from "../src/responses-proxy-process.ts";

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("test upstream did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

test("proxy-process upstream is exact official OpenAI or an explicit loopback replay endpoint", () => {
  assert.equal(
    validateResponsesUpstreamUrl(undefined),
    "https://api.openai.com/v1/responses",
  );
  assert.equal(
    validateResponsesUpstreamUrl("http://127.0.0.1:43123/replay/responses"),
    "http://127.0.0.1:43123/replay/responses",
  );
  for (const url of [
    "http://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses/",
    "https://example.com/v1/responses",
    "http://localhost:43123/replay/responses",
    "http://127.0.0.1:43123/replay/responses?redirect=https://example.com",
  ]) {
    assert.throws(() => validateResponsesUpstreamUrl(url), /official OpenAI|loopback/u);
  }
});

test("provider key stays in the dedicated proxy child and child cleanup completes", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-proxy-process-"));
  const providerKeyEnv = "COFFEE_CHAT_PROXY_PROCESS_TEST_KEY";
  const providerKey = "provider-secret-only-for-child";
  const previousProviderValue = process.env[providerKeyEnv];
  delete process.env[providerKeyEnv];
  let authorization: string | undefined;
  const upstream = createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "response-test",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "ok" }],
          },
        ],
      }),
    );
  });
  let broker: Awaited<ReturnType<typeof startResponsesProxyProcess>> | undefined;
  try {
    const upstreamPort = await listen(upstream);
    const providerEnvFile = join(root, ".env.local");
    writeFileSync(providerEnvFile, `${providerKeyEnv}=${providerKey}\n`, {
      mode: 0o600,
    });
    chmodSync(providerEnvFile, 0o600);

    broker = await startResponsesProxyProcess({
      providerEnvFile,
      providerKeyEnv,
      upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/responses`,
      candidateModel: "gpt-5.6-luna",
      judgeModel: "gpt-5.6-luna",
      candidateMaxRequests: 1,
      judgeMaxRequests: 1,
      ttlSeconds: 60,
    });

    assert.equal(Object.hasOwn(process.env, providerKeyEnv), false);
    const parentRuntime = JSON.stringify(broker.runtime);
    assert.doesNotMatch(parentRuntime, /provider-secret-only-for-child/u);
    assert.doesNotMatch(
      parentRuntime,
      /\.env\.local|COFFEE_CHAT_PROXY_PROCESS_TEST_KEY/u,
    );

    const response = await fetch(broker.runtime.candidate.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${broker.runtime.candidate.capabilityToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-5.6-luna", input: "hello" }),
    });
    assert.equal(response.status, 200);
    assert.equal(authorization, `Bearer ${providerKey}`);

    const endpoint = broker.runtime.candidate.endpoint;
    await broker.close();
    broker = undefined;
    await assert.rejects(() => fetch(endpoint), /fetch failed|ECONNREFUSED/u);
  } finally {
    if (broker !== undefined) await broker.close();
    if (upstream.listening) await closeServer(upstream);
    rmSync(root, { recursive: true, force: true });
    if (previousProviderValue === undefined) delete process.env[providerKeyEnv];
    else process.env[providerKeyEnv] = previousProviderValue;
  }
});

test("proxy process rejects provider credentials present in the Eval parent env", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-proxy-parent-env-"));
  const providerKeyEnv = "COFFEE_CHAT_PARENT_PROVIDER_KEY_TEST";
  const previousProviderValue = process.env[providerKeyEnv];
  try {
    const providerEnvFile = join(root, ".env.local");
    writeFileSync(providerEnvFile, `${providerKeyEnv}=file-only-value\n`, {
      mode: 0o600,
    });
    process.env[providerKeyEnv] = "must-not-be-in-parent";
    await assert.rejects(
      () =>
        startResponsesProxyProcess({
          providerEnvFile,
          providerKeyEnv,
          upstreamUrl: "http://127.0.0.1:43123/v1/responses",
          candidateModel: "gpt-5.6-luna",
          judgeModel: "gpt-5.6-luna",
          candidateMaxRequests: 1,
          judgeMaxRequests: 0,
          ttlSeconds: 60,
        }),
      /must not be present in the Eval parent environment/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (previousProviderValue === undefined) delete process.env[providerKeyEnv];
    else process.env[providerKeyEnv] = previousProviderValue;
  }
});

test("proxy child rejects a provider env file readable by group or others", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-proxy-file-mode-"));
  const providerKeyEnv = "COFFEE_CHAT_PRIVATE_FILE_MODE_TEST";
  const previousProviderValue = process.env[providerKeyEnv];
  delete process.env[providerKeyEnv];
  try {
    const providerEnvFile = join(root, ".env.local");
    writeFileSync(providerEnvFile, `${providerKeyEnv}=file-only-value\n`, {
      mode: 0o644,
    });
    chmodSync(providerEnvFile, 0o644);
    await assert.rejects(
      () =>
        startResponsesProxyProcess({
          providerEnvFile,
          providerKeyEnv,
          upstreamUrl: "http://127.0.0.1:43123/v1/responses",
          candidateModel: "gpt-5.6-luna",
          judgeModel: "gpt-5.6-luna",
          candidateMaxRequests: 1,
          judgeMaxRequests: 0,
          ttlSeconds: 60,
        }),
      /must not be accessible by group or others/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (previousProviderValue === undefined) delete process.env[providerKeyEnv];
    else process.env[providerKeyEnv] = previousProviderValue;
  }
});
