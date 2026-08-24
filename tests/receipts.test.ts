import assert from "node:assert/strict";
import test from "node:test";

import { stableDigest } from "../src/identity.ts";
import {
  redactEvidenceReceipt,
  createEvidenceReceipt,
  parsePublicEvidenceReceipt,
} from "../src/receipts.ts";
import type { RunPlan } from "../src/eval-core.ts";

const PRODUCT_BOUNDARY = Object.freeze({
  candidateMode: "connectivity_only" as const,
  capabilitiesUsed: Object.freeze([]) as readonly [],
  productBehaviorExercised: false as const,
  referenceHost: "eval-skills-reference-host-v1" as const,
  productIdentity: Object.freeze({
    repository: "https://github.com/openboa-ai/coffee-chat" as const,
    commit: "a".repeat(40),
    calver: "2026.8.23",
    packageDigest: ("sha256:" + "b".repeat(64)) as `sha256:${string}`,
  }),
});

const plan: RunPlan = {
  id: "run-fixture",
  trackId: "coffee-chat-taste",
  profile: "score",
  sourceManifestDigest: stableDigest("source"),
  runSpecDigest: stableDigest("spec"),
  claimStatus: "provisional_internal",
  executionStatus: "unmeasured",
  evidenceRoot: "/var/tmp/evidence",
  cacheRoot: "/var/tmp/cache",
};

test("redacts raw task candidate judge and secret content from public receipts", () => {
  const receipt = createEvidenceReceipt({
    plan,
    executionStatus: "failed",
    failureOwner: "judge",
    privateEvidence: {
      task: "raw task must remain private",
      candidate: "raw candidate output must remain private",
      judge: "raw judge output must remain private",
      secret: "raw secret must remain private",
    },
  });
  const publicReceipt = redactEvidenceReceipt(receipt);
  const serialized = JSON.stringify(publicReceipt);

  assert.equal(publicReceipt.executionStatus, "failed");
  assert.equal(publicReceipt.failureOwner, "judge");
  assert.doesNotMatch(serialized, /raw (?:task|candidate|judge|secret)/u);
  assert.equal("privateEvidence" in publicReceipt, false);
});

test("preserves skipped, missing, and rights-hold states without a zero score", () => {
  for (const executionStatus of ["skipped", "missing", "rights_hold"] as const) {
    const receipt = createEvidenceReceipt({
      plan,
      executionStatus,
      ...(executionStatus === "rights_hold" ? { failureOwner: "rights" as const } : {}),
      privateEvidence: {
        task: "private",
        candidate: "private",
        judge: "private",
        secret: "private",
      },
    });
    const publicReceipt = redactEvidenceReceipt(receipt);

    assert.equal(publicReceipt.executionStatus, executionStatus);
    assert.equal("score" in publicReceipt, false);
  }
});

test("public receipts disclose only safe product connectivity provenance", () => {
  const receipt = createEvidenceReceipt({
    plan: { ...plan, profile: "smoke", claimStatus: "calibration" },
    executionStatus: "measured",
    productBoundary: PRODUCT_BOUNDARY,
    privateEvidence: {
      task: "raw task",
      candidate: "raw candidate",
      judge: "raw judge",
      secret: "private-token packageRoot=/private/tmp/product",
    },
  });
  const publicReceipt = redactEvidenceReceipt(receipt);
  const serialized = JSON.stringify(publicReceipt);

  assert.equal(publicReceipt.candidateMode, "connectivity_only");
  assert.deepEqual(publicReceipt.capabilitiesUsed, []);
  assert.equal(publicReceipt.productBehaviorExercised, false);
  assert.equal(
    publicReceipt.productIdentity?.packageDigest,
    PRODUCT_BOUNDARY.productIdentity.packageDigest,
  );
  assert.doesNotMatch(serialized, /packageRoot|private-token|raw candidate/u);
});

test("public receipts disclose only the digest and false-clearance risk boundary", () => {
  const rightsRiskAcceptanceDigest = stableDigest("private acceptance body");
  const acceptedPlan: RunPlan = {
    ...plan,
    trackId: "ifeval",
    profile: "smoke",
    claimStatus: "calibration",
    runSpec: {
      schema: "run-spec-v1",
      trackId: "ifeval",
      profile: "smoke",
      sourceManifestDigest: stableDigest("source"),
      candidateDigest: stableDigest("candidate"),
      judgeDigest: stableDigest("judge"),
      attackDigest: stableDigest("attack"),
      defenseDigest: stableDigest("defense"),
      configurationDigest: stableDigest("configuration"),
      rightsRiskAcceptanceDigest,
      candidateType: "coffee_chat_product",
    },
  };
  const publicReceipt = redactEvidenceReceipt(
    createEvidenceReceipt({
      plan: acceptedPlan,
      executionStatus: "measured",
      rightsRiskAcceptanceValidated: true,
      productBoundary: PRODUCT_BOUNDARY,
      privateEvidence: {
        task: "workspace-owner acceptedAt private path",
        candidate: "private",
        judge: "private",
        secret: "private",
      },
    }),
  );

  assert.equal(publicReceipt.rightsRiskAcceptanceDigest, rightsRiskAcceptanceDigest);
  assert.equal(publicReceipt.licenseCleared, false);
  assert.equal(publicReceipt.rightsExecutionScope, "private-internal-smoke-only");
  assert.equal(publicReceipt.candidateMode, "connectivity_only");
  assert.doesNotMatch(
    JSON.stringify(publicReceipt),
    /workspace-owner|acceptedAt|private path/u,
  );
  const partial = { ...publicReceipt } as Record<string, unknown>;
  delete partial.licenseCleared;
  assert.throws(
    () => parsePublicEvidenceReceipt(partial),
    /unexpected|rights risk provenance/u,
  );

  const withoutProductBoundary = { ...publicReceipt } as Record<string, unknown>;
  for (const key of [
    "candidateMode",
    "capabilitiesUsed",
    "productBehaviorExercised",
    "referenceHost",
    "productIdentity",
  ]) {
    delete withoutProductBoundary[key];
  }
  assert.throws(
    () => parsePublicEvidenceReceipt(withoutProductBoundary),
    /rights risk provenance|product candidate boundary/u,
  );

  assert.throws(
    () =>
      createEvidenceReceipt({
        plan: acceptedPlan,
        executionStatus: "measured",
        rightsRiskAcceptanceValidated: true,
        privateEvidence: {
          task: "private",
          candidate: "private",
          judge: "private",
          secret: "private",
        },
      }),
    /rights risk provenance|product candidate boundary/u,
  );

  const {
    candidateMode: _candidateMode,
    capabilitiesUsed: _capabilitiesUsed,
    productBehaviorExercised: _productBehaviorExercised,
    referenceHost: _referenceHost,
    productIdentity: _productIdentity,
    ...malformedPrivateReceipt
  } = createEvidenceReceipt({
    plan: acceptedPlan,
    executionStatus: "measured",
    rightsRiskAcceptanceValidated: true,
    productBoundary: PRODUCT_BOUNDARY,
    privateEvidence: {
      task: "private",
      candidate: "private",
      judge: "private",
      secret: "private",
    },
  });
  assert.throws(
    () => redactEvidenceReceipt(malformedPrivateReceipt as never),
    /rights risk provenance|product candidate boundary/u,
  );
});
