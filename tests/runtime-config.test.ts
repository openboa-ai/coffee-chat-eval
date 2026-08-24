import assert from "node:assert/strict";
import test from "node:test";

import {
  COFFEE_CHAT_PRODUCT_COMMIT,
  COFFEE_CHAT_PRODUCT_HARNESS,
  COFFEE_CHAT_PRODUCT_MODEL,
  COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
  COFFEE_CHAT_PRODUCT_SEED,
  RESPONSES_AGENT_STACK_HARNESS,
  RESPONSES_REFERENCE_MODEL_HARNESS,
  candidateIdentityDigest,
  parseCandidateIdentityConfig,
  parseJudgeIdentityConfig,
  parseRuntimeBundleConfig,
  parseRuntimeCapabilityConfig,
  runtimeCapabilityDigest,
} from "../src/runtime-config.ts";

test("identity configs contain model identity only and reject ephemeral capabilities", () => {
  const candidate = parseCandidateIdentityConfig({
    schema: "candidate-config-v1",
    candidateType: "agent_stack",
    harness: RESPONSES_AGENT_STACK_HARNESS,
    model: "gpt-5.6-luna",
    seed: 7,
  });
  assert.equal(candidate.model, "gpt-5.6-luna");
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        schema: "candidate-config-v1",
        candidateType: "agent_stack",
        harness: RESPONSES_AGENT_STACK_HARNESS,
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

test("standard candidate identities admit only the implemented Responses harness", () => {
  const reference = parseCandidateIdentityConfig({
    schema: "candidate-config-v1",
    candidateType: "reference_model",
    harness: RESPONSES_REFERENCE_MODEL_HARNESS,
    model: "gpt-5.6-luna",
  });
  assert.equal(reference.harness, RESPONSES_REFERENCE_MODEL_HARNESS);

  for (const candidate of [
    {
      schema: "candidate-config-v1",
      candidateType: "agent_stack",
      harness: "alternate-agent-stack-v1",
      model: "gpt-5.6-luna",
    },
    {
      schema: "candidate-config-v1",
      candidateType: "reference_model",
      harness: RESPONSES_AGENT_STACK_HARNESS,
      model: "gpt-5.6-luna",
    },
  ] as const) {
    assert.throws(() => parseCandidateIdentityConfig(candidate), /harness/u);
  }
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

test("coffee_chat_product identity pins immutable product provenance", () => {
  const product = parseCandidateIdentityConfig({
    schema: "candidate-config-v1",
    candidateType: "coffee_chat_product",
    harness: COFFEE_CHAT_PRODUCT_HARNESS,
    model: COFFEE_CHAT_PRODUCT_MODEL,
    seed: COFFEE_CHAT_PRODUCT_SEED,
    product: {
      repository: "https://github.com/openboa-ai/coffee-chat",
      commit: COFFEE_CHAT_PRODUCT_COMMIT,
      calver: "2026.8.23",
      packageDigest: COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
      mode: "connectivity_only",
    },
  });

  assert.equal(product.candidateType, "coffee_chat_product");
  if (product.candidateType !== "coffee_chat_product")
    throw new Error("expected coffee_chat_product identity");
  assert.equal(product.product.calver, "2026.8.23");
  assert.equal(Object.isFrozen(product.product), true);
  assert.equal("packageRoot" in product.product, false);
  assert.equal("capabilityToken" in product, false);
});

test("coffee_chat_product identity fails closed on missing or drifting provenance", () => {
  const base = {
    schema: "candidate-config-v1",
    candidateType: "coffee_chat_product",
    harness: COFFEE_CHAT_PRODUCT_HARNESS,
    model: COFFEE_CHAT_PRODUCT_MODEL,
    seed: COFFEE_CHAT_PRODUCT_SEED,
    product: {
      repository: "https://github.com/openboa-ai/coffee-chat",
      commit: COFFEE_CHAT_PRODUCT_COMMIT,
      calver: "2026.8.23",
      packageDigest: COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
      mode: "connectivity_only",
    },
  } as const;

  assert.throws(
    () => parseCandidateIdentityConfig({ ...base, product: undefined }),
    /product|unexpected/u,
  );
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        ...base,
        product: { ...base.product, repository: "https://example.com/product" },
      }),
    /repository/u,
  );
  assert.throws(
    () => parseCandidateIdentityConfig({ ...base, harness: "other-host" }),
    /harness/u,
  );
  assert.throws(
    () => parseCandidateIdentityConfig({ ...base, model: "other-model" }),
    /model/u,
  );
  assert.throws(() => parseCandidateIdentityConfig({ ...base, seed: 8 }), /seed/u);
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        ...base,
        product: { ...base.product, commit: "0".repeat(40) },
      }),
    /commit/u,
  );
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        ...base,
        product: { ...base.product, calver: "2026.8.24" },
      }),
    /CalVer/u,
  );
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        ...base,
        product: { ...base.product, packageDigest: `sha256:${"0".repeat(64)}` },
      }),
    /package digest/u,
  );
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        ...base,
        product: { ...base.product, mode: "full_product" },
      }),
    /mode/u,
  );
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        ...base,
        product: {
          ...base.product,
          packageRoot: "/private/tmp/coffee-chat-package",
        },
      }),
    /unexpected/u,
  );
  assert.throws(
    () =>
      parseCandidateIdentityConfig({
        schema: "candidate-config-v1",
        candidateType: "agent_stack",
        harness: RESPONSES_AGENT_STACK_HARNESS,
        model: "gpt-5.6-luna",
        product: base.product,
      }),
    /unexpected|product/u,
  );
});

test("runtime product host remains private and does not affect immutable identity", () => {
  const identity = parseCandidateIdentityConfig({
    schema: "candidate-config-v1",
    candidateType: "coffee_chat_product",
    harness: COFFEE_CHAT_PRODUCT_HARNESS,
    model: COFFEE_CHAT_PRODUCT_MODEL,
    seed: COFFEE_CHAT_PRODUCT_SEED,
    product: {
      repository: "https://github.com/openboa-ai/coffee-chat",
      commit: COFFEE_CHAT_PRODUCT_COMMIT,
      calver: "2026.8.23",
      packageDigest: COFFEE_CHAT_PRODUCT_PACKAGE_DIGEST,
      mode: "connectivity_only",
    },
  });
  const immutableIdentityDigest = candidateIdentityDigest(identity);
  const capability = {
    schema: "runtime-capability-v1",
    scope: "candidate",
    endpoint: "http://127.0.0.1:9000/v1/responses",
    capabilityToken: "first-private-token",
    model: "gpt-5.6-luna",
    expiresAt: "2026-08-24T00:00:00Z",
    maxRequests: 9,
  } as const;
  const first = parseRuntimeBundleConfig({
    schema: "runtime-bundle-v1",
    candidate: capability,
    productHost: {
      schema: "product-host-runtime-v1",
      host: "eval-skills-reference-host-v1",
      packageRoot: "/private/tmp/coffee-chat-package-a",
    },
  });
  const second = parseRuntimeBundleConfig({
    schema: "runtime-bundle-v1",
    candidate: { ...capability, capabilityToken: "second-private-token" },
    productHost: {
      schema: "product-host-runtime-v1",
      host: "eval-skills-reference-host-v1",
      packageRoot: "/private/tmp/coffee-chat-package-b",
    },
  });

  assert.equal(first.productHost?.packageRoot, "/private/tmp/coffee-chat-package-a");
  assert.equal(Object.isFrozen(first.productHost), true);
  assert.equal(candidateIdentityDigest(identity), immutableIdentityDigest);
  assert.equal(
    runtimeCapabilityDigest(first.candidate),
    runtimeCapabilityDigest(second.candidate),
  );
  if (identity.candidateType !== "coffee_chat_product")
    throw new Error("expected coffee_chat_product identity");
  assert.equal("packageRoot" in identity.product, false);
});

test("runtime product host rejects relative paths and contract drift", () => {
  const runtime = {
    schema: "runtime-bundle-v1",
    candidate: {
      schema: "runtime-capability-v1",
      scope: "candidate",
      endpoint: "http://127.0.0.1:9000/v1/responses",
      capabilityToken: "candidate-capability",
      model: "gpt-5.6-luna",
      expiresAt: "2026-08-24T00:00:00Z",
      maxRequests: 9,
    },
    productHost: {
      schema: "product-host-runtime-v1",
      host: "eval-skills-reference-host-v1",
      packageRoot: "/private/tmp/coffee-chat-package",
    },
  } as const;

  assert.throws(
    () =>
      parseRuntimeBundleConfig({
        ...runtime,
        productHost: { ...runtime.productHost, packageRoot: "relative/package" },
      }),
    /absolute/u,
  );
  assert.throws(
    () =>
      parseRuntimeBundleConfig({
        ...runtime,
        productHost: { ...runtime.productHost, host: "unknown-host" },
      }),
    /host/u,
  );
  assert.throws(
    () =>
      parseRuntimeBundleConfig({
        ...runtime,
        productHost: { ...runtime.productHost, extra: true },
      }),
    /unexpected/u,
  );
});
