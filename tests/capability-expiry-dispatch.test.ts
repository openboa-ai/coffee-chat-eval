import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
} from "../src/runtime-config.ts";
import { executeImmutableRun } from "../src/run-engine.ts";
import { materializeSource } from "../src/source-cache.ts";
import { getSourceManifest } from "../src/source-manifests.ts";
import {
  createResponsesCandidateTransport,
  createResponsesJudgeTransport,
} from "../src/transports.ts";

const PREFLIGHT_TIME = Date.parse("2026-08-25T00:00:00.000Z");
const DISPATCH_TIME = PREFLIGHT_TIME + 2_000;

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

async function runExpiryBoundary(expiringRole: "candidate" | "Judge"): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-dispatch-expiry-"));
  let brokerRequests = 0;
  const server = createServer((_request, response) => {
    brokerRequests += 1;
    response.writeHead(500, { "content-type": "application/json" });
    response.end('{"error":"expired capability must not be called"}');
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const originalNow = Date.now;
  try {
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new TypeError("test broker did not expose a TCP address");
    }
    const endpoint = `http://127.0.0.1:${address.port}/v1/responses`;
    const manifest = getSourceManifest("coffee-chat-taste");
    const sourceRoot = join(root, "source-input");
    mkdirSync(sourceRoot);
    const license = readFileSync(new URL("../LICENSE", import.meta.url));
    writeFileSync(join(sourceRoot, "LICENSE"), license);
    const cacheRoot = join(root, "cache");
    materializeSource({
      manifest,
      cacheRoot,
      sourceRoot,
      runtimeLockDigest: stableDigest("dispatch-expiry-test-runtime-lock"),
      licenseEvidence: [
        {
          path: "LICENSE",
          digest: manifest.source.licenseDigest!,
          license: "MIT",
        },
      ],
    });

    const candidateIdentity = parseCandidateIdentityConfig({
      schema: "candidate-config-v1",
      candidateType: "agent_stack",
      harness: "responses-agent-stack-v1",
      model: "gpt-5.6-luna",
      seed: 7,
    });
    const judgeIdentity = parseJudgeIdentityConfig({
      schema: "judge-config-v1",
      transport: "responses",
      model: "gpt-5.6-luna",
    });
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "coffee-chat-taste",
      profile: "smoke",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: candidateIdentityDigest(candidateIdentity),
      judgeDigest: judgeIdentityDigest(judgeIdentity),
      attackDigest: stableDigest("no-attack"),
      defenseDigest: stableDigest("no-defense"),
      configurationDigest: stableDigest({ expiringRole }),
      providerTermsDigest: manifest.providerTermsDigest,
      providerTermsReceiptDigest: stableDigest("provider-terms-receipt"),
      candidateType: "agent_stack",
      caseCensus: { families: 1, submissions: 3, judgeCalls: 21 },
      isolationEvidenceDigest: stableDigest("isolation-receipt"),
      seed: 7,
    });
    const evidenceRoot = join(root, "evidence");
    const plan = createRunPlan({ manifest, spec, evidenceRoot, cacheRoot });
    const expiresSoon = new Date(PREFLIGHT_TIME + 1_000).toISOString();
    const expiresLater = new Date(PREFLIGHT_TIME + 60_000).toISOString();
    const runtime = parseRuntimeBundleConfig({
      schema: "runtime-bundle-v1",
      candidate: {
        schema: "runtime-capability-v1",
        scope: "candidate",
        endpoint,
        capabilityToken: "candidate-capability",
        model: candidateIdentity.model,
        expiresAt: expiringRole === "candidate" ? expiresSoon : expiresLater,
        maxRequests: 3,
      },
      judge: {
        schema: "runtime-capability-v1",
        scope: "judge",
        endpoint,
        capabilityToken: "judge-capability",
        model: judgeIdentity.model,
        expiresAt: expiringRole === "Judge" ? expiresSoon : expiresLater,
        maxRequests: 21,
      },
    });
    const candidate = createResponsesCandidateTransport({
      kind: "agent_stack",
      endpoint: runtime.candidate.endpoint,
      capability: runtime.candidate.capabilityToken,
      model: runtime.candidate.model,
      evidenceRoot,
      candidateIdentity,
    });
    const judge = createResponsesJudgeTransport({
      endpoint: runtime.judge!.endpoint,
      capability: runtime.judge!.capabilityToken,
      model: runtime.judge!.model,
      evidenceRoot,
      judgeIdentity,
    });

    let clockReads = 0;
    Date.now = () => {
      clockReads += 1;
      return clockReads === 1 ? PREFLIGHT_TIME : DISPATCH_TIME;
    };
    const result = await executeImmutableRun({
      plan,
      manifest,
      candidate,
      candidateIdentity,
      judge,
      judgeIdentity,
      runtime,
    });

    assert.ok(clockReads >= 2, "runtime expiry must be checked again at dispatch");
    assert.equal(result.trackReport.executionStatus, "unavailable");
    assert.equal(result.publicReceipt.failureOwner, "host");
    assert.match(
      privateFailureReason(result),
      new RegExp(`${expiringRole} runtime capability is expired`, "u"),
    );
    assert.equal(brokerRequests, 0);
  } finally {
    Date.now = originalNow;
    await closeServer(server);
    rmSync(root, { recursive: true, force: true });
  }
}

test("candidate capability is rechecked after source verification and before dispatch", async () => {
  await runExpiryBoundary("candidate");
});

test("Judge capability is rechecked after source verification and before dispatch", async () => {
  await runExpiryBoundary("Judge");
});
