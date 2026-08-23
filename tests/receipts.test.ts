import assert from "node:assert/strict";
import test from "node:test";

import { stableDigest } from "../src/identity.ts";
import { redactEvidenceReceipt, createEvidenceReceipt } from "../src/receipts.ts";
import type { RunPlan } from "../src/eval-core.ts";

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
