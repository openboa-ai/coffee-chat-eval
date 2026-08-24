import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  IFEVAL_NATIVE_RUNTIME_RIGHTS,
  IFEVAL_PILOT_CASES,
  IFEVAL_PROMPT_COUNT,
  IFEVAL_TOP_LEVEL_FAMILIES,
  createIfevalInventory,
  createIfevalTrackExecutor,
  ifevalRightsRiskAcceptanceDigest,
  parseIfevalRightsRiskAcceptance,
  summarizeIfevalObservations,
  validateIfevalPrivateSmokeRiskAcceptance,
  type IfevalObservation,
} from "../src/ifeval.ts";
import { createFixtureCandidateTransport } from "../src/transports.ts";
import { putEvidence } from "../src/evidence.ts";
import { stableDigest } from "../src/identity.ts";

test("IFEval inventory pins the official 541 prompts and nine checker-family first cases", () => {
  assert.equal(IFEVAL_PROMPT_COUNT, 541);
  assert.deepEqual(IFEVAL_TOP_LEVEL_FAMILIES, [
    "punctuation",
    "detectable_format",
    "length_constraints",
    "detectable_content",
    "combination",
    "change_case",
    "startend",
    "keywords",
    "language",
  ]);
  assert.deepEqual(IFEVAL_PILOT_CASES, [
    { family: "punctuation", caseId: "1000" },
    { family: "detectable_format", caseId: "1012" },
    { family: "length_constraints", caseId: "1069" },
    { family: "detectable_content", caseId: "1005" },
    { family: "combination", caseId: "1098" },
    { family: "change_case", caseId: "1019" },
    { family: "startend", caseId: "1040" },
    { family: "keywords", caseId: "1122" },
    { family: "language", caseId: "1108" },
  ]);
  assert.equal(createIfevalInventory("score").length, 541);
  assert.equal(createIfevalInventory("smoke").length, 9);
  assert.equal(createIfevalInventory("pilot").length, 9);
  assert.equal(createIfevalInventory("fixture").length, 1);
});

test("IFEval risk acceptance is exact, private-smoke-only, and does not claim a license grant", () => {
  const receipt = parseIfevalRightsRiskAcceptance({
    schema: "ifeval-rights-risk-acceptance-v1",
    trackId: "ifeval",
    profile: "smoke",
    candidateType: "coffee_chat_product",
    candidateDigest: `sha256:${"c".repeat(64)}`,
    ifevalSourceCommit: "e6890f85757dd84e27ca6df2dd30651dafad28e0",
    assetRepository: IFEVAL_NATIVE_RUNTIME_RIGHTS.repository,
    assetRevision: IFEVAL_NATIVE_RUNTIME_RIGHTS.revision,
    asset: IFEVAL_NATIVE_RUNTIME_RIGHTS.asset,
    assetDigest: IFEVAL_NATIVE_RUNTIME_RIGHTS.digest,
    licenseStatus: "unclarified",
    licenseCleared: false,
    scope: "private-internal-smoke-only",
    acceptedBy: "workspace-owner",
    acceptedAt: "2026-08-24T01:55:00+09:00",
    privateNonce: "a".repeat(64),
    acknowledgesNoLicenseGrant: true,
    acknowledgesNoRedistribution: true,
    acknowledgesNoPublicNumericClaim: true,
  });

  assert.equal(receipt.licenseCleared, false);
  assert.match(ifevalRightsRiskAcceptanceDigest(receipt), /^sha256:[a-f0-9]{64}$/u);
  assert.throws(
    () =>
      parseIfevalRightsRiskAcceptance({
        ...receipt,
        privateNonce: "predictable",
      }),
    /private nonce/u,
  );
  assert.throws(
    () => parseIfevalRightsRiskAcceptance({ ...receipt, profile: "pilot" }),
    /private smoke/u,
  );
  assert.throws(
    () => parseIfevalRightsRiskAcceptance({ ...receipt, licenseCleared: true }),
    /licenseCleared/u,
  );
  assert.throws(
    () =>
      parseIfevalRightsRiskAcceptance({
        ...receipt,
        assetRevision: "unreviewed",
      }),
    /asset identity/u,
  );
  assert.throws(
    () =>
      parseIfevalRightsRiskAcceptance({
        ...receipt,
        candidateType: "agent_stack",
      }),
    /Product candidate/u,
  );
  assert.throws(
    () =>
      validateIfevalPrivateSmokeRiskAcceptance({
        profile: "smoke",
        candidateType: "coffee_chat_product",
        expectedDigest: ifevalRightsRiskAcceptanceDigest(receipt),
        expectedCandidateDigest: stableDigest("different Product candidate"),
        receipt,
      }),
    /candidate identity/u,
  );
  assert.throws(
    () =>
      parseIfevalRightsRiskAcceptance({
        ...receipt,
        acceptedBy: "automation",
      }),
    /operator/u,
  );
  assert.throws(
    () => parseIfevalRightsRiskAcceptance({ ...receipt, rawAssetPath: "/private" }),
    /unexpected/u,
  );
});

test("IFEval keeps four native metrics and never turns an empty denominator into zero", () => {
  const observations: IfevalObservation[] = [
    {
      caseId: "1000",
      strictPrompt: true,
      strictInstructions: [true, false],
      loosePrompt: true,
      looseInstructions: [true, true],
    },
    {
      caseId: "1005",
      strictPrompt: false,
      strictInstructions: [false],
      loosePrompt: true,
      looseInstructions: [true],
    },
  ];
  const report = summarizeIfevalObservations(observations);
  assert.deepEqual(report.metrics.strictPrompt, {
    numerator: 1,
    denominator: 2,
    accuracy: 0.5,
  });
  assert.deepEqual(report.metrics.strictInstruction, {
    numerator: 1,
    denominator: 3,
    accuracy: 1 / 3,
  });
  assert.deepEqual(report.metrics.loosePrompt, {
    numerator: 2,
    denominator: 2,
    accuracy: 1,
  });
  assert.deepEqual(report.metrics.looseInstruction, {
    numerator: 3,
    denominator: 3,
    accuracy: 1,
  });
  assert.equal(summarizeIfevalObservations([]).metrics.strictPrompt.accuracy, null);
});

test("IFEval native live execution fails closed before candidate calls while punkt_tab rights are unclarified", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-ifeval-rights-hold-"));
  try {
    let candidateCalls = 0;
    const candidate = {
      ...createFixtureCandidateTransport(
        () => {
          candidateCalls += 1;
          return "must-not-run";
        },
        { evidenceRoot: root },
      ),
      kind: "agent_stack" as const,
    };
    const result = await createIfevalTrackExecutor()({
      plan: {
        profile: "smoke",
        id: "run-ifeval-rights-hold",
        evidenceRoot: root,
        trackId: "ifeval",
      },
      source: { sourceRoot: join(root, "source") },
      candidate,
      evidence: ({ value, mediaType }) => {
        const serialized = JSON.stringify(value);
        const evidence = putEvidence(root, serialized, "private");
        return {
          path: evidence.path,
          digest: evidence.digest,
          mediaType,
          bytes: Buffer.byteLength(serialized),
        };
      },
    });

    assert.equal(result.executionStatus, "rights_hold");
    assert.equal(result.failureOwner, "rights");
    assert.equal(candidateCalls, 0);
    assert.equal(result.trialReceipts.length, 0);
    assert.equal(IFEVAL_NATIVE_RUNTIME_RIGHTS.licenseStatus, "unclarified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("IFEval injected bridges cannot bypass the native rights hold for a live candidate", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-ifeval-injected-rights-hold-"));
  try {
    const sourceRoot = join(root, "source");
    const inputPath = join(sourceRoot, "instruction_following_eval", "data");
    mkdirSync(inputPath, { recursive: true });
    writeFileSync(
      join(inputPath, "input_data.jsonl"),
      IFEVAL_PILOT_CASES.map((entry) =>
        JSON.stringify({ key: Number(entry.caseId), prompt: `prompt-${entry.caseId}` }),
      ).join("\n") + "\n",
    );
    let candidateCalls = 0;
    let bridgeCalls = 0;
    const fixture = createFixtureCandidateTransport(
      () => {
        candidateCalls += 1;
        return "must-not-run";
      },
      { evidenceRoot: root },
    );
    const result = await createIfevalTrackExecutor({
      bridge: {
        run: async () => {
          bridgeCalls += 1;
        },
      },
    })({
      plan: {
        profile: "smoke",
        id: "run-ifeval-injected-rights-hold",
        evidenceRoot: root,
        trackId: "ifeval",
      },
      source: { sourceRoot },
      candidate: { ...fixture, kind: "agent_stack" },
      evidence: ({ value, mediaType }) => {
        const serialized = JSON.stringify(value);
        const evidence = putEvidence(root, serialized, "private");
        return {
          path: evidence.path,
          digest: evidence.digest,
          mediaType,
          bytes: Buffer.byteLength(serialized),
        };
      },
    });

    assert.equal(result.executionStatus, "rights_hold");
    assert.equal(result.failureOwner, "rights");
    assert.equal(candidateCalls, 0);
    assert.equal(bridgeCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("IFEval accepted Product smoke preflights runtime data before nine candidate calls", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-ifeval-risk-accepted-"));
  try {
    const sourceRoot = join(root, "source");
    const inputPath = join(sourceRoot, "instruction_following_eval", "data");
    mkdirSync(inputPath, { recursive: true });
    writeFileSync(
      join(inputPath, "input_data.jsonl"),
      IFEVAL_PILOT_CASES.map((entry) =>
        JSON.stringify({ key: Number(entry.caseId), prompt: `prompt-${entry.caseId}` }),
      ).join("\n") + "\n",
    );
    const candidateDigest = stableDigest("exact-product-candidate");
    const acceptance = parseIfevalRightsRiskAcceptance({
      schema: "ifeval-rights-risk-acceptance-v1",
      trackId: "ifeval",
      profile: "smoke",
      candidateType: "coffee_chat_product",
      candidateDigest,
      ifevalSourceCommit: "e6890f85757dd84e27ca6df2dd30651dafad28e0",
      assetRepository: IFEVAL_NATIVE_RUNTIME_RIGHTS.repository,
      assetRevision: IFEVAL_NATIVE_RUNTIME_RIGHTS.revision,
      asset: IFEVAL_NATIVE_RUNTIME_RIGHTS.asset,
      assetDigest: IFEVAL_NATIVE_RUNTIME_RIGHTS.digest,
      licenseStatus: "unclarified",
      licenseCleared: false,
      scope: "private-internal-smoke-only",
      acceptedBy: "workspace-owner",
      acceptedAt: "2026-08-24T01:55:00+09:00",
      privateNonce: "b".repeat(64),
      acknowledgesNoLicenseGrant: true,
      acknowledgesNoRedistribution: true,
      acknowledgesNoPublicNumericClaim: true,
    });
    const events: string[] = [];
    const plan = {
      profile: "smoke" as const,
      id: "run-ifeval-risk-accepted",
      evidenceRoot: root,
      trackId: "ifeval" as const,
      runSpec: {
        candidateType: "coffee_chat_product" as const,
        candidateDigest,
        rightsRiskAcceptanceDigest: ifevalRightsRiskAcceptanceDigest(acceptance),
      },
    };
    const evidenceWriter = ({
      value,
      mediaType,
    }: {
      readonly value: unknown;
      readonly mediaType: string;
    }) => {
      const serialized = JSON.stringify(value);
      const evidence = putEvidence(root, serialized, "private");
      return {
        path: evidence.path,
        digest: evidence.digest,
        mediaType,
        bytes: Buffer.byteLength(serialized),
      };
    };
    let blockedCandidateCalls = 0;
    const blockedFixture = createFixtureCandidateTransport(
      () => {
        blockedCandidateCalls += 1;
        return "must not run before runtime preflight";
      },
      { evidenceRoot: root },
    );
    const unavailable = await createIfevalTrackExecutor()({
      plan,
      source: { sourceRoot },
      candidate: { ...blockedFixture, kind: "coffee_chat_product" },
      ifevalRightsRiskAcceptance: acceptance,
      evidence: evidenceWriter,
    });
    assert.equal(unavailable.executionStatus, "unavailable");
    assert.equal(unavailable.failureOwner, "source");
    assert.equal(blockedCandidateCalls, 0);

    const fixture = createFixtureCandidateTransport(
      () => {
        events.push("candidate");
        return "candidate response";
      },
      { evidenceRoot: root },
    );
    const result = await createIfevalTrackExecutor({
      bridge: {
        preflight: async () => {
          events.push("preflight");
          return { status: "verified", rightsCleared: false };
        },
        run: async ({ output, keys }) => {
          events.push("native");
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
                  { numerator: 1, denominator: keys.length, accuracy: 1 / keys.length },
                ]),
              ),
            }),
          );
        },
      },
    })({
      plan,
      source: { sourceRoot },
      candidate: { ...fixture, kind: "coffee_chat_product" },
      ifevalRightsRiskAcceptance: acceptance,
      evidence: evidenceWriter,
    });

    assert.equal(result.executionStatus, "measured");
    assert.deepEqual(events, [
      "preflight",
      ...Array.from({ length: 9 }, () => "candidate"),
      "native",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("IFEval smoke executor calls the candidate for nine pinned prompts and validates native denominators", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-ifeval-executor-"));
  try {
    const sourceRoot = join(root, "source");
    const inputPath = join(sourceRoot, "instruction_following_eval", "data");
    mkdirSync(inputPath, { recursive: true });
    writeFileSync(
      join(inputPath, "input_data.jsonl"),
      IFEVAL_PILOT_CASES.map((entry) =>
        JSON.stringify({ key: Number(entry.caseId), prompt: `prompt-${entry.caseId}` }),
      ).join("\n") + "\n",
    );
    let candidateCalls = 0;
    const candidate = createFixtureCandidateTransport(
      () => {
        candidateCalls += 1;
        return `response-${candidateCalls}`;
      },
      { evidenceRoot: root },
    );
    const executor = createIfevalTrackExecutor({
      bridge: {
        run: async ({ output, keys }) => {
          writeFileSync(
            output,
            JSON.stringify({
              source: { inputCount: keys.length, keys },
              metrics: {
                strictPrompt: {
                  numerator: 1,
                  denominator: keys.length,
                  accuracy: 1 / keys.length,
                },
                strictInstruction: {
                  numerator: 1,
                  denominator: keys.length,
                  accuracy: 1 / keys.length,
                },
                loosePrompt: {
                  numerator: 1,
                  denominator: keys.length,
                  accuracy: 1 / keys.length,
                },
                looseInstruction: {
                  numerator: 1,
                  denominator: keys.length,
                  accuracy: 1 / keys.length,
                },
              },
            }),
          );
        },
      },
    });
    const result = await executor({
      plan: {
        profile: "smoke",
        id: "run-ifeval",
        evidenceRoot: root,
        trackId: "ifeval",
      },
      source: { sourceRoot },
      candidate,
      evidence: ({ value, mediaType }) => {
        const evidence = putEvidence(
          root,
          typeof value === "string" ? value : JSON.stringify(value),
          "private",
        );
        return {
          path: evidence.path,
          digest: evidence.digest,
          mediaType,
          bytes: Buffer.byteLength(
            typeof value === "string" ? value : JSON.stringify(value),
          ),
        };
      },
    });
    assert.equal(result.executionStatus, "measured");
    assert.equal(candidateCalls, 9);
    assert.equal(result.metrics.strictPrompt?.denominator, 9);
    assert.equal(result.trialReceipts.length, 9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("IFEval score executor resolves ordinal inventory identities to official source keys", async () => {
  const root = mkdtempSync(join(tmpdir(), "coffee-chat-ifeval-score-executor-"));
  try {
    const sourceRoot = join(root, "source");
    const inputPath = join(sourceRoot, "instruction_following_eval", "data");
    mkdirSync(inputPath, { recursive: true });
    writeFileSync(
      join(inputPath, "input_data.jsonl"),
      Array.from({ length: IFEVAL_PROMPT_COUNT }, (_, index) =>
        JSON.stringify({ key: 2000 + index, prompt: `prompt-${index}` }),
      ).join("\n") + "\n",
    );
    const candidate = createFixtureCandidateTransport(() => "score-response", {
      evidenceRoot: root,
    });
    let observedKeys: readonly number[] = [];
    const executor = createIfevalTrackExecutor({
      bridge: {
        run: async ({ output, keys }) => {
          observedKeys = keys;
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
    });
    const result = await executor({
      plan: {
        profile: "score",
        id: "run-ifeval-score",
        evidenceRoot: root,
        trackId: "ifeval",
      },
      source: { sourceRoot },
      candidate,
      evidence: ({ value, mediaType }) => {
        const evidence = putEvidence(root, JSON.stringify(value), "private");
        return {
          path: evidence.path,
          digest: evidence.digest,
          mediaType,
          bytes: Buffer.byteLength(JSON.stringify(value)),
        };
      },
    });
    assert.equal(result.executionStatus, "measured");
    assert.equal(result.trialReceipts.length, IFEVAL_PROMPT_COUNT);
    assert.deepEqual(observedKeys.slice(0, 3), [2000, 2001, 2002]);
    assert.deepEqual(observedKeys.slice(-1), [2540]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
