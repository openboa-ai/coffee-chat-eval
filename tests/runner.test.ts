import assert from "node:assert/strict";
import test from "node:test";

import { createFakeCandidate } from "../src/adapters/fake-candidate.ts";
import { createFakeHost } from "../src/hosts/fake-host.ts";
import { createTrialIdentity, stableDigest } from "../src/identity.ts";
import { runTrial } from "../src/runner.ts";
import type {
  HostAdapter,
  TaskAdapter,
  TimingProvider,
  TrialSpec,
} from "../src/types.ts";

const trial: TrialSpec = {
  candidate: {
    repository: "https://github.com/openboa-ai/coffee-chat",
    commit: "0123456789abcdef0123456789abcdef01234567",
    calver: "2026.8.9",
    adapter: "fake-candidate",
  },
  task: { id: "fixture-task", digest: "sha256:task" },
  harness: { id: "fixture-harness", digest: "sha256:harness" },
  model: { id: "fixture-model", digest: "sha256:model" },
  host: { id: "fixture-host", isolationClass: "fixture" },
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
    candidate: createFakeCandidate(),
    host: createFakeHost(),
    task: verifier,
    now: () => "2026-08-09T00:00:00.000Z",
    timing: unmeasuredTiming(),
  };
}

test("fixture trial stores content-addressed host evidence without performance credit", async () => {
  const result = await runTrial({
    ...fixtureInput(),
    host: createFakeHost({ evidence: "token=keep-this-secret" }),
  });

  assert.equal(result.status, "unmeasured");
  assert.equal(result.evidenceClass, "fixture");
  assert.equal(result.cleanup.status, "completed");
  assert.equal(
    result.hostEvidence?.locator,
    `evidence:${stableDigest({
      reference: `fixture://workspace-${createTrialIdentity(trial)}`,
      detail: "token=keep-this-secret",
    })}`,
  );
  assert.equal(JSON.stringify(result).includes("keep-this-secret"), false);
  assert.equal(result.timing.status, "unmeasured");
  assert.equal(result.performanceClaim, false);
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
