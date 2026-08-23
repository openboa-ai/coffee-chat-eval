import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCandidateIdentityConfig,
  parseJudgeIdentityConfig,
  parseRuntimeCapabilityConfig,
} from "../src/runtime-config.ts";

test("identity configs contain model identity only and reject ephemeral capabilities", () => {
  const candidate = parseCandidateIdentityConfig({
    schema: "candidate-config-v1",
    candidateType: "agent_stack",
    harness: "responses-agent-stack-v1",
    model: "gpt-5.6-luna",
    seed: 7,
  });
  assert.equal(candidate.model, "gpt-5.6-luna");
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        schema: "candidate-config-v1",
        candidateType: "agent_stack",
        harness: "responses-agent-stack-v1",
        model: "gpt-5.6-luna",
        endpoint: "http://127.0.0.1:1",
      }),
    /unexpected|capability|endpoint/u,
  );
  const judge = parseJudgeIdentityConfig({
    schema: "judge-config-v1",
    transport: "responses",
    model: "gpt-5.6-luna",
  });
  assert.equal(judge.transport, "responses");
});

test("runtime capability is scoped, expiring, and budgeted separately", () => {
  const runtime = parseRuntimeCapabilityConfig({
    schema: "runtime-capability-v1",
    scope: "candidate",
    endpoint: "http://127.0.0.1:9000/v1/responses",
    capabilityToken: "candidate-capability",
    model: "gpt-5.6-luna",
    expiresAt: "2026-08-24T00:00:00Z",
    maxRequests: 9,
  });
  assert.equal(runtime.scope, "candidate");
  assert.equal(runtime.maxRequests, 9);
  assert.throws(
    () => parseRuntimeCapabilityConfig({ ...runtime, scope: "judge", maxRequests: 0 }),
    /positive|scope/u,
  );
});
