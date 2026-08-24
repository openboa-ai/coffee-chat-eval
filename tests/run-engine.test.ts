import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stableDigest } from "../src/identity.ts";
import {
  IFEVAL_NATIVE_RUNTIME_RIGHTS,
  IFEVAL_SOURCE,
  ifevalRightsRiskAcceptanceDigest,
  parseIfevalRightsRiskAcceptance,
} from "../src/ifeval.ts";
import {
  createRunPlan,
  parseRunSpec,
  parseSourceManifest,
  type JudgeTransport,
  type ProductCandidateBoundary,
  type RunProfile,
} from "../src/eval-core.ts";
import { materializeSource } from "../src/source-cache.ts";
import { getSourceManifest } from "../src/source-manifests.ts";
import {
  createFixtureCandidateTransport,
  createResponsesJudgeTransport,
} from "../src/transports.ts";
import { executeImmutableRun, validateRuntimeForRun } from "../src/run-engine.ts";
import {
  COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST,
  COFFEE_CHAT_PRODUCT_CANDIDATE_IDENTITY,
  COFFEE_CHAT_PRODUCT_MODEL,
  COFFEE_CHAT_PRODUCT_SEED,
  parseRuntimeBundleConfig,
} from "../src/runtime-config.ts";
import { IFEVAL_RUNTIME_LOCK, requireRuntimePython } from "../src/python-runtime.ts";
import { createIfevalTrackExecutor } from "../src/ifeval.ts";

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const PRODUCT_BOUNDARY: ProductCandidateBoundary = Object.freeze({
  candidateMode: "connectivity_only",
  capabilitiesUsed: Object.freeze([]) as readonly [],
  productBehaviorExercised: false,
  referenceHost: "eval-skills-reference-host-v1",
  productIdentity: Object.freeze({
    repository: "https://github.com/openboa-ai/coffee-chat",
    commit: "e1ac82de77ab12b9b2499771a194ef3db356b3a6",
    calver: "2026.8.23",
    packageDigest:
      "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41",
  }),
});

function ifevalRiskAcceptance(candidateDigest: `sha256:${string}`) {
  return parseIfevalRightsRiskAcceptance({
    schema: "ifeval-rights-risk-acceptance-v1",
    trackId: "ifeval",
    profile: "smoke",
    candidateType: "coffee_chat_product",
    candidateDigest,
    ifevalSourceCommit: IFEVAL_SOURCE.commit,
    assetRepository: IFEVAL_NATIVE_RUNTIME_RIGHTS.repository,
    assetRevision: IFEVAL_NATIVE_RUNTIME_RIGHTS.revision,
    asset: IFEVAL_NATIVE_RUNTIME_RIGHTS.asset,
    assetDigest: IFEVAL_NATIVE_RUNTIME_RIGHTS.digest,
    licenseStatus: "unclarified",
    licenseCleared: false,
    scope: "private-internal-smoke-only",
    acceptedBy: "workspace-owner",
    acceptedAt: "2026-08-25T09:00:00+09:00",
    privateNonce: "d".repeat(64),
    acknowledgesNoLicenseGrant: true,
    acknowledgesNoRedistribution: true,
    acknowledgesNoPublicNumericClaim: true,
  });
}

function productIfevalRunFixture(input: {
  readonly root: string;
  readonly candidateDigest: `sha256:${string}`;
  readonly runtimeModel: string;
  readonly seed: number | undefined;
}) {
  const manifest = getSourceManifest("ifeval");
  const acceptance = ifevalRiskAcceptance(input.candidateDigest);
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId: "ifeval",
    profile: "smoke",
    sourceManifestDigest: stableDigest(manifest),
    candidateDigest: input.candidateDigest,
    judgeDigest: stableDigest("judge"),
    attackDigest: stableDigest("attack"),
    defenseDigest: stableDigest("defense"),
    configurationDigest: stableDigest({
      candidateDigest: input.candidateDigest,
      ...(input.seed === undefined ? {} : { seed: input.seed }),
    }),
    providerTermsDigest: manifest.providerTermsDigest,
    providerTermsReceiptDigest: stableDigest("provider-terms-receipt"),
    rightsRiskAcceptanceDigest: ifevalRightsRiskAcceptanceDigest(acceptance),
    candidateType: "coffee_chat_product",
    caseCensus: { prompts: 9 },
    isolationEvidenceDigest: stableDigest("isolation"),
    ...(input.seed === undefined ? {} : { seed: input.seed }),
  });
  const plan = createRunPlan({
    manifest,
    spec,
    evidenceRoot: join(input.root, "evidence"),
    cacheRoot: join(input.root, "missing-cache"),
  });
  const runtime = parseRuntimeBundleConfig({
    schema: "runtime-bundle-v1",
    candidate: {
      schema: "runtime-capability-v1",
      scope: "candidate",
      endpoint: "http://127.0.0.1:4311",
      capabilityToken: "candidate-capability",
      model: input.runtimeModel,
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxRequests: 9,
    },
    productHost: {
      schema: "product-host-runtime-v1",
      host: "eval-skills-reference-host-v1",
      packageRoot: join(input.root, "must-not-verify-product-package"),
    },
  });
  return { acceptance, manifest, plan, runtime };
}

async function executeProductIfevalFixture(
  fixture: ReturnType<typeof productIfevalRunFixture>,
  runtime:
    ReturnType<typeof productIfevalRunFixture>["runtime"] | null = fixture.runtime,
) {
  let candidateCalls = 0;
  const result = await executeImmutableRun({
    plan: fixture.plan,
    manifest: fixture.manifest,
    candidate: {
      kind: "coffee_chat_product",
      productBoundary: PRODUCT_BOUNDARY,
      run: async () => {
        candidateCalls += 1;
        return {
          state: "failed" as const,
          reason: "must-not-run",
          failureOwner: "candidate" as const,
        };
      },
    },
    judge: undefined,
    ...(runtime === null ? {} : { runtime }),
    ifevalRightsRiskAcceptance: fixture.acceptance,
  });
  return { candidateCalls, result };
}

function privateFailureReason(
  result: Awaited<ReturnType<typeof executeImmutableRun>>,
): string {
  return String(
    (
      JSON.parse(readFileSync(result.nativeEvidence.path, "utf8")) as {
        reason?: unknown;
      }
    ).reason,
  );
}

function assertNoRightsRiskProvenance(
  result: Awaited<ReturnType<typeof executeImmutableRun>>,
): void {
  assert.equal(result.publicReceipt.rightsRiskAcceptanceDigest, undefined);
  assert.equal(result.trackReport.provenance.rightsRiskAcceptanceDigest, undefined);
}

function filesBelow(root: string): readonly string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

type NativeJudgeTrack = "coffee-chat-taste" | "beam-record-core";

function liveJudgeBindingFixture(trackId: NativeJudgeTrack) {
  const root = mkdtempSync(
    join(tmpdir(), `coffee-chat-eval-${trackId}-judge-binding-`),
  );
  const manifest = getSourceManifest(trackId);
  const judgeCalls = trackId === "coffee-chat-taste" ? 21 : 11;
  const candidateCalls = trackId === "coffee-chat-taste" ? 3 : 6;
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId,
    profile: "smoke",
    sourceManifestDigest: stableDigest(manifest),
    candidateDigest: stableDigest(`${trackId}-candidate`),
    judgeDigest: stableDigest(`${trackId}-judge`),
    attackDigest: stableDigest("attack"),
    defenseDigest: stableDigest("defense"),
    configurationDigest: stableDigest(`${trackId}-configuration`),
    providerTermsDigest: manifest.providerTermsDigest,
    providerTermsReceiptDigest: stableDigest("provider-terms-receipt"),
    candidateType: "agent_stack",
    caseCensus:
      trackId === "coffee-chat-taste"
        ? { families: 1, submissions: 3, judgeCalls }
        : { conversations: 1, queries: 6, judgeCalls },
    isolationEvidenceDigest: stableDigest("isolation"),
    seed: 7,
  });
  const plan = createRunPlan({
    manifest,
    spec,
    evidenceRoot: join(root, "evidence"),
    cacheRoot: join(root, "missing-cache"),
  });
  const runtime = parseRuntimeBundleConfig({
    schema: "runtime-bundle-v1",
    candidate: {
      schema: "runtime-capability-v1",
      scope: "candidate",
      endpoint: "http://127.0.0.1:4311",
      capabilityToken: "candidate-capability",
      model: "gpt-5.6-luna",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxRequests: candidateCalls,
    },
    judge: {
      schema: "runtime-capability-v1",
      scope: "judge",
      endpoint: "http://127.0.0.1:4312",
      capabilityToken: "judge-capability",
      model: "gpt-5.6-luna",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxRequests: judgeCalls,
    },
  });
  return { root, manifest, plan, runtime };
}

async function executeUntrustedJudge(input: {
  readonly trackId: NativeJudgeTrack;
  readonly judge: JudgeTransport;
  readonly runtime?: ReturnType<typeof parseRuntimeBundleConfig>;
  readonly fixture?: ReturnType<typeof liveJudgeBindingFixture>;
}) {
  const fixture = input.fixture ?? liveJudgeBindingFixture(input.trackId);
  let candidateCalls = 0;
  const result = await executeImmutableRun({
    plan: fixture.plan,
    manifest: fixture.manifest,
    candidate: {
      kind: "agent_stack",
      run: async () => {
        candidateCalls += 1;
        return {
          state: "failed" as const,
          reason: "untrusted Judge reached native evaluation",
          failureOwner: "candidate" as const,
        };
      },
    },
    judge: input.judge,
    runtime: input.runtime ?? fixture.runtime,
  });
  return { candidateCalls, fixture, result };
}

test("live native-Judge tracks reject arbitrary Judge transports before evaluation", async () => {
  for (const trackId of ["coffee-chat-taste", "beam-record-core"] as const) {
    let judgeCalls = 0;
    const { candidateCalls, fixture, result } = await executeUntrustedJudge({
      trackId,
      judge: {
        kind: "sealed-judge",
        evaluate: async () => {
          judgeCalls += 1;
          return {
            state: "failed" as const,
            reason: "must not evaluate",
            failureOwner: "judge" as const,
          };
        },
      },
    });
    try {
      assert.equal(result.trackReport.executionStatus, "invalid");
      assert.equal(result.publicReceipt.failureOwner, "verifier");
      assert.equal(candidateCalls, 0);
      assert.equal(judgeCalls, 0);
      assert.match(privateFailureReason(result), /Judge transport is not bound/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("live native-Judge tracks reject a structural copy of a factory transport", async () => {
  for (const trackId of ["coffee-chat-taste", "beam-record-core"] as const) {
    const fixture = liveJudgeBindingFixture(trackId);
    let judgeCalls = 0;
    const minted = createResponsesJudgeTransport({
      endpoint: fixture.runtime.judge!.endpoint,
      capability: fixture.runtime.judge!.capabilityToken,
      model: fixture.runtime.judge!.model,
      evidenceRoot: fixture.plan.evidenceRoot,
    });
    const copied: JudgeTransport = {
      ...minted,
      evaluate: async (request) => {
        judgeCalls += 1;
        return minted.evaluate(request);
      },
    };
    try {
      const { candidateCalls, result } = await executeUntrustedJudge({
        trackId,
        fixture,
        judge: copied,
      });
      assert.equal(result.trackReport.executionStatus, "invalid");
      assert.equal(result.publicReceipt.failureOwner, "verifier");
      assert.equal(candidateCalls, 0);
      assert.equal(judgeCalls, 0);
      assert.match(privateFailureReason(result), /Judge transport is not bound/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("live native-Judge tracks reject endpoint, capability, or model runtime drift", async () => {
  const driftCases = [
    { endpoint: "http://127.0.0.1:4313" },
    { capabilityToken: "different-judge-capability" },
    { model: "gpt-5.6-terra" },
  ] as const;
  for (const [index, drift] of driftCases.entries()) {
    const trackId = index % 2 === 0 ? "coffee-chat-taste" : "beam-record-core";
    const fixture = liveJudgeBindingFixture(trackId);
    const judge = createResponsesJudgeTransport({
      endpoint: fixture.runtime.judge!.endpoint,
      capability: fixture.runtime.judge!.capabilityToken,
      model: fixture.runtime.judge!.model,
      evidenceRoot: fixture.plan.evidenceRoot,
    });
    const runtime = parseRuntimeBundleConfig({
      ...fixture.runtime,
      judge: { ...fixture.runtime.judge!, ...drift },
    });
    try {
      const { candidateCalls, result } = await executeUntrustedJudge({
        trackId,
        fixture,
        judge,
        runtime,
      });
      assert.equal(result.trackReport.executionStatus, "invalid");
      assert.equal(result.publicReceipt.failureOwner, "verifier");
      assert.equal(candidateCalls, 0);
      assert.match(privateFailureReason(result), /Judge transport is not bound/u);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("production run rejects a bridge-backed executor override before it can mint official artifacts", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-run-injection-"));
  let bridgeCalls = 0;
  try {
    const sourceInput = join(root, "source-input");
    const inputDataDirectory = join(sourceInput, "instruction_following_eval", "data");
    mkdirSync(inputDataDirectory, { recursive: true });
    writeFileSync(join(sourceInput, "LICENSE"), "license");
    writeFileSync(
      join(inputDataDirectory, "input_data.jsonl"),
      `${JSON.stringify({ key: 1000, prompt: "fixture prompt" })}\n`,
    );
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "8".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "instruction_following_eval/data/input_data.jsonl"],
      excludedPaths: ["responses/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    const cacheRoot = join(root, "cache");
    materializeSource({
      manifest,
      cacheRoot,
      sourceRoot: sourceInput,
      runtimeLockDigest: digest(readFileSync(IFEVAL_RUNTIME_LOCK, "utf8")),
      runtimeLockOrigin: "eval-owned",
      expectedRuntimeLockPath: IFEVAL_RUNTIME_LOCK,
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
      ],
    });
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "fixture",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      candidateType: "fixture",
      caseCensus: { prompts: 1 },
    });
    const evidenceRoot = join(root, "evidence");
    const plan = createRunPlan({ manifest, spec, evidenceRoot, cacheRoot });
    const injectedExecutor = createIfevalTrackExecutor({
      bridge: {
        run: async ({ output, keys }) => {
          bridgeCalls += 1;
          mkdirSync(join(output, ".."), { recursive: true });
          writeFileSync(
            output,
            JSON.stringify({
              source: { inputCount: keys.length, keys },
              metrics: Object.fromEntries(
                [
                  "strictPrompt",
                  "strictInstruction",
                  "loosePrompt",
                  "looseInstruction",
                ].map((metric) => [
                  metric,
                  { numerator: 1, denominator: 1, accuracy: 1 },
                ]),
              ),
            }),
          );
        },
      },
    });

    await assert.rejects(
      () =>
        executeImmutableRun({
          plan,
          manifest,
          candidate: createFixtureCandidateTransport(() => "fixture response", {
            evidenceRoot,
          }),
          judge: undefined,
          executor: injectedExecutor,
        } as never),
      /run executor override is not supported/u,
    );
    assert.equal(bridgeCalls, 0);
    assert.equal(existsSync(join(evidenceRoot, plan.id, "track-report.json")), false);
    assert.equal(existsSync(join(evidenceRoot, plan.id, "public-receipt.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function productRunFixture(
  profile: RunProfile,
  options: Readonly<{ providerTermsReceipt?: boolean }> = {},
) {
  const root = mkdtempSync(join(tmpdir(), `coffee-chat-eval-product-${profile}-`));
  const sourceInput = join(root, "source-input");
  mkdirSync(sourceInput);
  const licenseBytes = readFileSync(new URL("../LICENSE", import.meta.url));
  writeFileSync(join(sourceInput, "LICENSE"), licenseBytes);
  const manifest = getSourceManifest("coffee-chat-taste");
  const cacheRoot = join(root, "cache");
  materializeSource({
    manifest,
    cacheRoot,
    sourceRoot: sourceInput,
    runtimeLockDigest: stableDigest("lock"),
    licenseEvidence: [
      {
        path: "LICENSE",
        digest: manifest.source.licenseDigest!,
        license: "MIT",
      },
    ],
  });
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId: "coffee-chat-taste",
    profile,
    sourceManifestDigest: stableDigest(manifest),
    candidateDigest: COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST,
    judgeDigest: stableDigest("judge"),
    attackDigest: stableDigest("attack"),
    defenseDigest: stableDigest("defense"),
    configurationDigest: stableDigest("configuration"),
    providerTermsDigest: manifest.providerTermsDigest,
    ...(options.providerTermsReceipt === false
      ? {}
      : { providerTermsReceiptDigest: stableDigest("provider-terms-receipt") }),
    candidateType: "coffee_chat_product",
    seed: COFFEE_CHAT_PRODUCT_SEED,
    caseCensus:
      profile === "score"
        ? { families: 32, submissions: 96, judgeCalls: 672 }
        : { families: 1, submissions: 3, judgeCalls: 21 },
    isolationEvidenceDigest: stableDigest("isolation"),
  });
  const plan = createRunPlan({
    manifest,
    spec,
    evidenceRoot: join(root, "evidence"),
    cacheRoot,
  });
  const runtime = parseRuntimeBundleConfig({
    schema: "runtime-bundle-v1",
    candidate: {
      schema: "runtime-capability-v1",
      scope: "candidate",
      endpoint: "http://127.0.0.1:4311",
      capabilityToken: "candidate-capability",
      model: "gpt-5.6-luna",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxRequests: profile === "smoke" ? 3 : 96,
    },
    judge: {
      schema: "runtime-capability-v1",
      scope: "judge",
      endpoint: "http://127.0.0.1:4312",
      capabilityToken: "judge-capability",
      model: "gpt-5.6-luna",
      expiresAt: "2099-01-01T00:00:00.000Z",
      maxRequests: profile === "smoke" ? 21 : 672,
    },
    productHost: {
      schema: "product-host-runtime-v1",
      host: "eval-skills-reference-host-v1",
      packageRoot: "/private/tmp/coffee-chat-product-package",
    },
  });
  return { root, manifest, plan, runtime };
}

test("run engine resolves the canonical executor and writes private evidence plus reports", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-run-engine-"));
  try {
    const sourceInput = join(root, "source-input");
    const inputDataDirectory = join(sourceInput, "instruction_following_eval", "data");
    mkdirSync(inputDataDirectory, { recursive: true });
    writeFileSync(join(sourceInput, "LICENSE"), "license");
    writeFileSync(
      join(inputDataDirectory, "input_data.jsonl"),
      `${JSON.stringify({ key: 1000, prompt: "fixture prompt" })}\n`,
    );
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "c".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "instruction_following_eval/data/input_data.jsonl"],
      excludedPaths: ["responses/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    const cacheRoot = join(root, "cache");
    materializeSource({
      manifest,
      cacheRoot,
      sourceRoot: sourceInput,
      runtimeLockDigest: digest(readFileSync(IFEVAL_RUNTIME_LOCK, "utf8")),
      runtimeLockOrigin: "eval-owned",
      expectedRuntimeLockPath: IFEVAL_RUNTIME_LOCK,
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
      ],
    });
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "fixture",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      candidateType: "fixture",
      caseCensus: { prompts: 1 },
    });
    const plan = createRunPlan({
      manifest,
      spec,
      evidenceRoot: join(root, "evidence"),
      cacheRoot,
    });
    const candidate = createFixtureCandidateTransport(() => "fixture response", {
      evidenceRoot: plan.evidenceRoot,
    });
    const result = await executeImmutableRun({
      plan,
      manifest,
      candidate,
      judge: undefined,
    });
    assert.equal(result.trackReport.executionStatus, "measured");
    assert.equal(
      result.trackReport.provenance.nativeEvidenceDigest,
      result.trackReport.provenance.nativeEvidenceDigest,
    );
    assert.match(result.nativeEvidence.path, /evidence/u);
    assert.equal(
      readFileSync(result.publicReceiptPath, "utf8").includes("native"),
      false,
    );
    assert.equal(
      readFileSync(result.trackReportPath, "utf8").includes("strictPrompt"),
      true,
    );
    assert.equal(readFileSync(result.trialReceiptsPath, "utf8").startsWith("["), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run engine finalizes host cleanup before writing any run artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-run-cleanup-"));
  let cleanupCalls = 0;
  try {
    const sourceInput = join(root, "source-input");
    const inputDataDirectory = join(sourceInput, "instruction_following_eval", "data");
    mkdirSync(inputDataDirectory, { recursive: true });
    writeFileSync(join(sourceInput, "LICENSE"), "license");
    writeFileSync(
      join(inputDataDirectory, "input_data.jsonl"),
      `${JSON.stringify({ key: 1000, prompt: "fixture prompt" })}\n`,
    );
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "b".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE", "instruction_following_eval/data/input_data.jsonl"],
      excludedPaths: ["responses/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    const cacheRoot = join(root, "cache");
    materializeSource({
      manifest,
      cacheRoot,
      sourceRoot: sourceInput,
      runtimeLockDigest: digest(readFileSync(IFEVAL_RUNTIME_LOCK, "utf8")),
      runtimeLockOrigin: "eval-owned",
      expectedRuntimeLockPath: IFEVAL_RUNTIME_LOCK,
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
      ],
    });
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "fixture",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      candidateType: "fixture",
      caseCensus: { prompts: 1 },
    });
    const plan = createRunPlan({
      manifest,
      spec,
      evidenceRoot: join(root, "evidence"),
      cacheRoot,
    });
    const result = await executeImmutableRun({
      plan,
      manifest,
      candidate: createFixtureCandidateTransport(() => "fixture response", {
        evidenceRoot: plan.evidenceRoot,
      }),
      judge: undefined,
      hostCleanup: async () => {
        cleanupCalls += 1;
        return "failed";
      },
    });

    assert.equal(cleanupCalls, 1);
    assert.equal(result.cleanupStatus, "failed");
    assert.equal(result.trackReport.executionStatus, "invalid");
    assert.deepEqual(result.trackReport.metrics, {
      execution: { numerator: null, denominator: null, value: null },
    });
    assert.equal(result.publicReceipt.executionStatus, "invalid");
    assert.equal(result.publicReceipt.failureOwner, "cleanup");
    const trials = JSON.parse(readFileSync(result.trialReceiptsPath, "utf8")) as Array<
      Record<string, unknown>
    >;
    assert.equal(trials.length, 1);
    assert.equal(trials[0]?.executionStatus, "invalid");
    assert.equal(trials[0]?.failureOwner, "cleanup");
    assert.equal(trials[0]?.cleanupStatus, "failed");
    assert.equal(trials[0]?.metrics, null);
    const cleanupEvidence = JSON.parse(
      readFileSync(result.nativeEvidence.path, "utf8"),
    ) as Record<string, unknown>;
    assert.equal(cleanupEvidence.owner, "cleanup");
    assert.match(String(cleanupEvidence.priorNativeEvidenceDigest), /^sha256:/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run engine rejects a drifted admitted Eval-owned runtime lock before dispatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-run-lock-drift-"));
  try {
    const sourceInput = join(root, "source-input");
    mkdirSync(sourceInput);
    writeFileSync(join(sourceInput, "LICENSE"), "license");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "9".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE"],
      excludedPaths: ["responses/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    const cacheRoot = join(root, "cache");
    materializeSource({
      manifest,
      cacheRoot,
      sourceRoot: sourceInput,
      runtimeLockDigest: stableDigest("not the admitted IFEval lock bytes"),
      runtimeLockOrigin: "eval-owned",
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
      ],
    });
    assert.notEqual(
      digest(readFileSync(IFEVAL_RUNTIME_LOCK, "utf8")),
      stableDigest("not the admitted IFEval lock bytes"),
    );
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "fixture",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      candidateType: "fixture",
      caseCensus: { prompts: 1 },
    });
    const plan = createRunPlan({
      manifest,
      spec,
      evidenceRoot: join(root, "evidence"),
      cacheRoot,
    });
    const result = await executeImmutableRun({
      plan,
      manifest,
      candidate: createFixtureCandidateTransport((input) => ({ input })),
      judge: undefined,
    });
    assert.equal(result.trackReport.executionStatus, "unavailable");
    assert.equal(
      (
        JSON.parse(readFileSync(result.nativeEvidence.path, "utf8")) as {
          owner?: string;
        }
      ).owner,
      "source",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run engine gives IFEval native rights hold precedence over host and executor checks", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-rights-first-"));
  let candidateCalls = 0;
  try {
    const manifest = getSourceManifest("ifeval");
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "smoke",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      providerTermsDigest: manifest.providerTermsDigest,
      providerTermsReceiptDigest: stableDigest("provider-terms-receipt"),
      candidateType: "agent_stack",
      caseCensus: { prompts: 9 },
    });
    const plan = createRunPlan({
      manifest,
      spec,
      evidenceRoot: join(root, "evidence"),
      cacheRoot: join(root, "missing-cache"),
    });
    const result = await executeImmutableRun({
      plan,
      manifest,
      candidate: {
        kind: "agent_stack",
        run: async () => {
          candidateCalls += 1;
          return {
            state: "failed" as const,
            reason: "must-not-run",
            failureOwner: "candidate" as const,
          };
        },
      },
      judge: undefined,
      runtime: {
        schema: "runtime-bundle-v1",
        candidate: {
          schema: "runtime-capability-v1",
          scope: "candidate",
          endpoint: "https://nonlocal.example.invalid/responses",
          capabilityToken: "must-not-be-validated-before-rights-hold",
          model: "different-model",
          expiresAt: "not-an-iso-date",
          maxRequests: 0,
        },
      } as never,
    });

    const nativeEvidence = JSON.parse(
      readFileSync(result.nativeEvidence.path, "utf8"),
    ) as { readonly owner?: string; readonly reason?: string };
    assert.equal(result.trackReport.executionStatus, "rights_hold");
    assert.equal(nativeEvidence.owner, "rights");
    assert.match(nativeEvidence.reason ?? "", /punkt_tab/u);
    assert.equal(candidateCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source pin failure cannot publish unvalidated IFEval rights-risk provenance", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-source-drift-"));
  let candidateCalls = 0;
  try {
    const manifest = getSourceManifest("ifeval");
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "smoke",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      providerTermsDigest: manifest.providerTermsDigest,
      providerTermsReceiptDigest: stableDigest("provider-terms-receipt"),
      rightsRiskAcceptanceDigest: stableDigest("arbitrary missing acceptance"),
      candidateType: "coffee_chat_product",
      caseCensus: { prompts: 9 },
      isolationEvidenceDigest: stableDigest("isolation"),
    });
    const plan = createRunPlan({
      manifest,
      spec,
      evidenceRoot: join(root, "evidence"),
      cacheRoot: join(root, "missing-cache"),
    });
    const driftedManifest = Object.freeze({
      ...manifest,
      source: Object.freeze({
        ...manifest.source,
        commit: "f".repeat(40),
      }),
    });
    const result = await executeImmutableRun({
      plan,
      manifest: driftedManifest,
      candidate: {
        kind: "coffee_chat_product",
        productBoundary: PRODUCT_BOUNDARY,
        productHostPreflight: { state: "verified" },
        run: async () => {
          candidateCalls += 1;
          return {
            state: "failed" as const,
            reason: "must-not-run",
            failureOwner: "candidate" as const,
          };
        },
      },
      judge: undefined,
      ifevalRightsRiskAcceptance: undefined,
    });

    assert.equal(result.trackReport.executionStatus, "unavailable");
    assert.equal(result.publicReceipt.failureOwner, "source");
    assert.equal(result.trackReport.provenance.rightsRiskAcceptanceDigest, undefined);
    assert.equal(result.trackReport.provenance.licenseCleared, undefined);
    assert.equal(result.trackReport.provenance.rightsExecutionScope, undefined);
    assert.equal(result.publicReceipt.rightsRiskAcceptanceDigest, undefined);
    assert.equal(result.publicReceipt.licenseCleared, undefined);
    assert.equal(result.publicReceipt.rightsExecutionScope, undefined);
    assert.equal(candidateCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical engine rejects IFEval Product risk acceptance bound to a caller-forged identity digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-forged-product-"));
  try {
    const canonical = COFFEE_CHAT_PRODUCT_CANDIDATE_IDENTITY;
    if (canonical.candidateType !== "coffee_chat_product") {
      throw new Error("expected canonical Product candidate identity");
    }
    const forgedDigests = [
      stableDigest({ ...canonical, harness: "unadmitted-product-host" }),
      stableDigest({ ...canonical, model: "gpt-5.6-terra" }),
      stableDigest({ ...canonical, seed: COFFEE_CHAT_PRODUCT_SEED + 1 }),
      stableDigest({
        ...canonical,
        product: {
          ...canonical.product,
          packageDigest: `sha256:${"0".repeat(64)}`,
        },
      }),
    ];

    for (const candidateDigest of forgedDigests) {
      const fixture = productIfevalRunFixture({
        root,
        candidateDigest,
        runtimeModel: COFFEE_CHAT_PRODUCT_MODEL,
        seed: COFFEE_CHAT_PRODUCT_SEED,
      });
      const { candidateCalls, result } = await executeProductIfevalFixture(fixture);

      assert.equal(result.trackReport.executionStatus, "invalid");
      assert.equal(result.publicReceipt.failureOwner, "verifier");
      assert.equal(candidateCalls, 0);
      assertNoRightsRiskProvenance(result);
      assert.match(privateFailureReason(result), /Product candidate identity/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical engine requires the admitted Product seed before accepting IFEval risk", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-product-seed-"));
  try {
    for (const seed of [undefined, COFFEE_CHAT_PRODUCT_SEED + 1]) {
      const fixture = productIfevalRunFixture({
        root,
        candidateDigest: COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST,
        runtimeModel: COFFEE_CHAT_PRODUCT_MODEL,
        seed,
      });
      const { candidateCalls, result } = await executeProductIfevalFixture(fixture);

      assert.equal(result.trackReport.executionStatus, "invalid");
      assert.equal(result.publicReceipt.failureOwner, "verifier");
      assert.equal(candidateCalls, 0);
      assertNoRightsRiskProvenance(result);
      assert.match(privateFailureReason(result), /Product candidate seed/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("live runs fail closed when a scoped runtime is missing or expired", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-runtime-gate-"));
  try {
    const sourceInput = join(root, "source-input");
    mkdirSync(sourceInput);
    writeFileSync(join(sourceInput, "LICENSE"), "license");
    const manifest = parseSourceManifest({
      schema: "source-manifest-v1",
      trackId: "ifeval",
      source: {
        repository: "https://example.invalid/ifeval",
        commit: "d".repeat(40),
        license: "Apache-2.0",
        licenseDigest: digest("license"),
      },
      allowlist: ["LICENSE"],
      excludedPaths: ["responses/**"],
      retention: {
        source: "cache-only",
        evidence: "private-content-addressed",
        public: "aggregate-provenance-only",
      },
      publicArtifactPolicy: "receipt-redacted",
    });
    const cacheRoot = join(root, "cache");
    materializeSource({
      manifest,
      cacheRoot,
      sourceRoot: sourceInput,
      runtimeLockDigest: stableDigest("lock"),
      licenseEvidence: [
        { path: "LICENSE", digest: digest("license"), license: "Apache-2.0" },
      ],
    });
    const spec = parseRunSpec({
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "smoke",
      sourceManifestDigest: stableDigest(manifest),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      candidateType: "agent_stack",
      caseCensus: { prompts: 9 },
      isolationEvidenceDigest: stableDigest("isolation"),
    });
    const plan = createRunPlan({
      manifest,
      spec,
      evidenceRoot: join(root, "evidence"),
      cacheRoot,
    });
    const missing = validateRuntimeForRun({ plan });
    assert.equal(missing?.failureOwner, "host");
    assert.match(missing?.reason ?? "", /missing/u);
    const runtime = parseRuntimeBundleConfig({
      schema: "runtime-bundle-v1",
      candidate: {
        schema: "runtime-capability-v1",
        scope: "candidate",
        endpoint: "http://127.0.0.1:4311",
        capabilityToken: "candidate-capability",
        model: "gpt-5.6-luna",
        expiresAt: "2020-01-01T00:00:00.000Z",
        maxRequests: 9,
      },
    });
    const expired = validateRuntimeForRun({ plan, runtime });
    assert.equal(expired?.failureOwner, "host");
    assert.match(expired?.reason ?? "", /expired/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical runtime validation rejects a Product capability for a different model", () => {
  const fixture = productRunFixture("smoke");
  try {
    assert.equal(
      validateRuntimeForRun({ plan: fixture.plan, runtime: fixture.runtime }),
      undefined,
    );
    const runtime = parseRuntimeBundleConfig({
      schema: "runtime-bundle-v1",
      candidate: {
        ...fixture.runtime.candidate,
        model: "gpt-5.6-terra",
      },
      judge: fixture.runtime.judge,
      productHost: fixture.runtime.productHost,
    });
    const failure = validateRuntimeForRun({ plan: fixture.plan, runtime });
    assert.equal(failure?.failureOwner, "host");
    assert.match(failure?.reason ?? "", /runtime model.*Product identity/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("canonical engine stops a risk-accepted Product IFEval run when the runtime model drifts", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-model-drift-"));
  try {
    const fixture = productIfevalRunFixture({
      root,
      candidateDigest: COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST,
      runtimeModel: "gpt-5.6-terra",
      seed: COFFEE_CHAT_PRODUCT_SEED,
    });
    const { candidateCalls, result } = await executeProductIfevalFixture(fixture);

    assert.equal(result.trackReport.executionStatus, "unavailable");
    assert.equal(result.publicReceipt.failureOwner, "host");
    assert.equal(candidateCalls, 0);
    assertNoRightsRiskProvenance(result);
    assert.match(privateFailureReason(result), /runtime model.*Product identity/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical engine reparses a direct Product runtime bundle before IFEval risk acceptance", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-runtime-schema-"));
  try {
    const fixture = productIfevalRunFixture({
      root,
      candidateDigest: COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST,
      runtimeModel: COFFEE_CHAT_PRODUCT_MODEL,
      seed: COFFEE_CHAT_PRODUCT_SEED,
    });
    const forgedRuntime = {
      ...fixture.runtime,
      productHost: {
        ...fixture.runtime.productHost!,
        host: "forged-product-host",
      },
    } as never;
    const { candidateCalls, result } = await executeProductIfevalFixture(
      fixture,
      forgedRuntime,
    );

    assert.equal(result.trackReport.executionStatus, "unavailable");
    assert.equal(result.publicReceipt.failureOwner, "host");
    assert.equal(candidateCalls, 0);
    assertNoRightsRiskProvenance(result);
    assert.match(privateFailureReason(result), /runtime product host.*unsupported/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical engine rejects an unbound Product transport before IFEval risk execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-unbound-product-"));
  try {
    const fixture = productIfevalRunFixture({
      root,
      candidateDigest: COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST,
      runtimeModel: COFFEE_CHAT_PRODUCT_MODEL,
      seed: COFFEE_CHAT_PRODUCT_SEED,
    });
    const { candidateCalls, result } = await executeProductIfevalFixture(fixture);

    assert.equal(result.trackReport.executionStatus, "invalid");
    assert.equal(result.publicReceipt.failureOwner, "verifier");
    assert.equal(candidateCalls, 0);
    assertNoRightsRiskProvenance(result);
    assert.equal(result.trackReport.provenance.candidateMode, undefined);
    assert.equal(result.trackReport.provenance.capabilitiesUsed, undefined);
    assert.equal(result.trackReport.provenance.productBehaviorExercised, undefined);
    assert.equal(result.trackReport.provenance.productIdentity, undefined);
    assert.equal(result.publicReceipt.candidateMode, undefined);
    assert.equal(result.publicReceipt.capabilitiesUsed, undefined);
    assert.equal(result.publicReceipt.productBehaviorExercised, undefined);
    assert.equal(result.publicReceipt.productIdentity, undefined);
    assert.match(
      privateFailureReason(result),
      /not bound to the normalized Responses candidate runtime/u,
    );
    assert.equal(
      filesBelow(fixture.plan.evidenceRoot).some((path) =>
        readFileSync(path, "utf8").includes("ifeval-rights-risk-acceptance-v1"),
      ),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("canonical engine rejects a missing Product runtime before IFEval risk execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-missing-runtime-"));
  try {
    const fixture = productIfevalRunFixture({
      root,
      candidateDigest: COFFEE_CHAT_PRODUCT_CANDIDATE_DIGEST,
      runtimeModel: COFFEE_CHAT_PRODUCT_MODEL,
      seed: COFFEE_CHAT_PRODUCT_SEED,
    });
    const { candidateCalls, result } = await executeProductIfevalFixture(fixture, null);

    assert.equal(result.trackReport.executionStatus, "unavailable");
    assert.equal(result.publicReceipt.failureOwner, "host");
    assert.equal(candidateCalls, 0);
    assertNoRightsRiskProvenance(result);
    assert.match(privateFailureReason(result), /runtime capability is missing/u);
    assert.equal(
      filesBelow(fixture.plan.evidenceRoot).some((path) =>
        readFileSync(path, "utf8").includes("ifeval-rights-risk-acceptance-v1"),
      ),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a forged Product preflight marker cannot mint connectivity provenance", async () => {
  const fixture = productRunFixture("smoke");
  let candidateCalls = 0;
  try {
    const result = await executeImmutableRun({
      plan: fixture.plan,
      manifest: fixture.manifest,
      candidate: {
        kind: "coffee_chat_product",
        productBoundary: PRODUCT_BOUNDARY,
        productHostPreflight: { state: "verified" },
        run: async () => {
          candidateCalls += 1;
          return { state: "unmeasured", reason: "must-not-run" } as const;
        },
      },
      judge: undefined,
      runtime: fixture.runtime,
    });

    assert.equal(result.trackReport.executionStatus, "invalid");
    assert.equal(result.publicReceipt.failureOwner, "verifier");
    assert.equal(candidateCalls, 0);
    assert.equal(result.trackReport.provenance.candidateMode, undefined);
    assert.equal(result.trackReport.provenance.capabilitiesUsed, undefined);
    assert.equal(result.trackReport.provenance.productBehaviorExercised, undefined);
    assert.equal(result.trackReport.provenance.productIdentity, undefined);
    assert.equal(result.publicReceipt.candidateMode, undefined);
    assert.equal(result.publicReceipt.capabilitiesUsed, undefined);
    assert.equal(result.publicReceipt.productBehaviorExercised, undefined);
    assert.equal(result.publicReceipt.productIdentity, undefined);
    const receipts = JSON.parse(readFileSync(result.trialReceiptsPath, "utf8"));
    assert.deepEqual(receipts, []);
    const serialized = JSON.stringify({
      report: result.trackReport,
      publicReceipt: result.publicReceipt,
      receipts,
    });
    assert.doesNotMatch(serialized, /packageRoot|candidate-capability/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("run engine rejects product candidate profiles outside smoke without connectivity claims", async () => {
  for (const profile of ["fixture", "pilot", "score"] as const) {
    const fixture = productRunFixture("smoke");
    try {
      const plan = {
        ...fixture.plan,
        profile,
        claimStatus:
          profile === "score"
            ? ("provisional_internal" as const)
            : profile === "pilot"
              ? ("pilot" as const)
              : ("calibration" as const),
        runSpec: { ...fixture.plan.runSpec!, profile },
      };
      const result = await executeImmutableRun({
        plan,
        manifest: fixture.manifest,
        candidate: {
          kind: "coffee_chat_product",
          productBoundary: PRODUCT_BOUNDARY,
          productHostPreflight: { state: "verified" },
          run: async () => ({ state: "unmeasured", reason: "unused" }),
        },
        judge: undefined,
        runtime: fixture.runtime,
      });
      assert.equal(result.trackReport.executionStatus, "invalid");
      assert.equal(result.publicReceipt.failureOwner, "verifier");
      assert.equal(result.publicReceipt.candidateMode, undefined);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("run engine rejects a fixture transport under a live candidate identity", async () => {
  const fixture = productRunFixture("smoke");
  try {
    const plan = {
      ...fixture.plan,
      runSpec: {
        ...fixture.plan.runSpec!,
        candidateType: "agent_stack" as const,
      },
    };
    const runtime = parseRuntimeBundleConfig({
      schema: "runtime-bundle-v1",
      candidate: fixture.runtime.candidate,
      judge: fixture.runtime.judge,
    });
    const result = await executeImmutableRun({
      plan,
      manifest: fixture.manifest,
      candidate: createFixtureCandidateTransport(() => "fixture output"),
      judge: undefined,
      runtime,
    });
    assert.equal(result.trackReport.executionStatus, "invalid");
    assert.equal(result.publicReceipt.failureOwner, "verifier");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("run engine rejects agent_stack transport under reference_model identity", async () => {
  const fixture = productRunFixture("smoke");
  try {
    const plan = {
      ...fixture.plan,
      runSpec: {
        ...fixture.plan.runSpec!,
        candidateType: "reference_model" as const,
      },
    };
    const runtime = parseRuntimeBundleConfig({
      schema: "runtime-bundle-v1",
      candidate: fixture.runtime.candidate,
      judge: fixture.runtime.judge,
    });
    const result = await executeImmutableRun({
      plan,
      manifest: fixture.manifest,
      candidate: {
        kind: "agent_stack",
        run: async () => ({ state: "unmeasured", reason: "unused" }),
      },
      judge: undefined,
      runtime,
    });
    assert.equal(result.trackReport.executionStatus, "invalid");
    assert.equal(result.publicReceipt.failureOwner, "verifier");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("product smoke trusts verified package bytes rather than transport preflight markers", async () => {
  for (const preflight of [
    undefined,
    { state: "verified" as const },
    { state: "unavailable" as const, reason: "package digest drift" },
  ]) {
    const fixture = productRunFixture("smoke");
    try {
      const result = await executeImmutableRun({
        plan: fixture.plan,
        manifest: fixture.manifest,
        candidate: {
          kind: "coffee_chat_product",
          productBoundary: PRODUCT_BOUNDARY,
          ...(preflight === undefined ? {} : { productHostPreflight: preflight }),
          run: async () => ({ state: "unmeasured", reason: "unused" }),
        },
        judge: undefined,
        runtime: fixture.runtime,
      });
      assert.equal(result.trackReport.executionStatus, "invalid");
      assert.equal(result.publicReceipt.failureOwner, "verifier");
      assert.equal(result.publicReceipt.candidateMode, undefined);
      assert.equal(result.trackReport.provenance.productIdentity, undefined);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("missing materialized Python runtime is host unavailability, not adapter success", () => {
  assert.throws(
    () => requireRuntimePython("/tmp/coffee-chat-eval-runtime-does-not-exist/source"),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Python runtime is missing") &&
      (error as Error & { failureOwner?: string }).failureOwner === "host",
  );
});
