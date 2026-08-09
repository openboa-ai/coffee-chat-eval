import assert from "node:assert/strict";
import test from "node:test";

import { createFakeCandidate } from "../src/adapters/fake-candidate.ts";
import { createFakeHost } from "../src/hosts/fake-host.ts";
import { createTrialIdentity, stableDigest } from "../src/identity.ts";
import { runTrial } from "../src/runner.ts";
import { validateTrialProvenance } from "../src/validation.ts";
import type {
  CandidateAdapter,
  HostAdapter,
  HostEvidence,
  TaskAdapter,
  TimingProvider,
  TrialSpec,
} from "../src/types.ts";

const trial: TrialSpec = {
  evaluator: {
    repository: "https://github.com/openboa-ai/coffee-chat-eval",
    commit: "741e54ea6c49b9ab53a6c29ee79ccc033dc548b9",
    calver: "2026.8.9",
    configurationDigest: stableDigest("fixture-evaluator-configuration"),
  },
  candidate: {
    repository: "https://github.com/openboa-ai/coffee-chat",
    commit: "0123456789abcdef0123456789abcdef01234567",
    calver: "2026.8.9",
    adapter: "fake-candidate",
  },
  task: { id: "fixture-task", digest: stableDigest("fixture-task") },
  harness: { id: "fixture-harness", digest: stableDigest("fixture-harness") },
  model: { id: "fixture-model", digest: stableDigest("fixture-model") },
  host: {
    id: "fixture-host",
    isolationClass: "fixture",
    configurationDigest: stableDigest("fixture-host-configuration"),
    isolationReference: "fixture://fake-host",
  },
  repetition: 0,
};

const verifier: TaskAdapter = {
  ref: trial.task,
  verify: (artifact) => ({
    status: "valid",
    metrics: { checks: artifact.value === "ok" ? 1 : 0 },
  }),
};

function unmeasuredTiming(): TimingProvider {
  return {
    ref: {
      id: "fixture-timing",
      digest: "sha256:fixture-timing",
      kind: "unmeasured" as const,
    },
  };
}

function fixtureInput() {
  return {
    trial,
    runningEvaluator: trial.evaluator,
    candidate: createFakeCandidate(),
    host: createFakeHost(),
    task: verifier,
    now: () => "2026-08-09T00:00:00.000Z",
    timing: unmeasuredTiming(),
  };
}

function isolatedTrial(): TrialSpec {
  return {
    ...trial,
    host: {
      id: "isolated-host",
      isolationClass: "isolated",
      configurationDigest: stableDigest("isolated-host-configuration"),
      isolationReference:
        "https://evidence.example/host-config/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  };
}

function boundIsolationEvidence(binding: {
  readonly reference: string;
  readonly detail: string;
  readonly trialId: string;
  readonly artifactDigest: `sha256:${string}`;
}) {
  return { ...binding, digest: stableDigest(binding) };
}

test("fixture trial stores content-addressed host evidence without performance credit", async () => {
  const trialId = createTrialIdentity(trial);
  const artifactDigest = stableDigest("ok");
  const reference = `fixture://workspace-${trialId}`;
  const detail = "token=keep-this-secret";
  const result = await runTrial({
    ...fixtureInput(),
    host: createFakeHost({ evidence: detail }),
  });

  assert.equal(result.status, "unmeasured");
  assert.equal(result.evidenceClass, "fixture");
  assert.equal(result.cleanup.status, "completed");
  assert.deepEqual(result.hostEvidence, {
    locator: reference,
    digest: stableDigest({ reference, detail, trialId, artifactDigest }),
    trialId,
    artifactDigest,
  });
  assert.equal(JSON.stringify(result).includes("keep-this-secret"), false);
  assert.equal(result.timing.status, "unmeasured");
  assert.equal(result.performanceClaim, false);
  assert.deepEqual(result.evaluator, trial.evaluator);
});

test("isolated trials receive no measured credit without structurally valid inspectable evidence", async () => {
  const isolated = isolatedTrial();
  const canonicalTrialId = createTrialIdentity(isolated);
  const artifactDigest = stableDigest("ok");
  const result = await runTrial({
    ...fixtureInput(),
    trial: isolated,
    host: {
      ref: isolated.host,
      async execute({ trial: adapterTrial, candidate, workspaceId }) {
        return {
          kind: "completed" as const,
          evidence: boundIsolationEvidence({
            reference: "",
            detail: "",
            trialId: canonicalTrialId,
            artifactDigest,
          }),
          candidate: await candidate.run({ trial: adapterTrial, workspaceId }),
        };
      },
      async cleanup() {},
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.error?.code, "isolation_evidence_invalid");
  assert.equal(result.metrics, undefined);

  const credentialedReference =
    "https://evidence.example/runs/fixture?token=must-not-enter-receipt";
  const credentialed = await runTrial({
    ...fixtureInput(),
    trial: isolated,
    host: {
      ref: isolated.host,
      async execute({ trial: adapterTrial, candidate, workspaceId }) {
        return {
          kind: "completed" as const,
          evidence: {
            ...boundIsolationEvidence({
              reference: credentialedReference,
              detail: "isolated workspace receipt",
              trialId: canonicalTrialId,
              artifactDigest,
            }),
          },
          candidate: await candidate.run({ trial: adapterTrial, workspaceId }),
        };
      },
      async cleanup() {},
    },
  });
  assert.equal(credentialed.status, "unavailable");
  assert.equal(credentialed.error?.code, "isolation_evidence_invalid");
  assert.doesNotMatch(JSON.stringify(credentialed), /must-not-enter-receipt/u);

  const evidenceReference =
    "https://evidence.example/runs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const evidenceDetail = "inspectable-isolation-evidence";
  const evidence = boundIsolationEvidence({
    reference: evidenceReference,
    detail: evidenceDetail,
    trialId: canonicalTrialId,
    artifactDigest,
  });
  const measured = await runTrial({
    ...fixtureInput(),
    trial: isolated,
    host: {
      ref: isolated.host,
      async execute({ trial: adapterTrial, trialId, candidate, workspaceId }) {
        const candidateRun = await candidate.run({
          trial: adapterTrial,
          workspaceId,
        });
        assert.equal(trialId, canonicalTrialId);
        assert.equal(candidateRun.kind, "success");
        assert.ok(candidateRun.artifact);
        return {
          kind: "completed" as const,
          evidence: boundIsolationEvidence({
            reference: evidenceReference,
            detail: evidenceDetail,
            trialId,
            artifactDigest: candidateRun.artifact.digest,
          }),
          candidate: candidateRun,
        };
      },
      async cleanup() {},
    },
  });
  assert.equal(measured.status, "measured");
  assert.deepEqual(measured.hostEvidence, {
    locator: evidenceReference,
    digest: evidence.digest,
    trialId: canonicalTrialId,
    artifactDigest,
  });
});

test("unbound or stale isolated evidence cannot produce measured credit", async () => {
  const isolated = isolatedTrial();
  const canonicalTrialId = createTrialIdentity(isolated);
  const artifactDigest = stableDigest("ok");
  const reference =
    "https://evidence.example/runs/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
  const unboundDetail = "legacy evidence with no trial or artifact binding";
  const scenarios: ReadonlyArray<{
    readonly name: string;
    readonly evidence: unknown;
  }> = [
    {
      name: "unbound",
      evidence: {
        reference,
        detail: unboundDetail,
        digest: stableDigest({ reference, detail: unboundDetail }),
      },
    },
    {
      name: "another trial",
      evidence: boundIsolationEvidence({
        reference,
        detail: "evidence from another trial",
        trialId: createTrialIdentity({ ...isolated, repetition: 1 }),
        artifactDigest,
      }),
    },
    {
      name: "another artifact",
      evidence: boundIsolationEvidence({
        reference,
        detail: "evidence for stale output",
        trialId: canonicalTrialId,
        artifactDigest: stableDigest("stale output"),
      }),
    },
  ];

  for (const scenario of scenarios) {
    const result = await runTrial({
      ...fixtureInput(),
      trial: isolated,
      host: {
        ref: isolated.host,
        async execute({ trial: adapterTrial, candidate, workspaceId }) {
          return {
            kind: "completed" as const,
            evidence: scenario.evidence as HostEvidence,
            candidate: await candidate.run({ trial: adapterTrial, workspaceId }),
          };
        },
        async cleanup() {},
      },
    });

    assert.equal(result.status, "unavailable", scenario.name);
    assert.equal(result.error?.code, "isolation_evidence_invalid", scenario.name);
    assert.equal(result.hostEvidence, undefined, scenario.name);
    assert.equal(result.metrics, undefined, scenario.name);
  }
});

test("isolated evidence must bind immutable locator and exact evidence bytes", async () => {
  const isolated = isolatedTrial();
  const canonicalTrialId = createTrialIdentity(isolated);
  const artifactDigest = stableDigest("ok");
  for (const evidence of [
    {
      reference:
        "https://evidence.example/runs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      digest: stableDigest("unbound-digest"),
      detail: "inspectable bytes",
      trialId: canonicalTrialId,
      artifactDigest,
    },
    boundIsolationEvidence({
      reference: "https://evidence.example/runs/latest",
      detail: "inspectable bytes",
      trialId: canonicalTrialId,
      artifactDigest,
    }),
  ]) {
    const result = await runTrial({
      ...fixtureInput(),
      trial: isolated,
      host: {
        ref: isolated.host,
        async execute({ trial: adapterTrial, candidate, workspaceId }) {
          return {
            kind: "completed" as const,
            evidence,
            candidate: await candidate.run({ trial: adapterTrial, workspaceId }),
          };
        },
        async cleanup() {},
      },
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.error?.code, "isolation_evidence_invalid");
    assert.equal(result.hostEvidence, undefined);
  }
});

test("candidate failure remains candidate-owned when isolated evidence is absent", async () => {
  const isolated = isolatedTrial();
  const result = await runTrial({
    ...fixtureInput(),
    trial: isolated,
    candidate: createFakeCandidate({ failure: "candidate" }),
    host: {
      ref: isolated.host,
      async execute({ trial: adapterTrial, candidate, workspaceId }) {
        return {
          kind: "completed" as const,
          candidate: await candidate.run({ trial: adapterTrial, workspaceId }),
        };
      },
      async cleanup() {},
    },
  });

  assert.equal(result.status, "candidate_failure");
  assert.equal(result.error?.code, "candidate_execution_failed");
  assert.equal(result.hostEvidence, undefined);
});

test("candidate adapter exceptions remain candidate-owned through host execution", async () => {
  const candidates: readonly CandidateAdapter[] = [
    {
      ref: trial.candidate,
      run: () => {
        throw new Error("sync candidate secret");
      },
    },
    {
      ref: trial.candidate,
      run: async () => {
        throw new Error("rejected candidate secret");
      },
    },
  ];

  for (const candidate of candidates) {
    const result = await runTrial({ ...fixtureInput(), candidate });

    assert.equal(result.status, "candidate_failure");
    assert.equal(result.error?.code, "candidate_execution_failed");
    assert.equal(result.cleanup.status, "completed");
    assert.equal(result.hostEvidence, undefined);
    assert.equal(result.artifact, undefined);
    assert.equal(result.metrics, undefined);
    assert.doesNotMatch(JSON.stringify(result), /candidate secret/u);
  }
});

test("malformed resolved candidate runs remain candidate-owned through host execution", async () => {
  const throwingKind = Object.defineProperty({}, "kind", {
    enumerable: true,
    get() {
      throw new Error("candidate-controlled discriminator");
    },
  });
  const scenarios: ReadonlyArray<{
    readonly name: string;
    readonly value: unknown;
  }> = [
    { name: "undefined", value: undefined },
    { name: "null", value: null },
    { name: "missing discriminator", value: {} },
    { name: "unknown discriminator", value: { kind: "unknown" } },
    { name: "throwing discriminator", value: throwingKind },
  ];

  for (const scenario of scenarios) {
    const result = await runTrial({
      ...fixtureInput(),
      candidate: {
        ref: trial.candidate,
        run: async () => scenario.value as never,
      },
    });

    assert.equal(result.status, "candidate_failure", scenario.name);
    assert.equal(result.error?.code, "candidate_execution_failed", scenario.name);
    assert.equal(result.cleanup.status, "completed", scenario.name);
    assert.equal(result.hostEvidence, undefined, scenario.name);
    assert.equal(result.artifact, undefined, scenario.name);
    assert.equal(result.metrics, undefined, scenario.name);
    assert.doesNotMatch(
      JSON.stringify(result),
      /candidate-controlled discriminator/u,
      scenario.name,
    );
  }
});

test("host, candidate, verifier, and invalid boundaries remain distinct", async () => {
  const hostFailure = await runTrial({
    ...fixtureInput(),
    host: createFakeHost({ failure: "host" }),
  });
  const candidateFailure = await runTrial({
    ...fixtureInput(),
    candidate: createFakeCandidate({ failure: "candidate" }),
  });
  const verifierFailure = await runTrial({
    ...fixtureInput(),
    task: {
      ...verifier,
      verify: () => {
        throw new Error("verifier stopped");
      },
    },
  });
  const invalid = await runTrial({
    ...fixtureInput(),
    candidate: createFakeCandidate({ artifact: undefined }),
  });

  assert.deepEqual(
    [
      hostFailure.status,
      candidateFailure.status,
      verifierFailure.status,
      invalid.status,
    ],
    ["host_failure", "candidate_failure", "verifier_failure", "invalid"],
  );
});

test("malformed candidate artifacts stay at the candidate invalid boundary", async () => {
  const throwingArtifact = Object.defineProperty(
    { digest: stableDigest("ok"), value: "ok" },
    "id",
    {
      enumerable: true,
      get() {
        throw new Error("candidate-controlled getter");
      },
    },
  );
  for (const artifact of [
    1,
    {},
    { id: null, digest: stableDigest("ok"), value: "ok" },
    throwingArtifact,
  ]) {
    const result = await runTrial({
      ...fixtureInput(),
      candidate: {
        ref: trial.candidate,
        run: async () => ({ kind: "success" as const, artifact }),
      } as unknown as ReturnType<typeof createFakeCandidate>,
    });

    assert.equal(result.status, "invalid");
    assert.equal(result.error?.code, "artifact_digest_invalid");
  }
});

test("non-finite and non-JSON verifier metrics are rejected before receipt digesting", async () => {
  for (const invalidMetric of [Number.NaN, Number.POSITIVE_INFINITY, 1n]) {
    const result = await runTrial({
      ...fixtureInput(),
      task: {
        ...verifier,
        verify: () =>
          ({
            status: "valid",
            metrics: { score: invalidMetric },
          }) as unknown as ReturnType<TaskAdapter["verify"]>,
      },
    });

    assert.equal(result.status, "verifier_failure");
    assert.equal(result.error?.code, "verification_metrics_invalid");
    assert.equal(result.metrics, undefined);
    assert.match(result.receiptDigest, /^sha256:[0-9a-f]{64}$/u);
  }
});

test("verifier results must use one exact declared status shape", async () => {
  for (const verification of [
    { status: "accepted", metrics: { score: 1 } },
    { status: "valid", metrics: { score: 1 }, undeclared: "secret" },
    { status: "skipped", reason: "unsupported", undeclared: true },
    { status: "unavailable", reason: "" },
    { status: "unmeasured", metrics: { score: 1 } },
  ]) {
    const result = await runTrial({
      ...fixtureInput(),
      task: {
        ...verifier,
        verify: () => verification as unknown as ReturnType<TaskAdapter["verify"]>,
      },
    });

    assert.equal(result.status, "verifier_failure");
    assert.equal(result.error?.code, "verification_result_invalid");
    assert.equal(result.metrics, undefined);
    assert.doesNotMatch(JSON.stringify(result), /secret/u);
  }
});

test("skipped, unavailable, and evaluator boundaries remain explicit", async () => {
  const skipped = await runTrial({
    ...fixtureInput(),
    task: {
      ...verifier,
      verify: () => ({ status: "skipped", reason: "unsupported fixture" }),
    },
  });
  const unavailable = await runTrial({
    ...fixtureInput(),
    task: {
      ...verifier,
      verify: () => ({ status: "unavailable", reason: "judge unavailable" }),
    },
  });
  const explodingHost: HostAdapter = {
    ref: trial.host,
    execute: async () => {
      throw new Error("adapter defect");
    },
    cleanup: async () => {},
  };
  const evaluatorFailure = await runTrial({ ...fixtureInput(), host: explodingHost });

  assert.deepEqual(
    [skipped.status, unavailable.status, evaluatorFailure.status],
    ["skipped", "unavailable", "evaluator_failure"],
  );
});

test("rejects adapters whose declared public references differ from the trial", async () => {
  let candidateWasCalled = false;
  const result = await runTrial({
    ...fixtureInput(),
    candidate: {
      ref: { ...trial.candidate, commit: "f".repeat(40) },
      run: async () => {
        candidateWasCalled = true;
        return { kind: "failure", message: "must not execute" };
      },
    },
  });

  assert.equal(result.status, "invalid");
  assert.equal(result.error?.code, "adapter_reference_mismatch");
  assert.equal(result.cleanup.status, "not_required");
  assert.equal(candidateWasCalled, false);
});

test("rejects malformed immutable trial provenance before adapter execution", async () => {
  let candidateWasCalled = false;
  const result = await runTrial({
    ...fixtureInput(),
    trial: {
      ...trial,
      evaluator: {
        ...trial.evaluator,
        configurationDigest: "sha256:not-a-digest",
      },
    },
    candidate: {
      ...createFakeCandidate(),
      run: async () => {
        candidateWasCalled = true;
        return { kind: "failure", message: "must not execute" };
      },
    },
  });

  assert.equal(result.status, "invalid");
  assert.equal(result.error?.code, "trial_provenance_invalid");
  assert.equal(result.cleanup.status, "not_required");
  assert.equal(candidateWasCalled, false);
});

test("rejects candidate repository query or hash before creating a receipt", async () => {
  for (const repository of [
    "https://github.com/openboa-ai/coffee-chat?token=receipt-secret",
    "https://github.com/openboa-ai/coffee-chat#receipt-secret",
  ]) {
    let candidateWasCalled = false;
    const candidateRef = { ...trial.candidate, repository };

    await assert.rejects(
      runTrial({
        ...fixtureInput(),
        trial: { ...trial, candidate: candidateRef },
        candidate: {
          ref: candidateRef,
          run: async () => {
            candidateWasCalled = true;
            return { kind: "failure", message: "must not execute" };
          },
        },
      }),
      /candidate repository provenance is invalid/u,
    );
    assert.equal(candidateWasCalled, false);
  }
});

test("CalVer accepts only calendar-valid four-digit unpadded dates", () => {
  for (const calver of ["2024.2.29", "2026.8.9", "9999.12.31"]) {
    assert.equal(
      validateTrialProvenance({
        ...trial,
        candidate: { ...trial.candidate, calver },
      }),
      true,
      `candidate ${calver}`,
    );
    assert.equal(
      validateTrialProvenance({
        ...trial,
        evaluator: { ...trial.evaluator, calver },
      }),
      true,
      `evaluator ${calver}`,
    );
  }

  for (const calver of [
    "26.8.9",
    "02026.8.9",
    "2026.08.9",
    "2026.8.09",
    "2026.13.1",
    "2026.4.31",
    "2025.2.29",
  ]) {
    assert.equal(
      validateTrialProvenance({
        ...trial,
        candidate: { ...trial.candidate, calver },
      }),
      false,
      `candidate ${calver}`,
    );
    assert.equal(
      validateTrialProvenance({
        ...trial,
        evaluator: { ...trial.evaluator, calver },
      }),
      false,
      `evaluator ${calver}`,
    );
  }
});

test("binds receipts to the allowlisted running evaluator and strips undeclared fields", async () => {
  let candidateWasCalled = false;
  const mismatched = await runTrial({
    ...fixtureInput(),
    trial: {
      ...trial,
      evaluator: {
        ...trial.evaluator,
        commit: "f".repeat(40),
      },
    },
    candidate: {
      ...createFakeCandidate(),
      run: async () => {
        candidateWasCalled = true;
        return { kind: "failure", message: "must not execute" };
      },
    },
  });

  assert.equal(mismatched.status, "invalid");
  assert.equal(mismatched.error?.code, "evaluator_reference_mismatch");
  assert.equal(candidateWasCalled, false);

  const result = await runTrial({
    ...fixtureInput(),
    trial: {
      ...trial,
      evaluator: {
        ...trial.evaluator,
        undeclaredSecret: "must-not-enter-receipt",
      } as typeof trial.evaluator,
    },
    runningEvaluator: {
      ...trial.evaluator,
      runtimeSecret: "must-not-enter-receipt",
    } as typeof trial.evaluator,
  });

  assert.deepEqual(Object.keys(result.evaluator).sort(), [
    "calver",
    "commit",
    "configurationDigest",
    "repository",
  ]);
  assert.deepEqual(result.evaluator, trial.evaluator);
  assert.doesNotMatch(JSON.stringify(result), /must-not-enter-receipt/u);
});

test("rejects a non-allowlisted running evaluator before host execution", async () => {
  let hostWasCalled = false;
  await assert.rejects(
    runTrial({
      ...fixtureInput(),
      runningEvaluator: {
        ...trial.evaluator,
        repository: "https://github.com/attacker/coffee-chat-eval",
      },
      host: {
        ...createFakeHost(),
        execute: async () => {
          hostWasCalled = true;
          return { kind: "host_failure", message: "must not execute" };
        },
      },
    }),
    /trusted evaluator provenance is invalid/u,
  );
  assert.equal(hostWasCalled, false);
});

test("evaluator CalVer is retained in trial and receipt digests", async () => {
  const first = await runTrial(fixtureInput());
  const nextEvaluator = { ...trial.evaluator, calver: "2026.8.10" };
  const second = await runTrial({
    ...fixtureInput(),
    runningEvaluator: nextEvaluator,
    trial: { ...trial, evaluator: nextEvaluator },
  });

  assert.equal(first.evaluator.calver, "2026.8.9");
  assert.equal(second.evaluator.calver, "2026.8.10");
  assert.notEqual(first.trialId, second.trialId);
  assert.notEqual(first.receiptDigest, second.receiptDigest);
});

test("stores only allowlisted receipt error codes and no adapter secret text", async () => {
  const results = await Promise.all([
    runTrial({
      ...fixtureInput(),
      host: {
        ...createFakeHost(),
        execute: async () => ({
          kind: "host_failure",
          message: "ghp_0123456789abcdefghijklmno0123456789AB",
        }),
      },
    }),
    runTrial({
      ...fixtureInput(),
      candidate: {
        ...createFakeCandidate(),
        run: async () => ({
          kind: "failure",
          message: "github_pat_11AA222BBB333CCC444DDD555EEE666FFF777GGG",
        }),
      },
    }),
    runTrial({
      ...fixtureInput(),
      task: {
        ...verifier,
        verify: () => {
          throw new Error("sk-proj-provider-like-secret-value");
        },
      },
    }),
    runTrial({
      ...fixtureInput(),
      host: {
        ...createFakeHost(),
        execute: async () => {
          throw new Error("Bearer provider-secret-token");
        },
      },
    }),
    runTrial({
      ...fixtureInput(),
      host: {
        ...createFakeHost({ evidence: "github_pat_evidence-secret" }),
        cleanup: async () => {
          throw new Error("token=cleanup-secret");
        },
      },
    }),
  ]);

  for (const receipt of results) {
    assert.doesNotMatch(
      JSON.stringify(receipt),
      /(?:ghp_|github_pat_|sk-proj-|provider-secret|cleanup-secret)/u,
    );
    assert.match(
      receipt.error?.code ?? "",
      /^(?:adapter|artifact|cleanup|host|candidate|verifier|evaluator|isolation|verification)_[a-z_]+$/u,
    );
  }
});

test("rejects supplied trial IDs and keeps the canonical snapshot stable against adapter mutation", async () => {
  const expectedId = createTrialIdentity(trial);
  const suppliedId = await runTrial({
    ...fixtureInput(),
    trial: { ...trial, id: "trial-attacker-controlled" },
  });
  assert.equal(suppliedId.status, "invalid");
  assert.equal(suppliedId.trialId, expectedId);
  assert.equal(suppliedId.cleanup.status, "not_required");

  const mutableTrial = structuredClone(trial);
  const result = await runTrial({
    ...fixtureInput(),
    trial: mutableTrial,
    host: {
      ref: trial.host,
      async execute({ trial: adapterTrial, candidate, workspaceId }) {
        assert.equal(Object.isFrozen(adapterTrial), true);
        assert.equal(Object.isFrozen(adapterTrial.candidate), true);
        assert.throws(() => {
          (adapterTrial.candidate as { commit: string }).commit = "f".repeat(40);
        });
        return {
          kind: "completed" as const,
          candidate: await candidate.run({ trial: adapterTrial, workspaceId }),
        };
      },
      async cleanup() {},
    },
  });
  assert.equal(result.trialId, expectedId);
  assert.equal(result.candidate.commit, trial.candidate.commit);
});

test("wall clock retains only ordered canonical UTC timestamps", async () => {
  const canonical = ["2026-08-09T00:00:00.000Z", "2026-08-09T00:00:01.000Z"];
  const valid = await runTrial({
    ...fixtureInput(),
    now: () => canonical.shift() ?? "2026-08-09T00:00:01.000Z",
  });
  assert.equal(valid.startedAt, "2026-08-09T00:00:00.000Z");
  assert.equal(valid.finishedAt, "2026-08-09T00:00:01.000Z");
  assert.equal(valid.status, "unmeasured");

  const scenarios: ReadonlyArray<{
    readonly name: string;
    readonly values: readonly (string | Error)[];
    readonly hostRuns: boolean;
  }> = [
    {
      name: "secret-bearing start",
      values: ["clock-secret=start"],
      hostRuns: false,
    },
    {
      name: "non-canonical offset",
      values: ["2026-08-09T09:00:00.000+09:00"],
      hostRuns: false,
    },
    {
      name: "impossible calendar date",
      values: ["2026-02-30T00:00:00.000Z"],
      hostRuns: false,
    },
    {
      name: "reversed pair",
      values: ["2026-08-09T00:00:02.000Z", "2026-08-09T00:00:01.000Z"],
      hostRuns: true,
    },
    {
      name: "secret-bearing finish",
      values: ["2026-08-09T00:00:00.000Z", "clock-secret=finish"],
      hostRuns: true,
    },
    {
      name: "throwing start",
      values: [new Error("clock-secret=throw")],
      hostRuns: false,
    },
  ];

  for (const scenario of scenarios) {
    let clockIndex = 0;
    let hostRan = false;
    const host = createFakeHost();
    const result = await runTrial({
      ...fixtureInput(),
      now: (() => {
        const value =
          scenario.values[clockIndex++] ?? scenario.values[scenario.values.length - 1];
        if (value instanceof Error) throw value;
        return value;
      }) as () => string,
      host: {
        ...host,
        async execute(input) {
          hostRan = true;
          return host.execute(input);
        },
      },
    });

    assert.equal(result.status, "evaluator_failure", scenario.name);
    assert.equal(result.error?.code, "evaluator_clock_invalid", scenario.name);
    assert.equal(Object.hasOwn(result, "startedAt"), false, scenario.name);
    assert.equal(Object.hasOwn(result, "finishedAt"), false, scenario.name);
    assert.equal(result.hostEvidence, undefined, scenario.name);
    assert.equal(result.artifact, undefined, scenario.name);
    assert.equal(result.metrics, undefined, scenario.name);
    assert.equal(hostRan, scenario.hostRuns, scenario.name);
    assert.equal(
      result.cleanup.status,
      scenario.hostRuns ? "completed" : "not_required",
      scenario.name,
    );
    assert.doesNotMatch(JSON.stringify(result), /clock-secret/u, scenario.name);
  }
});

test("binds a canonical artifact locator and explicit timing provenance without raw bytes", async () => {
  const invalidArtifact = await runTrial({
    ...fixtureInput(),
    candidate: {
      ref: trial.candidate,
      run: async () => ({
        kind: "success",
        artifact: { id: "artifact", digest: "sha256:not-the-value", value: "ok" },
      }),
    },
  });
  assert.equal(invalidArtifact.status, "invalid");

  const timestamps = ["2026-08-09T00:00:00.000Z", "2026-08-09T00:00:59.000Z"];
  const elapsed = [100, 125];
  const result = await runTrial({
    ...fixtureInput(),
    now: () => timestamps.shift() ?? "2026-08-09T00:00:59.000Z",
    timing: {
      ref: {
        id: "test-monotonic-clock",
        digest: "sha256:test-monotonic-clock",
        kind: "monotonic",
      },
      monotonicNowMs: () => elapsed.shift() ?? 125,
    } satisfies TimingProvider,
  });

  assert.equal(result.artifact?.digest, stableDigest("ok"));
  assert.equal(result.artifact?.locator, `artifact:${stableDigest("ok")}`);
  assert.equal(result.artifact?.byteSize, 2);
  assert.equal(JSON.stringify(result.artifact).includes("ok"), false);
  assert.deepEqual(result.timing, {
    provider: {
      id: "test-monotonic-clock",
      digest: "sha256:test-monotonic-clock",
      kind: "monotonic",
    },
    status: "measured",
    durationMs: 25,
  });
  const unavailableTiming = await runTrial({
    ...fixtureInput(),
    timing: {
      ref: {
        id: "broken-monotonic-clock",
        digest: "sha256:broken-monotonic-clock",
        kind: "monotonic",
      },
      monotonicNowMs: () => {
        throw new Error("provider-secret-time-error");
      },
    } satisfies TimingProvider,
  });
  assert.deepEqual(unavailableTiming.timing, {
    provider: {
      id: "broken-monotonic-clock",
      digest: "sha256:broken-monotonic-clock",
      kind: "monotonic",
    },
    status: "unmeasured",
  });
  assert.equal(Object.isFrozen(result.metrics), true);
  assert.throws(() => {
    (result.metrics as Record<string, number>).checks = 2;
  });
});

test("accepts a correctly digested empty artifact without inventing content", async () => {
  const result = await runTrial({
    ...fixtureInput(),
    candidate: {
      ref: trial.candidate,
      run: async () => ({
        kind: "success",
        artifact: { id: "empty-artifact", digest: stableDigest(""), value: "" },
      }),
    },
    task: {
      ...verifier,
      verify: (artifact) => ({
        status: "valid",
        metrics: { empty: artifact.value === "" ? 1 : 0 },
      }),
    },
  });

  assert.equal(result.status, "unmeasured");
  assert.deepEqual(result.metrics, { empty: 1 });
  assert.deepEqual(result.artifact, {
    locator: `artifact:${stableDigest("")}`,
    digest: stableDigest(""),
    byteSize: 0,
  });
});
