import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createRunPlan, parseRunSpec, parseSourceManifest } from "../src/eval-core.ts";
import { stableDigest } from "../src/identity.ts";
import {
  executePortfolioSmoke,
  parsePortfolioBrokerConfig,
  portfolioTestOnly,
  PORTFOLIO_SMOKE_CENSUS,
  runPortfolioSmokeConfig,
} from "../src/portfolio.ts";
import { runCli } from "../src/cli.ts";
import {
  createIfevalTrackExecutor,
  ifevalRightsRiskAcceptanceDigest,
  parseIfevalRightsRiskAcceptance,
} from "../src/ifeval.ts";
import { createTasteTrackExecutor } from "../src/taste.ts";
import { createBeamTrackExecutor, BEAM_CATEGORIES } from "../src/beam.ts";
import { createAgentDojoTrackExecutor } from "../src/agentdojo.ts";
import { BEAM_RUNTIME_LOCK, IFEVAL_RUNTIME_LOCK } from "../src/python-runtime.ts";
import { materializeSource } from "../src/source-cache.ts";
import { getSourceManifest } from "../src/source-manifests.ts";
import type { EvaluationTrackId } from "../src/track-registry.ts";
import {
  candidateIdentityDigest,
  parseCandidateIdentityConfig,
} from "../src/runtime-config.ts";
import {
  createFixtureCandidateTransport,
  createFixtureJudgeTransport,
} from "../src/transports.ts";
import { executeNonReportableReplay } from "./helpers/replay-track.ts";

test("portfolio production API rejects a fabricated runTrack override", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-"));
  try {
    const tracks = (
      Object.keys(PORTFOLIO_SMOKE_CENSUS) as (keyof typeof PORTFOLIO_SMOKE_CENSUS)[]
    ).map((trackId) => ({
      trackId: trackId as
        "coffee-chat-taste" | "beam-record-core" | "ifeval" | "agentdojo-security",
      plan: { id: `run-${trackId}` } as never,
      manifest: {} as never,
      candidate: {} as never,
      judge: undefined,
    }));
    let fabricatedCalls = 0;
    await assert.rejects(
      () =>
        executePortfolioSmoke({
          tracks,
          evidenceRoot: root,
          runTrack: async () => {
            fabricatedCalls += 1;
            throw new Error("fabricated runner must never be called");
          },
        } as never),
      /runTrack override is not supported/u,
    );
    assert.equal(fabricatedCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio production API rejects a fabricated track executor override", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-executor-"));
  try {
    let fabricatedCalls = 0;
    const tracks = Object.keys(PORTFOLIO_SMOKE_CENSUS).map((trackId) => ({
      trackId: trackId as EvaluationTrackId,
      plan: { id: `run-${trackId}` } as never,
      manifest: {} as never,
      candidate: {} as never,
      judge: undefined,
      executor: async () => {
        fabricatedCalls += 1;
        throw new Error("fabricated executor must never be called");
      },
    }));

    await assert.rejects(
      () => executePortfolioSmoke({ tracks, evidenceRoot: root } as never),
      /track executor override is not supported/u,
    );
    assert.equal(fabricatedCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio closes every broker when portfolio preflight throws", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-abort-cleanup-"));
  try {
    const closeCalls = new Map<string, number>();
    const trackIds = Object.keys(PORTFOLIO_SMOKE_CENSUS);
    const tracks = trackIds.map((trackId, index) => ({
      trackId: (index === trackIds.length - 1
        ? trackIds[0]
        : trackId) as keyof typeof PORTFOLIO_SMOKE_CENSUS,
      plan: { id: `abort-${trackId}` } as never,
      manifest: {} as never,
      candidate: {} as never,
      judge: undefined,
      close: async () => {
        closeCalls.set(trackId, (closeCalls.get(trackId) ?? 0) + 1);
      },
    }));

    await assert.rejects(
      () =>
        executePortfolioSmoke({
          tracks,
          evidenceRoot: root,
        }),
      /exactly the four admitted tracks/u,
    );
    assert.deepEqual(
      Object.fromEntries(closeCalls),
      Object.fromEntries(trackIds.map((trackId) => [trackId, 1])),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio marks a track invalid when production-path proxy cleanup fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-cleanup-"));
  try {
    const cacheRoot = join(root, "missing-cache");
    const candidate = createFixtureCandidateTransport(() => "unused", {
      evidenceRoot: root,
    });
    const judge = createFixtureJudgeTransport(() => ({ score: 1 }), {
      evidenceRoot: root,
    });
    const trackIds = Object.keys(PORTFOLIO_SMOKE_CENSUS) as EvaluationTrackId[];
    const tracks = trackIds.map((trackId, index) => {
      const manifest = parseSourceManifest({
        schema: "source-manifest-v1",
        trackId,
        source: {
          repository: `https://example.invalid/${trackId}`,
          commit: String(index + 1).repeat(40),
          license: "fixture-only",
        },
        allowlist: ["LICENSE"],
        excludedPaths: ["excluded/**"],
        publicArtifactPolicy: "receipt-redacted",
      });
      const spec = parseRunSpec({
        schema: "run-spec-v1",
        trackId,
        profile: "fixture",
        sourceManifestDigest: stableDigest(manifest),
        candidateDigest: stableDigest({ trackId, role: "candidate" }),
        judgeDigest: stableDigest({ trackId, role: "judge" }),
        attackDigest: stableDigest({ trackId, role: "attack" }),
        defenseDigest: stableDigest({ trackId, role: "defense" }),
        configurationDigest: stableDigest({ trackId, profile: "fixture" }),
        candidateType: "fixture",
        caseCensus: { cases: 1 },
      });
      return {
        trackId,
        plan: createRunPlan({ manifest, spec, evidenceRoot: root, cacheRoot }),
        manifest,
        candidate,
        judge:
          trackId === "coffee-chat-taste" || trackId === "beam-record-core"
            ? judge
            : undefined,
        close: async () => {
          if (trackId === "beam-record-core") throw new Error("proxy close failed");
        },
      };
    });

    const receipt = await executePortfolioSmoke({ tracks, evidenceRoot: root });

    assert.equal(receipt.status, "failed");
    assert.equal(receipt.officialMeasurementEligible, false);
    assert.equal(
      JSON.parse(readFileSync(receipt.publicReceiptPath, "utf8"))
        .officialMeasurementEligible,
      false,
    );
    const beam = receipt.tracks.find((track) => track.trackId === "beam-record-core");
    assert.equal(beam?.cleanupStatus, "failed");
    assert.equal(beam?.executionStatus, "invalid");
    assert.ok(beam);
    const beamRunRoot = join(root, beam.runId);
    const beamPublicReceipt = JSON.parse(
      readFileSync(join(beamRunRoot, "public-receipt.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(beamPublicReceipt.executionStatus, "invalid");
    assert.equal(beamPublicReceipt.failureOwner, "cleanup");
    const beamTrackReport = JSON.parse(
      readFileSync(join(beamRunRoot, "track-report.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.equal(beamTrackReport.executionStatus, "invalid");
    assert.deepEqual(beamTrackReport.metrics, {
      execution: { numerator: null, denominator: null, value: null },
    });
    const beamTrials = JSON.parse(
      readFileSync(join(beamRunRoot, "trial-receipts.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    for (const trial of beamTrials) {
      assert.equal(trial.executionStatus, "invalid");
      assert.equal(trial.failureOwner, "cleanup");
      assert.equal(trial.cleanupStatus, "failed");
      assert.equal(trial.metrics, null);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio smoke CLI requires an absolute private config", async () => {
  await assert.rejects(
    () => runCli(["portfolio", "smoke", "--config", "relative.json"]),
    /absolute/u,
  );
});

test("portfolio broker config names a private env file without accepting key bytes", () => {
  assert.deepEqual(
    parsePortfolioBrokerConfig({
      providerEnvFile: "/private/operator/.env.local",
      providerKeyEnv: "OPENAI_API_KEY",
    }),
    {
      providerEnvFile: "/private/operator/.env.local",
      providerKeyEnv: "OPENAI_API_KEY",
    },
  );
  assert.throws(
    () => parsePortfolioBrokerConfig({ providerKey: "provider-secret" }),
    /provider key bytes are not accepted|providerKey/u,
  );
  assert.throws(
    () =>
      parsePortfolioBrokerConfig({
        providerEnvFile: "relative/.env.local",
        providerKeyEnv: "OPENAI_API_KEY",
      }),
    /providerEnvFile.*absolute/u,
  );
  assert.throws(
    () =>
      parsePortfolioBrokerConfig({
        providerEnvFile: "/private/operator/.env.local",
        providerKeyEnv: "OPENAI_API_KEY",
        upstreamUrl: "https://example.com/v1/responses",
      }),
    /upstreamUrl.*official OpenAI|loopback/u,
  );
});

test("portfolio product package root is a private absolute runtime path", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-product-portfolio-config-"));
  try {
    const path = join(root, "portfolio.json");
    writeFileSync(
      path,
      JSON.stringify({
        schema: "portfolio-smoke-config-v1",
        evidenceRoot: join(root, "evidence"),
        cacheRoot: join(root, "cache"),
        productPackageRoot: "relative/product",
        tracks: Object.keys(PORTFOLIO_SMOKE_CENSUS).map((trackId) => ({
          trackId,
          planPath: "unused",
        })),
      }),
    );
    await assert.rejects(
      () => runPortfolioSmokeConfig(path),
      /productPackageRoot.*absolute/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio config validates every track before opening a broker", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-preflight-cleanup-"));
  try {
    const workdir = new URL("..", import.meta.url).pathname;
    const candidatePath = join(root, "candidate.json");
    const planPath = join(root, "taste-plan.json");
    writeFileSync(
      candidatePath,
      JSON.stringify({
        schema: "candidate-config-v1",
        candidateType: "agent_stack",
        harness: "responses-agent-stack-v1",
        model: "gpt-5.6-luna",
      }),
    );
    writeFileSync(
      planPath,
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "src/cli.ts",
          "plan",
          "--track",
          "coffee-chat-taste",
          "--profile",
          "smoke",
          "--candidate-config",
          candidatePath,
          "--evidence-root",
          join(root, "evidence"),
          "--cache-root",
          join(root, "cache"),
        ],
        { cwd: workdir, encoding: "utf8" },
      ),
    );
    const configPath = join(root, "portfolio.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        schema: "portfolio-smoke-config-v1",
        evidenceRoot: join(root, "evidence"),
        cacheRoot: join(root, "cache"),
        broker: {
          providerEnvFile: join(root, ".env.local"),
          providerKeyEnv: "UNUSED_TEST_KEY",
        },
        tracks: [
          { trackId: "coffee-chat-taste", planPath },
          { trackId: "unsupported", planPath },
          { trackId: "ifeval", planPath },
          { trackId: "agentdojo-security", planPath },
        ],
      }),
    );
    let closeCalls = 0;
    await assert.rejects(
      () =>
        runPortfolioSmokeConfig(configPath, {
          startBroker: async () => ({
            runtime: {
              schema: "runtime-bundle-v1",
              candidate: {
                schema: "runtime-capability-v1",
                scope: "candidate",
                endpoint: "http://127.0.0.1:4311/responses",
                capabilityToken: "private-candidate-token",
                model: "gpt-5.6-luna",
                expiresAt: "2099-01-01T00:00:00.000Z",
                maxRequests: 3,
              },
              judge: {
                schema: "runtime-capability-v1",
                scope: "judge",
                endpoint: "http://127.0.0.1:4312/responses",
                capabilityToken: "private-judge-token",
                model: "gpt-5.6-luna",
                expiresAt: "2099-01-01T00:00:00.000Z",
                maxRequests: 21,
              },
            },
            close: async () => {
              closeCalls += 1;
            },
          }),
        }),
      /portfolio track is unsupported/u,
    );
    assert.equal(closeCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio rejects persisted candidate identity type drift from RunSpec", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-identity-drift-"));
  try {
    const workdir = new URL("..", import.meta.url).pathname;
    const agentCandidatePath = join(root, "agent-candidate.json");
    const fixtureCandidatePath = join(root, "fixture-candidate.json");
    writeFileSync(
      agentCandidatePath,
      JSON.stringify({
        schema: "candidate-config-v1",
        candidateType: "agent_stack",
        harness: "responses-agent-stack-v1",
        model: "gpt-5.6-luna",
      }),
    );
    writeFileSync(fixtureCandidatePath, JSON.stringify({ candidateType: "fixture" }));
    const livePlan = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "src/cli.ts",
          "plan",
          "--track",
          "coffee-chat-taste",
          "--profile",
          "smoke",
          "--candidate-config",
          agentCandidatePath,
          "--evidence-root",
          join(root, "evidence"),
          "--cache-root",
          join(root, "cache"),
        ],
        { cwd: workdir, encoding: "utf8" },
      ),
    ) as { runSpec: { candidateType: string } };
    livePlan.runSpec.candidateType = "reference_model";
    const livePlanPath = join(root, "drifted-taste-plan.json");
    writeFileSync(livePlanPath, JSON.stringify(livePlan));

    const fixturePlanPath = join(root, "ifeval-fixture-plan.json");
    writeFileSync(
      fixturePlanPath,
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "src/cli.ts",
          "plan",
          "--track",
          "ifeval",
          "--profile",
          "fixture",
          "--candidate-config",
          fixtureCandidatePath,
          "--evidence-root",
          join(root, "evidence"),
          "--cache-root",
          join(root, "cache"),
        ],
        { cwd: workdir, encoding: "utf8" },
      ),
    );
    const configPath = join(root, "portfolio.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        schema: "portfolio-smoke-config-v1",
        evidenceRoot: join(root, "evidence"),
        cacheRoot: join(root, "cache"),
        tracks: [
          { trackId: "coffee-chat-taste", planPath: livePlanPath },
          { trackId: "beam-record-core", planPath: livePlanPath },
          { trackId: "agentdojo-security", planPath: livePlanPath },
          { trackId: "ifeval", planPath: fixturePlanPath },
        ],
      }),
    );

    await assert.rejects(
      () => runPortfolioSmokeConfig(configPath),
      /candidate identity type does not match run spec candidateType/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio preflights IFEval native rights before opening any broker", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-rights-hold-"));
  try {
    const workdir = new URL("..", import.meta.url).pathname;
    const candidatePath = join(root, "candidate.json");
    writeFileSync(
      candidatePath,
      JSON.stringify({
        schema: "candidate-config-v1",
        candidateType: "agent_stack",
        harness: "responses-agent-stack-v1",
        model: "gpt-5.6-luna",
        seed: 7,
      }),
    );
    const planPaths = Object.fromEntries(
      (Object.keys(PORTFOLIO_SMOKE_CENSUS) as EvaluationTrackId[]).map((trackId) => {
        const planPath = join(root, `${trackId}.plan.json`);
        writeFileSync(
          planPath,
          execFileSync(
            process.execPath,
            [
              "--experimental-strip-types",
              "src/cli.ts",
              "plan",
              "--track",
              trackId,
              "--profile",
              "smoke",
              "--candidate-config",
              candidatePath,
              "--evidence-root",
              join(root, "evidence"),
              "--cache-root",
              join(root, "cache"),
            ],
            { cwd: workdir, encoding: "utf8" },
          ),
        );
        return [trackId, planPath];
      }),
    ) as Record<EvaluationTrackId, string>;
    const providerEnvFile = join(root, ".env.local");
    writeFileSync(providerEnvFile, "UNUSED_TEST_KEY=never-read\n", { mode: 0o600 });
    const configPath = join(root, "portfolio.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        schema: "portfolio-smoke-config-v1",
        evidenceRoot: join(root, "evidence"),
        cacheRoot: join(root, "cache"),
        broker: {
          providerEnvFile,
          providerKeyEnv: "UNUSED_TEST_KEY",
        },
        tracks: (Object.keys(PORTFOLIO_SMOKE_CENSUS) as EvaluationTrackId[]).map(
          (trackId) => ({ trackId, planPath: planPaths[trackId] }),
        ),
      }),
    );
    let brokerStarts = 0;

    await assert.rejects(
      () =>
        runPortfolioSmokeConfig(configPath, {
          startBroker: async () => {
            brokerStarts += 1;
            throw new Error("broker must not start");
          },
        }),
      /rights_hold\/rights.*punkt_tab/u,
    );
    assert.equal(brokerStarts, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio requires an absolute top-level private IFEval acceptance path", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-risk-path-"));
  try {
    const configPath = join(root, "portfolio.json");
    let brokerStarts = 0;
    const tracks = (Object.keys(PORTFOLIO_SMOKE_CENSUS) as EvaluationTrackId[]).map(
      (trackId) => ({ trackId, planPath: join(root, `${trackId}.json`) }),
    );
    writeFileSync(
      configPath,
      JSON.stringify({
        schema: "portfolio-smoke-config-v1",
        evidenceRoot: join(root, "evidence"),
        cacheRoot: join(root, "cache"),
        tracks,
        inlineRightsAcceptance: { acceptedBy: "must-not-be-accepted" },
      }),
    );
    await assert.rejects(
      () =>
        runPortfolioSmokeConfig(configPath, {
          startBroker: async () => {
            brokerStarts += 1;
            throw new Error("broker must not start");
          },
        }),
      /portfolio config has unexpected fields/u,
    );
    writeFileSync(
      configPath,
      JSON.stringify({
        schema: "portfolio-smoke-config-v1",
        evidenceRoot: join(root, "evidence"),
        cacheRoot: join(root, "cache"),
        ifevalRightsRiskAcceptanceReceipt: "relative/acceptance.json",
        tracks,
      }),
    );
    await assert.rejects(
      () =>
        runPortfolioSmokeConfig(configPath, {
          startBroker: async () => {
            brokerStarts += 1;
            throw new Error("broker must not start");
          },
        }),
      /ifevalRightsRiskAcceptanceReceipt.*absolute/u,
    );
    assert.equal(brokerStarts, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portfolio public risk projection is exact and omits private receipt metadata", () => {
  const candidateIdentity = parseCandidateIdentityConfig({
    schema: "candidate-config-v1",
    candidateType: "coffee_chat_product",
    harness: "eval-skills-reference-host-v1",
    model: "gpt-5.6-luna",
    seed: 7,
    product: {
      repository: "https://github.com/openboa-ai/coffee-chat",
      commit: "e1ac82de77ab12b9b2499771a194ef3db356b3a6",
      calver: "2026.8.23",
      packageDigest:
        "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41",
      mode: "connectivity_only",
    },
  });
  const candidateDigest = candidateIdentityDigest(candidateIdentity);
  const receipt = parseIfevalRightsRiskAcceptance({
    schema: "ifeval-rights-risk-acceptance-v1",
    trackId: "ifeval",
    profile: "smoke",
    candidateType: "coffee_chat_product",
    candidateDigest,
    ifevalSourceCommit: "e6890f85757dd84e27ca6df2dd30651dafad28e0",
    assetRepository: "https://github.com/nltk/nltk_data",
    assetRevision: "550b6625bcef1f2abff2ff770a5a0d272c9c6b2a",
    asset: "nltk_data/tokenizers/punkt_tab.zip",
    assetDigest:
      "sha256:e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106",
    licenseStatus: "unclarified",
    licenseCleared: false,
    scope: "private-internal-smoke-only",
    acceptedBy: "workspace-owner",
    acceptedAt: "2026-08-24T01:55:00+09:00",
    privateNonce: "c".repeat(64),
    acknowledgesNoLicenseGrant: true,
    acknowledgesNoRedistribution: true,
    acknowledgesNoPublicNumericClaim: true,
  });
  const boundary = portfolioTestOnly.projectIfevalRightsBoundary({
    profile: "smoke",
    candidateType: "coffee_chat_product",
    candidateDigest,
    rightsRiskAcceptanceDigest: ifevalRightsRiskAcceptanceDigest(receipt),
    receipt,
  });

  assert.deepEqual(boundary, {
    rightsRiskAcceptanceDigest: ifevalRightsRiskAcceptanceDigest(receipt),
    licenseCleared: false,
    rightsExecutionScope: "private-internal-smoke-only",
  });
  const serialized = JSON.stringify(boundary);
  assert.equal(serialized.includes("workspace-owner"), false);
  assert.equal(serialized.includes("2026-08-24"), false);
  assert.equal(serialized.includes("acceptance.json"), false);
  assert.throws(
    () =>
      portfolioTestOnly.projectIfevalRightsBoundary({
        profile: "smoke",
        candidateType: "coffee_chat_product",
        candidateDigest: stableDigest("different Product candidate"),
        rightsRiskAcceptanceDigest: ifevalRightsRiskAcceptanceDigest(receipt),
        receipt,
      }),
    /Product candidate identity/u,
  );
});

test("portfolio withholds reversible private-result digests for Product connectivity", () => {
  const nativeEvidenceDigest = stableDigest("enumerable native result");
  const trackReportDigest = stableDigest("enumerable track report");
  const trialReceiptsDigest = stableDigest("execution receipts");
  const projected = portfolioTestOnly.projectPublicResultDigests({
    trackId: "ifeval",
    plannedCandidateType: "coffee_chat_product",
    actualCandidateType: "coffee_chat_product",
    productBoundary: {
      candidateMode: "connectivity_only",
      capabilitiesUsed: [],
      productBehaviorExercised: false,
      referenceHost: "eval-skills-reference-host-v1",
      productIdentity: {
        repository: "https://github.com/openboa-ai/coffee-chat",
        commit: "e1ac82de77ab12b9b2499771a194ef3db356b3a6",
        calver: "2026.8.23",
        packageDigest:
          "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41",
      },
    },
    nativeEvidenceDigest,
    trackReportDigest,
    trialReceiptsDigest,
  });

  assert.deepEqual(projected, {
    trialReceiptsDigest,
    privateResultDigestsWithheld: true,
  });
  assert.equal("nativeEvidenceDigest" in projected, false);
  assert.equal("trackReportDigest" in projected, false);
});

test("portfolio withholds result digests when either planned or actual candidate is Product", () => {
  for (const [plannedCandidateType, actualCandidateType] of [
    ["agent_stack", "coffee_chat_product"],
    ["coffee_chat_product", "agent_stack"],
  ] as const) {
    const projected = portfolioTestOnly.projectPublicResultDigests({
      trackId: "ifeval",
      plannedCandidateType,
      actualCandidateType,
      productBoundary: undefined,
      nativeEvidenceDigest: stableDigest("private native result"),
      trackReportDigest: stableDigest("private track report"),
      trialReceiptsDigest: stableDigest("safe trial receipts"),
    });
    assert.equal(projected.privateResultDigestsWithheld, true);
    assert.equal("nativeEvidenceDigest" in projected, false);
    assert.equal("trackReportDigest" in projected, false);
  }
});

test("portfolio exposes rights and result digests only after finalized Product verification", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-early-failure-"));
  try {
    const candidateIdentity = parseCandidateIdentityConfig({
      schema: "candidate-config-v1",
      candidateType: "coffee_chat_product",
      harness: "eval-skills-reference-host-v1",
      model: "gpt-5.6-luna",
      seed: 7,
      product: {
        repository: "https://github.com/openboa-ai/coffee-chat",
        commit: "e1ac82de77ab12b9b2499771a194ef3db356b3a6",
        calver: "2026.8.23",
        packageDigest:
          "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41",
        mode: "connectivity_only",
      },
    });
    assert.equal(candidateIdentity.candidateType, "coffee_chat_product");
    if (candidateIdentity.candidateType !== "coffee_chat_product") return;
    const candidateDigest = candidateIdentityDigest(candidateIdentity);
    const acceptance = parseIfevalRightsRiskAcceptance({
      schema: "ifeval-rights-risk-acceptance-v1",
      trackId: "ifeval",
      profile: "smoke",
      candidateType: "coffee_chat_product",
      candidateDigest,
      ifevalSourceCommit: "e6890f85757dd84e27ca6df2dd30651dafad28e0",
      assetRepository: "https://github.com/nltk/nltk_data",
      assetRevision: "550b6625bcef1f2abff2ff770a5a0d272c9c6b2a",
      asset: "nltk_data/tokenizers/punkt_tab.zip",
      assetDigest:
        "sha256:e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106",
      licenseStatus: "unclarified",
      licenseCleared: false,
      scope: "private-internal-smoke-only",
      acceptedBy: "workspace-owner",
      acceptedAt: "2026-08-24T01:55:00+09:00",
      privateNonce: "d".repeat(64),
      acknowledgesNoLicenseGrant: true,
      acknowledgesNoRedistribution: true,
      acknowledgesNoPublicNumericClaim: true,
    });
    const acceptanceDigest = ifevalRightsRiskAcceptanceDigest(acceptance);
    const productBoundary = {
      candidateMode: "connectivity_only" as const,
      capabilitiesUsed: [] as const,
      productBehaviorExercised: false as const,
      referenceHost: "eval-skills-reference-host-v1" as const,
      productIdentity: {
        repository: candidateIdentity.product.repository,
        commit: candidateIdentity.product.commit,
        calver: candidateIdentity.product.calver,
        packageDigest: candidateIdentity.product.packageDigest,
      },
    };
    const caseCensus: Readonly<
      Record<EvaluationTrackId, Readonly<Record<string, number>>>
    > = {
      "coffee-chat-taste": { families: 1, submissions: 3, judgeCalls: 21 },
      "beam-record-core": { conversations: 1, queries: 6 },
      ifeval: { prompts: 9 },
      "agentdojo-security": {
        benign: 1,
        injectionControls: 1,
        attackedPairs: 1,
        episodes: 3,
      },
    };
    const tracks = (Object.keys(PORTFOLIO_SMOKE_CENSUS) as EvaluationTrackId[]).map(
      (trackId, index) => {
        const manifest = getSourceManifest(trackId);
        const spec = parseRunSpec({
          schema: "run-spec-v1",
          trackId,
          profile: "smoke",
          sourceManifestDigest: stableDigest(manifest),
          candidateDigest,
          judgeDigest: stableDigest({ trackId, role: "judge" }),
          attackDigest: stableDigest({ trackId, role: "attack" }),
          defenseDigest: stableDigest({ trackId, role: "defense" }),
          configurationDigest: stableDigest({ trackId, profile: "smoke" }),
          ...(manifest.providerTermsDigest === undefined
            ? {}
            : {
                providerTermsDigest: manifest.providerTermsDigest,
                providerTermsReceiptDigest: stableDigest({
                  trackId,
                  role: "provider-terms-receipt",
                }),
              }),
          ...(trackId === "ifeval"
            ? { rightsRiskAcceptanceDigest: acceptanceDigest }
            : {}),
          candidateType: "coffee_chat_product",
          caseCensus: caseCensus[trackId],
          isolationEvidenceDigest: stableDigest({ trackId, role: "isolation" }),
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
            commit: String(index + 5).repeat(40),
          }),
        });
        return {
          trackId,
          plan,
          manifest: driftedManifest,
          candidate: {
            kind: "coffee_chat_product" as const,
            productBoundary,
            productHostPreflight: { state: "verified" as const },
            run: async () => ({ state: "unmeasured" as const, reason: "must-not-run" }),
          },
          judge: undefined,
          ...(trackId === "ifeval" ? { ifevalRightsRiskAcceptance: acceptance } : {}),
        };
      },
    );

    const receipt = await executePortfolioSmoke({
      tracks,
      evidenceRoot: join(root, "evidence"),
    });
    const ifeval = receipt.tracks.find((track) => track.trackId === "ifeval");
    assert.equal(ifeval?.executionStatus, "unavailable");
    assert.equal(ifeval?.rightsRiskAcceptanceDigest, undefined);
    assert.equal(ifeval?.licenseCleared, undefined);
    assert.equal(ifeval?.rightsExecutionScope, undefined);
    assert.equal(ifeval?.nativeEvidenceDigest, undefined);
    assert.equal(ifeval?.trackReportDigest, undefined);
    assert.equal(ifeval?.privateResultDigestsWithheld, true);
    const persisted = JSON.parse(readFileSync(receipt.publicReceiptPath, "utf8")) as {
      readonly tracks: readonly Record<string, unknown>[];
    };
    const persistedIfeval = persisted.tracks.find(
      (track) => track.trackId === "ifeval",
    );
    assert.equal(persistedIfeval?.rightsRiskAcceptanceDigest, undefined);
    assert.equal(persistedIfeval?.nativeEvidenceDigest, undefined);
    assert.equal(persistedIfeval?.trackReportDigest, undefined);
    assert.equal(persistedIfeval?.privateResultDigestsWithheld, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("offline replay executes all four native factories behind a non-reportable test boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-portfolio-replay-"));
  try {
    const beamBank = Object.fromEntries(
      BEAM_CATEGORIES.map((category, index) => [
        category,
        [
          {
            question: `${category}-question`,
            rubric: Array.from(
              { length: index === 1 ? 4 : index > 3 ? 2 : 1 },
              () => "rubric",
            ),
          },
        ],
      ]),
    );
    const candidate = createFixtureCandidateTransport(() => "fixture", {
      evidenceRoot: root,
    });
    const tasteCandidate = createFixtureCandidateTransport(
      () => ({
        artifact: { mediaType: "text/plain", content: "fixture" },
        decisionRecord: {
          decision: "fixture",
          evidenceUse: [],
          tradeoffs: [],
          constraints: [],
          uncertainty: null,
        },
      }),
      { evidenceRoot: root },
    );
    const judge = createFixtureJudgeTransport(() => ({ score: 1 }), {
      evidenceRoot: root,
    });
    const executors = {
      "coffee-chat-taste": createTasteTrackExecutor({
        api: {
          getBenchmarkInput: (_manifest, condition) => ({ condition }),
          evaluateSubmission: async () => ({ state: "measured" }),
          evaluateCaseFamily: async ({ transport }) => {
            for (let index = 0; index < 21; index += 1)
              await transport.complete({
                kind: index < 13 ? "pointwise" : "pairwise",
                index,
              });
            return { state: "measured" };
          },
        },
      }),
      "beam-record-core": createBeamTrackExecutor({
        bridge: {
          run: async ({ outputPath }) => {
            writeFileSync(
              outputPath,
              JSON.stringify({
                queryCount: 1,
                judgeCalls: 1,
                unusedEmbeddingInitializationBypassed: true,
                paperComparable: false,
                categories: Object.fromEntries(
                  BEAM_CATEGORIES.map((category, index) => [
                    category,
                    {
                      numerator: 0,
                      denominator: index === 0 ? 1 : 0,
                      accuracy: index === 0 ? 0 : null,
                    },
                  ]),
                ),
              }),
            );
          },
        },
      }),
      ifeval: createIfevalTrackExecutor({
        bridge: {
          run: async ({ output, keys }) => {
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
                  ].map((key) => [
                    key,
                    { numerator: 0, denominator: keys.length, accuracy: 0 },
                  ]),
                ),
              }),
            );
          },
        },
      }),
      "agentdojo-security": createAgentDojoTrackExecutor({
        bridge: {
          run: async ({ outputPath }) => {
            writeFileSync(
              outputPath,
              JSON.stringify({
                schema: "coffee-chat-eval/agentdojo-security-v1",
                sourceCommit: "a75aba7631d3ca5fb7ab938965c97ead2f9ff84b",
                benchmarkVersion: "v1.2.2",
                attack: "important_instructions_no_model_name",
                publishedTableComparable: false,
                status: "measured",
                candidateCalls: 3,
                maxCandidateTurns: 3,
                benignUtility: { numerator: 1, denominator: 1, value: 1 },
                utilityUnderAttack: { numerator: 1, denominator: 1, value: 1 },
                targetedASR: { numerator: 0, denominator: 1, value: 0 },
                injectionTaskSolvability: { numerator: 1, denominator: 1, value: 1 },
                episodes: [
                  {
                    suite: "workspace",
                    kind: "benign",
                    userTaskId: "user_task_0",
                    injectionTaskId: null,
                  },
                  {
                    suite: "workspace",
                    kind: "injection-control",
                    userTaskId: null,
                    injectionTaskId: "injection_task_0",
                  },
                  {
                    suite: "workspace",
                    kind: "attacked",
                    userTaskId: "user_task_0",
                    injectionTaskId: "injection_task_0",
                  },
                ],
              }),
            );
          },
        },
      }),
    } as const;

    const cacheRoot = join(root, "cache");
    const trackIds = Object.keys(PORTFOLIO_SMOKE_CENSUS) as EvaluationTrackId[];
    const digestBytes = (bytes: string | Uint8Array): `sha256:${string}` =>
      `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const fixtureCensus: Readonly<
      Record<EvaluationTrackId, Readonly<Record<string, number>>>
    > = {
      "coffee-chat-taste": PORTFOLIO_SMOKE_CENSUS["coffee-chat-taste"],
      "beam-record-core": { queries: 1, judgeCalls: 1 },
      ifeval: { prompts: 1 },
      "agentdojo-security": PORTFOLIO_SMOKE_CENSUS["agentdojo-security"],
    };
    const plans = trackIds.map((trackId, index) => {
      const sourceInput = join(root, "source-input", trackId);
      mkdirSync(sourceInput, { recursive: true });
      const license = `fixture license for ${trackId}\n`;
      const licenseDigest = digestBytes(license);
      writeFileSync(join(sourceInput, "LICENSE"), license);
      const allowlist = ["LICENSE"];
      if (trackId === "ifeval") {
        const dataPath = join(
          sourceInput,
          "instruction_following_eval",
          "data",
          "input_data.jsonl",
        );
        mkdirSync(join(dataPath, ".."), { recursive: true });
        writeFileSync(
          dataPath,
          `${[1000, 1012, 1069, 1005, 1098, 1019, 1040, 1122, 1108]
            .map((key) => JSON.stringify({ key, prompt: `prompt-${key}` }))
            .join("\n")}\n`,
        );
        allowlist.push("instruction_following_eval/data/input_data.jsonl");
      }
      if (trackId === "beam-record-core") {
        const questionsPath = join(
          sourceInput,
          "chats",
          "100K",
          "1",
          "probing_questions",
          "probing_questions.json",
        );
        mkdirSync(join(questionsPath, ".."), { recursive: true });
        writeFileSync(questionsPath, JSON.stringify(beamBank));
        allowlist.push("chats/100K/1/probing_questions/probing_questions.json");
      }
      const manifest = parseSourceManifest({
        schema: "source-manifest-v1",
        trackId,
        source: {
          repository: `https://example.invalid/${trackId}`,
          commit: String(index + 1).repeat(40),
          license: "fixture-only",
          licenseDigest,
        },
        allowlist,
        excludedPaths: ["excluded/**"],
        retention: {
          source: "cache-only",
          evidence: "private-content-addressed",
          public: "aggregate-provenance-only",
        },
        publicArtifactPolicy: "receipt-redacted",
      });
      const runtimeLockPath =
        trackId === "ifeval"
          ? IFEVAL_RUNTIME_LOCK
          : trackId === "beam-record-core"
            ? BEAM_RUNTIME_LOCK
            : undefined;
      materializeSource({
        manifest,
        cacheRoot,
        sourceRoot: sourceInput,
        runtimeLockDigest:
          runtimeLockPath === undefined
            ? stableDigest(`fixture lock for ${trackId}`)
            : digestBytes(readFileSync(runtimeLockPath)),
        runtimeLockOrigin: "eval-owned",
        ...(runtimeLockPath === undefined
          ? {}
          : { expectedRuntimeLockPath: runtimeLockPath }),
        licenseEvidence: [
          { path: "LICENSE", digest: licenseDigest, license: "fixture-only" },
        ],
      });
      const profile = "fixture";
      const spec = parseRunSpec({
        schema: "run-spec-v1",
        trackId,
        profile,
        sourceManifestDigest: stableDigest(manifest),
        candidateDigest: stableDigest({ trackId, role: "candidate" }),
        judgeDigest: stableDigest({ trackId, role: "judge" }),
        attackDigest: stableDigest({ trackId, role: "attack" }),
        defenseDigest: stableDigest({ trackId, role: "defense" }),
        configurationDigest: stableDigest({ trackId, profile }),
        candidateType: "fixture",
        caseCensus: fixtureCensus[trackId],
      });
      const plan = createRunPlan({ manifest, spec, evidenceRoot: root, cacheRoot });
      return {
        trackId,
        plan,
        manifest,
        candidate: trackId === "coffee-chat-taste" ? tasteCandidate : candidate,
        judge:
          trackId === "coffee-chat-taste" || trackId === "beam-record-core"
            ? judge
            : undefined,
        executor: executors[trackId] as never,
      };
    });
    const expectedTrials: Readonly<Record<EvaluationTrackId, number>> = {
      "coffee-chat-taste": 3,
      "beam-record-core": 1,
      ifeval: 1,
      "agentdojo-security": 3,
    };
    for (const track of plans) {
      const result = await executeNonReportableReplay({
        plan: track.plan,
        manifest: track.manifest,
        candidate: track.candidate,
        judge: track.judge,
        executor: track.executor,
      });
      assert.equal(result.boundary, "test-only-non-reportable-replay-v1");
      assert.equal(result.execution.executionStatus, "measured");
      assert.equal(
        result.execution.trialReceipts.length,
        expectedTrials[track.trackId],
      );
      for (const officialName of [
        "track-report.json",
        "trial-receipts.json",
        "public-receipt.json",
      ]) {
        assert.equal(
          existsSync(join(root, track.plan.id, officialName)),
          false,
          `${track.trackId} replay must not emit ${officialName}`,
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
