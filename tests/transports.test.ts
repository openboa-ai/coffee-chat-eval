import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createFixtureCandidateTransport,
  createInteractiveBrokerTransport,
  createNotImplementedTransport,
  createResponsesJudgeTransport,
  issueCapabilityDescriptor,
} from "../src/transports.ts";

test("fixture and not-implemented transports preserve explicit states", async () => {
  const fixture = createFixtureCandidateTransport((input) => ({ echoed: input }));
  const measured = await fixture.run({ prompt: "fixture" });
  assert.equal(measured.state, "measured");
  if (measured.state === "measured") assert.match(measured.outputDigest, /^sha256:/u);
  const unavailable = createNotImplementedTransport("coffee_chat_product");
  assert.deepEqual(await unavailable.run({}), {
    state: "not_implemented",
    reason: "coffee_chat_product interactive interface is not implemented",
  });
});

test("interactive broker transport exposes only scoped capability metadata", async () => {
  const descriptor = issueCapabilityDescriptor({
    scope: "candidate",
    expiresAt: "2026-08-23T00:00:00Z",
    maxRequests: 2,
  });
  assert.equal(descriptor.scope, "candidate");
  assert.match(descriptor.digest, /^sha256:/u);
  const transport = createInteractiveBrokerTransport({
    endpoint: "http://127.0.0.1:1/session",
    capability: "scoped-capability",
    model: "fixture-model",
  });
  assert.equal(transport.kind, "agent_stack");
  assert.equal("apiKey" in transport, false);
  await assert.rejects(() => transport.openSession({}), /broker session unavailable/u);
});

test("responses Judge transport stores the raw completion, not the proxy envelope", async () => {
  const root = await mkdtemp(join(tmpdir(), "coffee-chat-eval-judge-"));
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ output_text: JSON.stringify({ score: 1, rationale: "ok" }) }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const transport = createResponsesJudgeTransport({
      endpoint: `http://127.0.0.1:${address.port}`,
      capability: "judge-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: root,
    });
    const result = await transport.evaluate({ kind: "pointwise" });
    assert.equal(result.state, "measured");
    if (result.state !== "measured" || result.verdict === undefined) return;
    assert.equal(
      await readFile(result.verdict.path, "utf8"),
      '{"score":1,"rationale":"ok"}',
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});
