import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRunPlan, parseRunSpec } from "../src/eval-core.ts";
import { stableDigest } from "../src/identity.ts";
import {
  candidateIdentityDigest,
  judgeIdentityDigest,
  parseCandidateIdentityConfig,
  parseJudgeIdentityConfig,
  parseRuntimeBundleConfig,
  RESPONSES_AGENT_STACK_HARNESS,
  RESPONSES_REFERENCE_MODEL_HARNESS,
  type CandidateIdentityConfig,
  type JudgeIdentityConfig,
} from "../src/runtime-config.ts";
import { executeImmutableRun } from "../src/run-engine.ts";
import { getSourceManifest } from "../src/source-manifests.ts";
import {
  createResponsesCandidateTransport,
  createResponsesJudgeTransport,
} from "../src/transports.ts";

const BASE_IDENTITY = {
  schema: "candidate-config-v1",
  candidateType: "agent_stack",
  harness: RESPONSES_AGENT_STACK_HARNESS,
  model: "gpt-5.6-luna",
  seed: 7,
} as const;

function identity(input: { readonly model: string; readonly seed?: number }) {
  return parseCandidateIdentityConfig({
    ...BASE_IDENTITY,
    model: input.model,
    seed: input.seed ?? BASE_IDENTITY.seed,
  });
}

function candidateTransport(input: {
  readonly identity: CandidateIdentityConfig;
  readonly endpoint: string;
  readonly evidenceRoot: string;
  readonly forgedDigest?: `sha256:${string}`;
}) {
  const options = {
    kind: "agent_stack" as const,
    endpoint: input.endpoint,
    capability: "candidate-capability",
    model: input.identity.model,
    evidenceRoot: input.evidenceRoot,
    candidateIdentity: input.identity,
    ...(input.forgedDigest === undefined
      ? {}
      : { candidateDigest: input.forgedDigest }),
  };
  return createResponsesCandidateTransport(options);
}

function judgeTransport(input: {
  readonly identity: JudgeIdentityConfig;
  readonly endpoint: string;
  readonly evidenceRoot: string;
  readonly forgedDigest?: `sha256:${string}`;
}) {
  const options = {
    endpoint: input.endpoint,
    capability: "judge-capability",
    model: input.identity.model,
    evidenceRoot: input.evidenceRoot,
    judgeIdentity: input.identity,
    ...(input.forgedDigest === undefined ? {} : { judgeDigest: input.forgedDigest }),
  };
  return createResponsesJudgeTransport(options);
}

function privateFailureReason(
  result: Awaited<ReturnType<typeof executeImmutableRun>>,
): string {
  const evidence = JSON.parse(readFileSync(result.nativeEvidence.path, "utf8")) as {
    reason?: unknown;
  };
  return String(evidence.reason);
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

test("immutable run binds a Responses candidate to the planned model and harness identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-candidate-identity-"));
  let candidateRequests = 0;
  const server = createServer((_request, response) => {
    candidateRequests += 1;
    response.writeHead(500, { "content-type": "application/json" });
    response.end('{"error":"candidate must not be called"}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    if (address === null || typeof address === "string") {
      throw new TypeError("test broker did not expose a TCP address");
    }
    const endpoint = `http://127.0.0.1:${address.port}/v1/responses`;
    const manifest = getSourceManifest("agentdojo-security");
    const plannedIdentity = identity({
      model: BASE_IDENTITY.model,
    });

    for (const attack of [
      {
        name: "seed drift",
        boundIdentity: identity({ model: BASE_IDENTITY.model, seed: 8 }),
      },
      {
        name: "transport binding drift behind an otherwise matching run identity",
        boundIdentity: identity({ model: BASE_IDENTITY.model, seed: 8 }),
        runIdentity: plannedIdentity,
      },
      {
        name: "model drift",
        boundIdentity: identity({
          model: "gpt-5.6-terra",
        }),
      },
      {
        name: "forged digest cannot override normalized identity",
        boundIdentity: identity({ model: BASE_IDENTITY.model, seed: 8 }),
        runIdentity: plannedIdentity,
        forgedDigest: candidateIdentityDigest(plannedIdentity),
      },
      { name: "exact identity", boundIdentity: plannedIdentity },
    ]) {
      const boundIdentity = attack.boundIdentity;
      const plannedDigest = candidateIdentityDigest(plannedIdentity);
      const boundDigest = candidateIdentityDigest(boundIdentity);
      const evidenceRoot = join(
        root,
        `${attack.name.replaceAll(" ", "-")}-${boundDigest.replace("sha256:", "")}`,
        "evidence",
      );
      const plan = createRunPlan({
        manifest,
        spec: parseRunSpec({
          schema: "run-spec-v1",
          trackId: "agentdojo-security",
          profile: "smoke",
          sourceManifestDigest: stableDigest(manifest),
          candidateDigest: plannedDigest,
          judgeDigest: stableDigest("no-judge"),
          attackDigest: stableDigest("important_instructions_no_model_name"),
          defenseDigest: stableDigest("none"),
          configurationDigest: stableDigest("identity-binding-regression"),
          providerTermsDigest: manifest.providerTermsDigest,
          providerTermsReceiptDigest: stableDigest("provider-terms-receipt"),
          candidateType: "agent_stack",
          caseCensus: {
            benignEpisodes: 1,
            injectionControls: 1,
            attackedPairs: 1,
            episodes: 3,
          },
          isolationEvidenceDigest: stableDigest("isolation-receipt"),
          seed: 7,
        }),
        evidenceRoot,
        cacheRoot: join(root, "missing-cache"),
      });
      const runtime = parseRuntimeBundleConfig({
        schema: "runtime-bundle-v1",
        candidate: {
          schema: "runtime-capability-v1",
          scope: "candidate",
          endpoint,
          capabilityToken: "candidate-capability",
          model: boundIdentity.model,
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxRequests: 45,
        },
      });
      const candidate = candidateTransport({
        identity: boundIdentity,
        endpoint: runtime.candidate.endpoint,
        evidenceRoot,
        ...(attack.forgedDigest === undefined
          ? {}
          : { forgedDigest: attack.forgedDigest }),
      });
      const result = await executeImmutableRun({
        plan,
        manifest,
        candidate,
        candidateIdentity: attack.runIdentity ?? boundIdentity,
        judge: undefined,
        runtime,
      });

      if (boundDigest === plannedDigest) {
        assert.equal(result.trackReport.executionStatus, "unavailable");
        assert.equal(result.publicReceipt.failureOwner, "source");
        assert.doesNotMatch(privateFailureReason(result), /candidate identity/u);
      } else {
        assert.equal(result.trackReport.executionStatus, "invalid");
        assert.equal(result.publicReceipt.failureOwner, "verifier");
        assert.match(privateFailureReason(result), /candidate (?:transport|identity)/u);
      }
      assert.equal(candidateRequests, 0);
    }

    const terraRuntimeIdentity = identity({
      model: "gpt-5.6-terra",
    });
    assert.throws(
      () =>
        createResponsesCandidateTransport({
          kind: "agent_stack",
          endpoint,
          capability: "candidate-capability",
          model: terraRuntimeIdentity.model,
          evidenceRoot: join(root, "model-lie", "evidence"),
          candidateIdentity: plannedIdentity,
        }),
      /candidate identity model does not match .*model/u,
    );
    const referenceIdentity = parseCandidateIdentityConfig({
      ...BASE_IDENTITY,
      candidateType: "reference_model",
      harness: RESPONSES_REFERENCE_MODEL_HARNESS,
    });
    assert.throws(
      () =>
        createResponsesCandidateTransport({
          kind: "agent_stack",
          endpoint,
          capability: "candidate-capability",
          model: referenceIdentity.model,
          evidenceRoot: join(root, "kind-lie", "evidence"),
          candidateIdentity: referenceIdentity,
        }),
      /candidate identity type does not match .*transport kind/u,
    );
    assert.throws(
      () =>
        createResponsesCandidateTransport({
          kind: "agent_stack",
          endpoint,
          capability: "candidate-capability",
          model: BASE_IDENTITY.model,
          evidenceRoot: join(root, "harness-lie", "evidence"),
          candidateIdentity: {
            ...BASE_IDENTITY,
            harness: "alternate-agent-stack-v1",
          } as never,
        }),
      /candidate harness/u,
    );
    assert.equal(candidateRequests, 0);
  } finally {
    await closeServer(server);
    rmSync(root, { recursive: true, force: true });
  }
});

test("immutable run binds a Responses Judge to the planned Judge identity", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-judge-identity-"));
  let brokerRequests = 0;
  const server = createServer((_request, response) => {
    brokerRequests += 1;
    response.writeHead(500, { "content-type": "application/json" });
    response.end('{"error":"broker must not be called"}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new TypeError("test broker did not expose a TCP address");
    }
    const endpoint = `http://127.0.0.1:${address.port}/v1/responses`;
    const manifest = getSourceManifest("coffee-chat-taste");
    const candidateIdentity = identity({
      model: BASE_IDENTITY.model,
    });
    const plannedJudgeIdentity = parseJudgeIdentityConfig({
      schema: "judge-config-v1",
      transport: "responses",
      model: "gpt-5.6-luna",
    });

    for (const attack of [
      {
        name: "Judge model drift",
        boundIdentity: parseJudgeIdentityConfig({
          schema: "judge-config-v1",
          transport: "responses",
          model: "gpt-5.6-terra",
        }),
      },
      {
        name: "Judge binding drift behind an otherwise matching run identity",
        boundIdentity: parseJudgeIdentityConfig({
          schema: "judge-config-v1",
          transport: "responses",
          model: "gpt-5.6-terra",
        }),
        runIdentity: plannedJudgeIdentity,
      },
      {
        name: "forged Judge digest cannot override normalized identity",
        boundIdentity: parseJudgeIdentityConfig({
          schema: "judge-config-v1",
          transport: "responses",
          model: "gpt-5.6-terra",
        }),
        runIdentity: plannedJudgeIdentity,
        forgedDigest: judgeIdentityDigest(plannedJudgeIdentity),
      },
      { name: "exact Judge identity", boundIdentity: plannedJudgeIdentity },
    ]) {
      const plannedJudgeDigest = judgeIdentityDigest(plannedJudgeIdentity);
      const boundJudgeDigest = judgeIdentityDigest(attack.boundIdentity);
      const evidenceRoot = join(
        root,
        `${attack.name.replaceAll(" ", "-")}-${boundJudgeDigest.replace("sha256:", "")}`,
        "evidence",
      );
      const plan = createRunPlan({
        manifest,
        spec: parseRunSpec({
          schema: "run-spec-v1",
          trackId: "coffee-chat-taste",
          profile: "smoke",
          sourceManifestDigest: stableDigest(manifest),
          candidateDigest: candidateIdentityDigest(candidateIdentity),
          judgeDigest: plannedJudgeDigest,
          attackDigest: stableDigest("no-attack"),
          defenseDigest: stableDigest("no-defense"),
          configurationDigest: stableDigest("judge-identity-binding-regression"),
          providerTermsDigest: manifest.providerTermsDigest,
          providerTermsReceiptDigest: stableDigest("provider-terms-receipt"),
          candidateType: "agent_stack",
          caseCensus: { families: 1, submissions: 3, judgeCalls: 21 },
          isolationEvidenceDigest: stableDigest("isolation-receipt"),
          seed: 7,
        }),
        evidenceRoot,
        cacheRoot: join(root, "missing-cache"),
      });
      const runtime = parseRuntimeBundleConfig({
        schema: "runtime-bundle-v1",
        candidate: {
          schema: "runtime-capability-v1",
          scope: "candidate",
          endpoint,
          capabilityToken: "candidate-capability",
          model: candidateIdentity.model,
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxRequests: 3,
        },
        judge: {
          schema: "runtime-capability-v1",
          scope: "judge",
          endpoint,
          capabilityToken: "judge-capability",
          model: attack.boundIdentity.model,
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxRequests: 21,
        },
      });
      const candidate = candidateTransport({
        identity: candidateIdentity,
        endpoint: runtime.candidate.endpoint,
        evidenceRoot,
      });
      const judge = judgeTransport({
        identity: attack.boundIdentity,
        endpoint: runtime.judge!.endpoint,
        evidenceRoot,
        ...(attack.forgedDigest === undefined
          ? {}
          : { forgedDigest: attack.forgedDigest }),
      });
      const result = await executeImmutableRun({
        plan,
        manifest,
        candidate,
        candidateIdentity,
        judge,
        judgeIdentity: attack.runIdentity ?? attack.boundIdentity,
        runtime,
      });

      if (boundJudgeDigest === plannedJudgeDigest) {
        assert.equal(result.trackReport.executionStatus, "unavailable");
        assert.equal(result.publicReceipt.failureOwner, "source");
        assert.doesNotMatch(privateFailureReason(result), /Judge identity/u);
      } else {
        assert.equal(result.trackReport.executionStatus, "invalid");
        assert.equal(result.publicReceipt.failureOwner, "verifier");
        assert.match(privateFailureReason(result), /Judge .*identity/u);
      }
      assert.equal(brokerRequests, 0);
    }

    assert.throws(
      () =>
        createResponsesJudgeTransport({
          endpoint,
          capability: "judge-capability",
          model: "gpt-5.6-terra",
          evidenceRoot: join(root, "judge-model-lie", "evidence"),
          judgeIdentity: plannedJudgeIdentity,
        }),
      /Judge identity model does not match .*model/u,
    );
    assert.equal(brokerRequests, 0);
  } finally {
    await closeServer(server);
    rmSync(root, { recursive: true, force: true });
  }
});
