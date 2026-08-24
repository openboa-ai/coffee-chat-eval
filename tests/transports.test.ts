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
  createResponsesCandidateTransport,
  createResponsesJudgeTransport,
  issueCapabilityDescriptor,
} from "../src/transports.ts";

interface CaptureBroker {
  readonly endpoint: string;
  readonly requests: unknown[];
  readonly close: () => Promise<void>;
}

async function startCaptureBroker(
  responses: readonly unknown[],
): Promise<CaptureBroker> {
  const requests: unknown[] = [];
  let responseIndex = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(responses[responseIndex++]));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function responsesOutput(text: string, usage?: Record<string, number>): unknown {
  return {
    status: "completed",
    error: null,
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    ...(usage === undefined ? {} : { usage }),
  };
}

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
      JSON.stringify({
        status: "completed",
        error: null,
        output_text: JSON.stringify({ score: 1, rationale: "ok" }),
      }),
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

test("Responses candidate sends the IFEval prompt unchanged and stores REST output text", async () => {
  const root = await mkdtemp(join(tmpdir(), "coffee-chat-eval-ifeval-"));
  const broker = await startCaptureBroker([
    responsesOutput("candidate answer", { input_tokens: 7, output_tokens: 3 }),
  ]);
  try {
    const transport = createResponsesCandidateTransport({
      kind: "agent_stack",
      endpoint: broker.endpoint,
      capability: "candidate-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: root,
    });
    const result = await transport.run({ caseId: "1000", prompt: "KEEP THIS EXACT" });
    assert.equal(result.state, "measured");
    assert.deepEqual(broker.requests, [
      { input: "KEEP THIS EXACT", model: "gpt-5.6-luna", store: false },
    ]);
    if (result.state !== "measured" || result.output === undefined) return;
    assert.equal(result.inputTokens, 7);
    assert.equal(result.outputTokens, 3);
    assert.equal(result.output.mediaType, "text/plain");
    assert.equal(await readFile(result.output.path, "utf8"), "candidate answer");
  } finally {
    await broker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Responses candidate renders BEAM conversation and question as clear text", async () => {
  const root = await mkdtemp(join(tmpdir(), "coffee-chat-eval-beam-"));
  const broker = await startCaptureBroker([responsesOutput("record answer")]);
  try {
    const transport = createResponsesCandidateTransport({
      kind: "agent_stack",
      endpoint: broker.endpoint,
      capability: "candidate-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: root,
    });
    const result = await transport.run({
      conversation: {
        conversationId: "100K/1",
        messages: [{ role: "user", content: "The launch is Tuesday." }],
      },
      question: "When is the launch?",
    });
    assert.equal(result.state, "measured");
    const body = broker.requests[0] as Record<string, unknown>;
    assert.equal(body.model, "gpt-5.6-luna");
    assert.equal(body.store, false);
    assert.equal(typeof body.input, "string");
    assert.match(body.input as string, /<conversation>/u);
    assert.match(body.input as string, /The launch is Tuesday\./u);
    assert.match(
      body.input as string,
      /<question>\nWhen is the launch\?\n<\/question>/u,
    );
    assert.doesNotMatch(body.input as string, /rubric/u);
  } finally {
    await broker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Responses candidate requests the exact Taste CandidateSubmission JSON shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "coffee-chat-eval-taste-candidate-"));
  const rawSubmission = JSON.stringify({
    artifact: { mediaType: "text/plain", content: "Use option A." },
    decisionRecord: {
      decision: "Option A",
      evidenceUse: [{ sourceId: "doc-1", use: "supports timing" }],
      tradeoffs: [{ factors: ["speed", "cost"], resolution: "prefer speed" }],
      constraints: [{ constraint: "budget", handling: "stay below cap" }],
      uncertainty: null,
    },
  });
  const broker = await startCaptureBroker([responsesOutput(rawSubmission)]);
  try {
    const transport = createResponsesCandidateTransport({
      kind: "agent_stack",
      endpoint: broker.endpoint,
      capability: "candidate-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: root,
    });
    const result = await transport.run({
      familyId: "family-000",
      condition: "target_a",
      benchmarkInput: {
        caseId: "case-000",
        condition: "target_a",
        candidate: { instruction: "Choose an option", documents: [] },
      },
    });
    assert.equal(result.state, "measured");
    const body = broker.requests[0] as Record<string, unknown>;
    assert.equal(typeof body.input, "string");
    assert.match(body.input as string, /Choose an option/u);
    const format = (body.text as { format: Record<string, unknown> }).format;
    assert.equal(format.type, "json_schema");
    assert.equal(format.name, "coffee_chat_candidate_submission");
    assert.equal(format.strict, true);
    const schema = format.schema as Record<string, unknown>;
    assert.deepEqual(schema.required, ["artifact", "decisionRecord"]);
    assert.equal(schema.additionalProperties, false);
    const properties = schema.properties as Record<string, unknown>;
    assert.deepEqual(Object.keys(properties).sort(), ["artifact", "decisionRecord"]);
    const artifactSchema = properties.artifact as Record<string, unknown>;
    assert.deepEqual(artifactSchema.required, ["mediaType", "content"]);
    assert.equal(artifactSchema.additionalProperties, false);
    const decisionSchema = properties.decisionRecord as Record<string, unknown>;
    assert.deepEqual(decisionSchema.required, [
      "decision",
      "evidenceUse",
      "tradeoffs",
      "constraints",
      "uncertainty",
    ]);
    assert.equal(decisionSchema.additionalProperties, false);
    if (result.state !== "measured" || result.output === undefined) return;
    assert.equal(await readFile(result.output.path, "utf8"), rawSubmission);
  } finally {
    await broker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Responses Judge preserves the native Taste abstain union in JSON mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "coffee-chat-eval-taste-judge-"));
  const outputs = [
    { abstain: true, reason: "insufficient evidence" },
    { detected: false, rationale: "no violation" },
    {
      cue_utilization: 5,
      cue_weighting: 4,
      context_sensitivity: 5,
      action_consistency: 4,
      rationale: "consistent",
    },
    { preferred: "left", rationale: "better match" },
  ].map((value) => responsesOutput(JSON.stringify(value)));
  const broker = await startCaptureBroker(outputs);
  try {
    const transport = createResponsesJudgeTransport({
      endpoint: broker.endpoint,
      capability: "judge-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: root,
    });
    const requests = [
      { kind: "pointwise", dimension: "task_performance", prompt: "pointwise" },
      {
        kind: "pointwise",
        dimension: "hard_constraint_violation",
        prompt: "hard constraint",
      },
      {
        kind: "pointwise",
        dimension: "stated_rationale_alignment",
        prompt: "stated rationale",
      },
      { kind: "pairwise", dimension: "target_conditioned_preference", prompt: "pair" },
    ];
    let firstVerdictPath: string | undefined;
    for (const [index, request] of requests.entries()) {
      const result = await transport.evaluate(request);
      assert.equal(result.state, "measured");
      if (index === 0 && result.state === "measured" && result.verdict !== undefined) {
        firstVerdictPath = result.verdict.path;
      }
    }
    assert.deepEqual(
      broker.requests.map((raw) => (raw as Record<string, unknown>).input),
      requests.map((request) => request.prompt),
    );
    const formats = broker.requests.map(
      (raw) =>
        ((raw as Record<string, unknown>).text as { format: Record<string, unknown> })
          .format,
    );
    assert.deepEqual(
      formats,
      requests.map(() => ({ type: "json_object" })),
    );
    assert.ok(firstVerdictPath);
    assert.deepEqual(JSON.parse(await readFile(firstVerdictPath, "utf8")), {
      abstain: true,
      reason: "insufficient evidence",
    });
    for (const raw of broker.requests) {
      assert.equal((raw as Record<string, unknown>).store, false);
    }
  } finally {
    await broker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Responses candidate preserves valid input arrays, tools, and tool calls", async () => {
  const root = await mkdtemp(join(tmpdir(), "coffee-chat-eval-responses-body-"));
  const broker = await startCaptureBroker([
    responsesOutput("plain"),
    responsesOutput("ok"),
    {
      status: "completed",
      error: null,
      output: [
        {
          type: "function_call",
          call_id: "call-1",
          name: "lookup",
          arguments: '{"id":"1"}',
        },
      ],
    },
  ]);
  try {
    const transport = createResponsesCandidateTransport({
      kind: "agent_stack",
      endpoint: broker.endpoint,
      capability: "candidate-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: root,
    });
    assert.equal((await transport.run("plain input")).state, "measured");
    const body = {
      input: [
        { role: "user", content: [{ type: "input_text", text: "Use the tool" }] },
        {
          type: "function_call_output",
          call_id: "call-0",
          output: "previous result",
        },
      ],
      tools: [
        {
          type: "function",
          name: "lookup",
          description: "Lookup a record",
          parameters: { type: "object", properties: {}, additionalProperties: false },
          strict: true,
        },
      ],
    };
    assert.equal((await transport.run(body)).state, "measured");
    const toolResult = await transport.run([{ role: "user", content: "continue" }]);
    assert.equal(toolResult.state, "measured");
    assert.deepEqual(broker.requests[0], {
      input: "plain input",
      model: "gpt-5.6-luna",
      store: false,
    });
    assert.deepEqual(broker.requests[1], {
      ...body,
      model: "gpt-5.6-luna",
      store: false,
    });
    assert.deepEqual(broker.requests[2], {
      input: [{ role: "user", content: "continue" }],
      model: "gpt-5.6-luna",
      store: false,
    });
    if (toolResult.state !== "measured" || toolResult.output === undefined) return;
    assert.equal(toolResult.output.mediaType, "application/json");
    assert.deepEqual(JSON.parse(await readFile(toolResult.output.path, "utf8")), [
      {
        type: "function_call",
        call_id: "call-1",
        name: "lookup",
        arguments: '{"id":"1"}',
      },
    ]);
  } finally {
    await broker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Responses transports reject incomplete, error, and outputless HTTP 200 envelopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "coffee-chat-eval-envelope-failure-"));
  const broker = await startCaptureBroker([
    { status: "incomplete", error: null, output: [] },
    { status: "failed", error: { message: "provider failed" }, output: [] },
    { status: "completed", error: null, output: [] },
    { status: "incomplete", error: null, output: [] },
  ]);
  try {
    const candidate = createResponsesCandidateTransport({
      kind: "agent_stack",
      endpoint: broker.endpoint,
      capability: "candidate-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: root,
    });
    const judge = createResponsesJudgeTransport({
      endpoint: broker.endpoint,
      capability: "judge-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: root,
    });

    const candidateResult = await candidate.run("candidate input");
    assert.equal(candidateResult.state, "failed");
    const judgeError = await judge.evaluate({ prompt: "judge failed" });
    assert.equal(judgeError.state, "failed");
    const judgeOutputless = await judge.evaluate({ prompt: "judge outputless" });
    assert.equal(judgeOutputless.state, "failed");
    const judgeIncomplete = await judge.evaluate({ prompt: "judge incomplete" });
    assert.equal(judgeIncomplete.state, "unavailable");
    for (const raw of broker.requests) {
      assert.equal((raw as Record<string, unknown>).store, false);
    }
  } finally {
    await broker.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Responses candidate preserves the configured standard candidate kind", () => {
  for (const kind of ["reference_model", "agent_stack"] as const) {
    const transport = createResponsesCandidateTransport({
      kind,
      endpoint: "http://127.0.0.1:4311/v1/responses",
      capability: "candidate-capability",
      model: "gpt-5.6-luna",
      evidenceRoot: "/var/tmp/coffee-chat-eval-transport-kind",
    });
    assert.equal(transport.kind, kind);
  }
  for (const kind of ["fixture", "coffee_chat_product"] as const) {
    assert.throws(
      () =>
        createResponsesCandidateTransport({
          kind: kind as never,
          endpoint: "http://127.0.0.1:4311/v1/responses",
          capability: "candidate-capability",
          model: "gpt-5.6-luna",
          evidenceRoot: "/var/tmp/coffee-chat-eval-transport-kind",
        }),
      /Responses candidate kind/u,
    );
  }
});
