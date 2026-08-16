import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

import {
  createResponsesJudgeTransport,
  type ResponsesJudgeTransportHandle,
} from "../src/judge-transport.ts";

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

test("judge transport sends a strict verdict request through the host proxy", async () => {
  let receivedAuthorization = "";
  let receivedBody: Record<string, unknown> | undefined;
  const upstream = createServer((request, response) => {
    receivedAuthorization = request.headers.authorization ?? "";
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      receivedBody = JSON.parse(body) as Record<string, unknown>;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          model: "gpt-5.6-luna",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: '{"verdict":"pass"}' }],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 4 },
        }),
      );
    });
  });
  const upstreamPort = await listen(upstream);
  let transport: ResponsesJudgeTransportHandle | undefined;
  try {
    transport = await createResponsesJudgeTransport({
      apiKey: "provider-secret-test-only",
      allowedModels: ["gpt-5.6-luna"],
      upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/responses`,
    });
    const result = await transport.transport({
      model: "gpt-5.6-luna",
      system: "Return JSON only.",
      input: "Quoted task data.",
      allowedVerdicts: ["pass", "fail"],
    });
    assert.deepEqual(result, {
      state: "succeeded",
      resolvedModel: "gpt-5.6-luna",
      responseText: '{"verdict":"pass"}',
      usage: null,
    });
    assert.equal(receivedAuthorization, "Bearer provider-secret-test-only");
    assert.notEqual(transport.proxyCapabilityToken, "provider-secret-test-only");
    assert.equal(receivedBody?.model, "gpt-5.6-luna");
    assert.deepEqual((receivedBody?.text as Record<string, unknown>)?.format, {
      type: "json_schema",
      name: "judge_verdict",
      strict: true,
      schema: {
        type: "object",
        properties: { verdict: { type: "string", enum: ["pass", "fail"] } },
        required: ["verdict"],
        additionalProperties: false,
      },
    });
  } finally {
    await transport?.close();
    await close(upstream);
  }
});

test("judge transport preserves a provider failure without fabricating a verdict", async () => {
  const upstream = createServer((_request, response) => {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "temporarily unavailable" } }));
  });
  const upstreamPort = await listen(upstream);
  let transport: ResponsesJudgeTransportHandle | undefined;
  try {
    transport = await createResponsesJudgeTransport({
      apiKey: "provider-secret-test-only",
      allowedModels: ["gpt-5.6-terra"],
      upstreamUrl: `http://127.0.0.1:${upstreamPort}/v1/responses`,
    });
    const result = await transport.transport({
      model: "gpt-5.6-terra",
      system: "Return JSON only.",
      input: "Quoted task data.",
      allowedVerdicts: ["left", "right", "tie"],
    });
    assert.equal(result.state, "failed");
    assert.equal(result.resolvedModel, null);
    assert.match(result.cause, /503|temporarily unavailable/u);
  } finally {
    await transport?.close();
    await close(upstream);
  }
});
