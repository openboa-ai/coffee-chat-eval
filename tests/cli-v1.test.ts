import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  candidateIdentityDigest,
  parseCandidateIdentityConfig,
} from "../src/runtime-config.ts";

function invoke(cwd: string, ...args: string[]): string {
  return execFileSync(
    process.execPath,
    ["--experimental-strip-types", "src/cli.ts", ...args],
    { cwd, encoding: "utf8" },
  );
}

test("v1 CLI supports source verify/plan/run/report with track and profile flags", () => {
  const cwd = new URL("..", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-v1-cli-"));
  const workdir = cwd.pathname;
  try {
    const evidenceRoot = join(root, "evidence");
    const cacheRoot = join(root, "cache");
    const verified = JSON.parse(
      invoke(workdir, "source", "verify", "--track", "ifeval"),
    );
    assert.equal(verified.trackId, "ifeval");
    assert.equal(verified.caseCensus.prompts, 541);

    const configPath = join(root, "candidate.json");
    writeFileSync(configPath, JSON.stringify({ candidateType: "fixture", seed: 7 }));
    const plan = JSON.parse(
      invoke(
        workdir,
        "plan",
        "--track",
        "ifeval",
        "--profile",
        "fixture",
        "--candidate-config",
        configPath,
        "--evidence-root",
        evidenceRoot,
        "--cache-root",
        cacheRoot,
      ),
    );
    assert.equal(plan.trackId, "ifeval");
    assert.equal(plan.claimStatus, "calibration");
    assert.equal(plan.runSpec.trackId, "ifeval");
    assert.equal(plan.runSpec.samplingUnit, "prompt");
    assert.equal(plan.runSpec.caseCensus.prompts, 1);

    const planPath = join(root, "run-plan.json");
    writeFileSync(planPath, JSON.stringify(plan));
    const receipt = JSON.parse(
      invoke(workdir, "run", "--plan", planPath, "--evidence-root", evidenceRoot),
    );
    assert.equal(receipt.executionStatus, "unavailable");
    const receiptPath = join(root, "receipt.json");
    writeFileSync(receiptPath, JSON.stringify(receipt));
    const report = invoke(
      workdir,
      "report",
      "--run",
      receiptPath,
      "--visibility",
      "public",
    );
    assert.match(report, /Execution: unavailable/u);
    assert.doesNotMatch(report, /score\s*[:=]\s*\d+/iu);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v1 CLI rejects fixture candidates for live profiles", () => {
  const cwd = new URL("..", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-profile-contract-"));
  try {
    const configPath = join(root, "candidate.json");
    writeFileSync(configPath, JSON.stringify({ candidateType: "fixture" }));
    for (const profile of ["smoke", "pilot", "score"] as const) {
      const failure = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "src/cli.ts",
          "plan",
          "--track",
          "ifeval",
          "--profile",
          profile,
          "--candidate-config",
          configPath,
          "--evidence-root",
          join(root, "evidence"),
          "--cache-root",
          join(root, "cache"),
        ],
        {
          cwd: cwd.pathname,
          encoding: "utf8",
        },
      );
      assert.notEqual(failure.status, 0);
      assert.match(failure.stderr, /fixture candidateType requires profile fixture/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v1 CLI binds an exact private IFEval Product-smoke risk acceptance into identity", () => {
  const cwd = new URL("..", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-ifeval-risk-"));
  try {
    const candidatePath = join(root, "candidate.json");
    const acceptancePath = join(root, "acceptance.json");
    const candidateIdentity = {
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
    } as const;
    writeFileSync(candidatePath, JSON.stringify(candidateIdentity));
    writeFileSync(
      acceptancePath,
      JSON.stringify({
        schema: "ifeval-rights-risk-acceptance-v1",
        trackId: "ifeval",
        profile: "smoke",
        candidateType: "coffee_chat_product",
        candidateDigest: candidateIdentityDigest(
          parseCandidateIdentityConfig(candidateIdentity),
        ),
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
      }),
    );
    const plan = JSON.parse(
      invoke(
        cwd.pathname,
        "plan",
        "--track",
        "ifeval",
        "--profile",
        "smoke",
        "--candidate-config",
        candidatePath,
        "--ifeval-rights-risk-acceptance-receipt",
        acceptancePath,
        "--evidence-root",
        join(root, "evidence"),
        "--cache-root",
        join(root, "cache"),
      ),
    );
    assert.match(plan.runSpec.rightsRiskAcceptanceDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(plan).includes("workspace-owner"), false);
    assert.equal(JSON.stringify(plan).includes(acceptancePath), false);

    const planPath = join(root, "plan.json");
    writeFileSync(planPath, JSON.stringify(plan));
    const held = JSON.parse(
      invoke(
        cwd.pathname,
        "run",
        "--plan",
        planPath,
        "--evidence-root",
        join(root, "held-evidence"),
      ),
    );
    assert.equal(held.executionStatus, "rights_hold");
    assert.equal("rightsRiskAcceptanceDigest" in held, false);
    const accepted = JSON.parse(
      invoke(
        cwd.pathname,
        "run",
        "--plan",
        planPath,
        "--ifeval-rights-risk-acceptance-receipt",
        acceptancePath,
        "--evidence-root",
        join(root, "accepted-evidence"),
      ),
    );
    assert.equal(accepted.executionStatus, "unavailable");
    assert.equal(accepted.failureOwner, "host");
    assert.equal("rightsRiskAcceptanceDigest" in accepted, false);
    assert.equal("licenseCleared" in accepted, false);
    const acceptedReport = JSON.parse(
      readFileSync(
        join(root, "accepted-evidence", accepted.runId, "track-report.json"),
        "utf8",
      ),
    );
    assert.equal("rightsRiskAcceptanceDigest" in acceptedReport.provenance, false);
    assert.equal("licenseCleared" in acceptedReport.provenance, false);
    assert.equal(JSON.stringify(accepted).includes("workspace-owner"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v1 CLI rejects persisted candidate identity type drift from RunSpec", () => {
  const cwd = new URL("..", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-identity-drift-"));
  try {
    const candidatePath = join(root, "candidate.json");
    writeFileSync(
      candidatePath,
      JSON.stringify({
        schema: "candidate-config-v1",
        candidateType: "agent_stack",
        harness: "responses-agent-stack-v1",
        model: "gpt-5.6-luna",
      }),
    );
    const plan = JSON.parse(
      invoke(
        cwd.pathname,
        "plan",
        "--track",
        "agentdojo-security",
        "--profile",
        "smoke",
        "--candidate-config",
        candidatePath,
        "--evidence-root",
        join(root, "evidence"),
        "--cache-root",
        join(root, "cache"),
      ),
    ) as {
      runSpec: { candidateType: string };
      candidateIdentity?: unknown;
    };
    const missingIdentityPlan = structuredClone(plan);
    delete missingIdentityPlan.candidateIdentity;
    const missingIdentityPlanPath = join(root, "missing-identity-plan.json");
    writeFileSync(missingIdentityPlanPath, JSON.stringify(missingIdentityPlan));
    const missingIdentityFailure = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "src/cli.ts",
        "run",
        "--plan",
        missingIdentityPlanPath,
        "--evidence-root",
        join(root, "evidence"),
      ],
      { cwd: cwd.pathname, encoding: "utf8" },
    );
    assert.notEqual(missingIdentityFailure.status, 0);
    assert.match(
      missingIdentityFailure.stderr,
      /candidate identity digest does not match run spec/u,
    );

    plan.runSpec.candidateType = "reference_model";
    const planPath = join(root, "drifted-plan.json");
    writeFileSync(planPath, JSON.stringify(plan));

    const failure = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "src/cli.ts",
        "run",
        "--plan",
        planPath,
        "--evidence-root",
        join(root, "evidence"),
      ],
      { cwd: cwd.pathname, encoding: "utf8" },
    );
    assert.notEqual(failure.status, 0);
    assert.match(
      failure.stderr,
      /candidate identity type does not match run spec candidateType/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-fixture provider runs require a terms receipt and fail closed", () => {
  const cwd = new URL("..", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-v1-rights-"));
  try {
    const evidenceRoot = join(root, "evidence");
    const cacheRoot = join(root, "cache");
    const configPath = join(root, "candidate.json");
    writeFileSync(configPath, JSON.stringify({ candidateType: "agent_stack" }));
    const plan = JSON.parse(
      invoke(
        cwd.pathname,
        "plan",
        "--track",
        "agentdojo-security",
        "--profile",
        "pilot",
        "--candidate-config",
        configPath,
        "--evidence-root",
        evidenceRoot,
        "--cache-root",
        cacheRoot,
      ),
    );
    const planPath = join(root, "run-plan.json");
    writeFileSync(planPath, JSON.stringify(plan));
    const receipt = JSON.parse(
      invoke(cwd.pathname, "run", "--plan", planPath, "--evidence-root", evidenceRoot),
    );
    assert.equal(receipt.executionStatus, "rights_hold");
    assert.equal(receipt.failureOwner, "rights");

    const termsPath = join(root, "provider-terms.json");
    writeFileSync(termsPath, JSON.stringify({ terms: "current" }));
    const isolatedPlan = JSON.parse(
      invoke(
        cwd.pathname,
        "plan",
        "--track",
        "agentdojo-security",
        "--profile",
        "pilot",
        "--candidate-config",
        configPath,
        "--provider-terms-receipt",
        termsPath,
        "--evidence-root",
        evidenceRoot,
        "--cache-root",
        cacheRoot,
      ),
    );
    const isolatedPlanPath = join(root, "terms-plan.json");
    writeFileSync(isolatedPlanPath, JSON.stringify(isolatedPlan));
    const unavailable = JSON.parse(
      invoke(
        cwd.pathname,
        "run",
        "--plan",
        isolatedPlanPath,
        "--evidence-root",
        evidenceRoot,
      ),
    );
    assert.equal(unavailable.executionStatus, "unavailable");
    assert.equal(unavailable.failureOwner, "host");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("v1 CLI keeps private Product host runtime out of identity and unverified receipts", () => {
  const cwd = new URL("..", import.meta.url);
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-eval-product-cli-"));
  try {
    const evidenceRoot = join(root, "evidence");
    const cacheRoot = join(root, "cache");
    const productIdentity = {
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
    } as const;
    const configPath = join(root, "candidate.json");
    const termsPath = join(root, "provider-terms.json");
    const isolationPath = join(root, "isolation.json");
    writeFileSync(configPath, JSON.stringify(productIdentity));
    writeFileSync(termsPath, JSON.stringify({ terms: "current" }));
    writeFileSync(isolationPath, JSON.stringify({ host: "isolated" }));
    const plan = JSON.parse(
      invoke(
        cwd.pathname,
        "plan",
        "--track",
        "coffee-chat-taste",
        "--profile",
        "smoke",
        "--candidate-config",
        configPath,
        "--provider-terms-receipt",
        termsPath,
        "--isolation-receipt",
        isolationPath,
        "--evidence-root",
        evidenceRoot,
        "--cache-root",
        cacheRoot,
      ),
    );
    assert.deepEqual(plan.candidateIdentity, productIdentity);
    assert.equal(plan.runSpec.candidateType, "coffee_chat_product");
    assert.match(plan.runSpec.isolationEvidenceDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(plan).includes("packageRoot"), false);

    const planPath = join(root, "plan.json");
    const runtimePath = join(root, "runtime.json");
    writeFileSync(planPath, JSON.stringify(plan));
    writeFileSync(
      runtimePath,
      JSON.stringify({
        schema: "runtime-bundle-v1",
        candidate: {
          schema: "runtime-capability-v1",
          scope: "candidate",
          endpoint: "http://127.0.0.1:4311",
          capabilityToken: "candidate-private-token",
          model: "gpt-5.6-luna",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxRequests: 3,
        },
        judge: {
          schema: "runtime-capability-v1",
          scope: "judge",
          endpoint: "http://127.0.0.1:4312",
          capabilityToken: "judge-private-token",
          model: "gpt-5.6-luna",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxRequests: 21,
        },
        productHost: {
          schema: "product-host-runtime-v1",
          host: "eval-skills-reference-host-v1",
          packageRoot: join(root, "missing-product-package"),
        },
      }),
    );
    const receipt = JSON.parse(
      invoke(
        cwd.pathname,
        "run",
        "--plan",
        planPath,
        "--runtime-config",
        runtimePath,
        "--evidence-root",
        evidenceRoot,
      ),
    );
    assert.equal(receipt.executionStatus, "unavailable");
    assert.equal(receipt.failureOwner, "host");
    assert.equal(receipt.candidateMode, undefined);
    assert.equal(receipt.capabilitiesUsed, undefined);
    assert.equal(receipt.productBehaviorExercised, undefined);
    assert.equal(receipt.productIdentity, undefined);
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(
      serialized,
      /packageRoot|candidate-private-token|judge-private-token/u,
    );

    const runtimeWithoutProductHostPath = join(root, "runtime-no-product-host.json");
    writeFileSync(
      runtimeWithoutProductHostPath,
      JSON.stringify({
        schema: "runtime-bundle-v1",
        candidate: {
          schema: "runtime-capability-v1",
          scope: "candidate",
          endpoint: "http://127.0.0.1:4311",
          capabilityToken: "candidate-private-token",
          model: "gpt-5.6-luna",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxRequests: 3,
        },
        judge: {
          schema: "runtime-capability-v1",
          scope: "judge",
          endpoint: "http://127.0.0.1:4312",
          capabilityToken: "judge-private-token",
          model: "gpt-5.6-luna",
          expiresAt: "2099-01-01T00:00:00.000Z",
          maxRequests: 21,
        },
      }),
    );
    const missingHostReceipt = JSON.parse(
      invoke(
        cwd.pathname,
        "run",
        "--plan",
        planPath,
        "--runtime-config",
        runtimeWithoutProductHostPath,
        "--evidence-root",
        join(root, "missing-host-evidence"),
      ),
    );
    assert.equal(missingHostReceipt.executionStatus, "unavailable");
    assert.equal(missingHostReceipt.failureOwner, "host");
    assert.equal(missingHostReceipt.candidateMode, undefined);
    assert.equal(missingHostReceipt.productIdentity, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
