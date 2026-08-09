import assert from "node:assert/strict";
import test from "node:test";

import { createFakeCandidate } from "../src/adapters/fake-candidate.ts";
import { createFakeHost } from "../src/hosts/fake-host.ts";
import { createTrialIdentity, stableDigest } from "../src/identity.ts";
import { runTrial, type RunTrialInput } from "../src/runner.ts";
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

function fixtureInput(): RunTrialInput {
  return {
    trial,
    runningEvaluator: trial.evaluator,
    candidate: createFakeCandidate(),
    host: createFakeHost(),
    task: verifier,
    inspectHostEvidence: ({ trial: adapterTrial, trialId, artifact, evidence }) =>
      isolationAttestation({
        locator: evidence.reference,
        evidenceDigest: evidence.digest,
        trialId,
        artifactDigest: artifact.digest,
        hostId: adapterTrial.host.id,
        hostConfigurationDigest: adapterTrial.host.configurationDigest,
      }),
    persistArtifact: ({ trial: adapterTrial, trialId, artifact }) => {
      const locator =
        adapterTrial.host.isolationClass === "isolated"
          ? `https://artifacts.example/runs/${trialId}/artifacts/${artifact.digest.slice("sha256:".length)}`
          : `fixture://workspace-${trialId}/artifacts/${artifact.digest.slice("sha256:".length)}`;
      return persistenceAttestation({
        locator,
        trialId,
        artifactDigest: artifact.digest,
      });
    },
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

function persistenceAttestation(binding: {
  readonly locator: string;
  readonly trialId: string;
  readonly artifactDigest: `sha256:${string}`;
}) {
  return { ...binding, digest: stableDigest(binding) };
}

function isolationAttestation(binding: {
  readonly locator: string;
  readonly evidenceDigest: `sha256:${string}`;
  readonly trialId: string;
  readonly artifactDigest: `sha256:${string}`;
  readonly hostId: string;
  readonly hostConfigurationDigest: `sha256:${string}`;
}) {
  return { ...binding, digest: stableDigest(binding) };
}

test("isolated measurement requires evaluator-owned persistence and isolation attestations", async () => {
  const isolated = isolatedTrial();
  const trialId = createTrialIdentity(isolated);
  const artifactDigest = stableDigest("ok");
  const evidence = boundIsolationEvidence({
    reference:
      "https://evidence.example/runs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    detail: "inspectable isolation evidence",
    trialId,
    artifactDigest,
  });
  const locator =
    `https://artifacts.example/runs/${trialId}/artifacts/` +
    artifactDigest.slice("sha256:".length);
  let verifierCalls = 0;

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
    inspectHostEvidence: async () =>
      isolationAttestation({
        locator: evidence.reference,
        evidenceDigest: evidence.digest,
        trialId,
        artifactDigest,
        hostId: isolated.host.id,
        hostConfigurationDigest: isolated.host.configurationDigest,
      }),
    persistArtifact: async () =>
      persistenceAttestation({ locator, trialId, artifactDigest }),
    task: {
      ...verifier,
      verify: (artifact) => {
        verifierCalls += 1;
        return verifier.verify(artifact);
      },
    },
  });

  assert.equal(result.status, "measured");
  assert.equal(verifierCalls, 1);
  assert.equal(result.artifact?.locator, locator);
  assert.equal(result.artifact?.trialId, trialId);
  assert.equal(
    result.artifact?.persistenceDigest,
    stableDigest({ locator, trialId, artifactDigest }),
  );
  assert.equal(result.hostEvidence?.hostId, isolated.host.id);
  assert.equal(
    result.hostEvidence?.hostConfigurationDigest,
    isolated.host.configurationDigest,
  );
});

test("host self-consistency and string-only persistence cannot produce measured credit", async () => {
  const isolated = isolatedTrial();
  const trialId = createTrialIdentity(isolated);
  const artifactDigest = stableDigest("ok");
  const evidence = boundIsolationEvidence({
    reference:
      "https://localhost/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    detail: "host-authored evidence",
    trialId,
    artifactDigest,
  });
  let persistenceCalls = 0;
  let verifierCalls = 0;
  const host: HostAdapter = {
    ref: isolated.host,
    async execute({ trial: adapterTrial, candidate, workspaceId }) {
      return {
        kind: "completed" as const,
        evidence,
        candidate: await candidate.run({ trial: adapterTrial, workspaceId }),
      };
    },
    async cleanup() {},
  };

  const uninspected = await runTrial({
    ...fixtureInput(),
    trial: isolated,
    host,
    inspectHostEvidence: async () => undefined,
    persistArtifact: async () => {
      persistenceCalls += 1;
      return persistenceAttestation({
        locator:
          "https://artifacts.example/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        trialId,
        artifactDigest,
      });
    },
    task: {
      ...verifier,
      verify: (artifact) => {
        verifierCalls += 1;
        return verifier.verify(artifact);
      },
    },
  });
  assert.equal(uninspected.status, "unavailable");
  assert.equal(uninspected.error?.code, "isolation_evidence_invalid");
  assert.equal(persistenceCalls, 0);
  assert.equal(verifierCalls, 0);

  const stringOnly = await runTrial({
    ...fixtureInput(),
    trial: isolated,
    host,
    inspectHostEvidence: async () =>
      isolationAttestation({
        locator: evidence.reference,
        evidenceDigest: evidence.digest,
        trialId,
        artifactDigest,
        hostId: isolated.host.id,
        hostConfigurationDigest: isolated.host.configurationDigest,
      }),
    persistArtifact: async () => {
      persistenceCalls += 1;
      return "https://artifacts.example/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    },
    task: {
      ...verifier,
      verify: (artifact) => {
        verifierCalls += 1;
        return verifier.verify(artifact);
      },
    },
  });
  assert.equal(stringOnly.status, "unavailable");
  assert.equal(stringOnly.error?.code, "artifact_locator_invalid");
  assert.equal(persistenceCalls, 1);
  assert.equal(verifierCalls, 0);
});

test("host execution accepts only closed declared result envelopes", async () => {
  const artifact = { id: "artifact", digest: stableDigest("ok"), value: "ok" };
  const scenarios: ReadonlyArray<{
    readonly name: string;
    readonly execution: unknown;
  }> = [
    {
      name: "unknown host discriminant",
      execution: { kind: "unexpected", candidate: { kind: "success", artifact } },
    },
    {
      name: "unknown candidate discriminant",
      execution: { kind: "completed", candidate: { kind: "unexpected", artifact } },
    },
    {
      name: "legacy host artifact locator",
      execution: {
        kind: "completed",
        artifactLocator:
          "https://localhost/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        candidate: { kind: "success", artifact },
      },
    },
    {
      name: "extra host failure field",
      execution: { kind: "host_failure", message: "failed", legacy: true },
    },
    {
      name: "extra candidate failure field",
      execution: {
        kind: "completed",
        candidate: { kind: "failure", message: "failed", legacy: true },
      },
    },
  ];

  for (const scenario of scenarios) {
    let persistenceCalls = 0;
    let verifierCalls = 0;
    const result = await runTrial({
      ...fixtureInput(),
      host: {
        ref: trial.host,
        execute: async () => scenario.execution as never,
        cleanup: async () => {},
      },
      persistArtifact: async () => {
        persistenceCalls += 1;
        return "fixture://must-not-persist";
      },
      task: {
        ...verifier,
        verify: (candidateArtifact) => {
          verifierCalls += 1;
          return verifier.verify(candidateArtifact);
        },
      },
    });

    assert.equal(result.status, "evaluator_failure", scenario.name);
    assert.equal(result.error?.code, "evaluator_execution_failed", scenario.name);
    assert.equal(persistenceCalls, 0, scenario.name);
    assert.equal(verifierCalls, 0, scenario.name);
  }
});

test("adapter boundary descriptors cannot change measured bytes or bindings", async () => {
  const isolated = isolatedTrial();
  const trialId = createTrialIdentity(isolated);
  const artifactDigest = stableDigest("ok");
  const evidence = boundIsolationEvidence({
    reference:
      "https://evidence.example/runs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    detail: "inspectable isolation evidence",
    trialId,
    artifactDigest,
  });
  const locator =
    `https://artifacts.example/runs/${trialId}/artifacts/` +
    artifactDigest.slice("sha256:".length);
  const artifact = { id: "artifact", digest: artifactDigest, value: "ok" };
  const validExecution = (candidateArtifact: unknown = artifact) => ({
    kind: "completed",
    evidence,
    candidate: { kind: "success", artifact: candidateArtifact },
  });
  const changingProperty = (
    record: object,
    key: string,
    values: readonly unknown[],
  ) => {
    let index = 0;
    Object.defineProperty(record, key, {
      enumerable: true,
      get() {
        const value = values[Math.min(index, values.length - 1)];
        index += 1;
        return value;
      },
    });
  };
  const validInspector: RunTrialInput["inspectHostEvidence"] = () =>
    isolationAttestation({
      locator: evidence.reference,
      evidenceDigest: evidence.digest,
      trialId,
      artifactDigest,
      hostId: isolated.host.id,
      hostConfigurationDigest: isolated.host.configurationDigest,
    });
  const validPersistence: RunTrialInput["persistArtifact"] = () =>
    persistenceAttestation({ locator, trialId, artifactDigest });
  const scenarios: ReadonlyArray<{
    readonly name: string;
    readonly execution: () => unknown;
    readonly inspect?: RunTrialInput["inspectHostEvidence"];
    readonly persist?: RunTrialInput["persistArtifact"];
    readonly expectedStatus: "evaluator_failure" | "invalid" | "unavailable";
    readonly expectedError:
      | "evaluator_execution_failed"
      | "artifact_digest_invalid"
      | "isolation_evidence_invalid"
      | "artifact_locator_invalid";
    readonly expectedPersistenceCalls: number;
  }> = [
    {
      name: "stateful host and candidate discriminants",
      execution: () => {
        const candidate = { artifact };
        changingProperty(candidate, "kind", ["unexpected", "success"]);
        const execution = { evidence, candidate };
        changingProperty(execution, "kind", ["unexpected", "completed"]);
        return execution;
      },
      expectedStatus: "evaluator_failure",
      expectedError: "evaluator_execution_failed",
      expectedPersistenceCalls: 0,
    },
    {
      name: "symbol and non-enumerable envelope extras",
      execution: () => {
        const candidate = { kind: "success", artifact };
        Object.defineProperty(candidate, "legacy", {
          enumerable: false,
          value: true,
        });
        return Object.assign(validExecution(candidate.artifact), {
          [Symbol("legacy")]: true,
          candidate,
        });
      },
      expectedStatus: "evaluator_failure",
      expectedError: "evaluator_execution_failed",
      expectedPersistenceCalls: 0,
    },
    {
      name: "throwing proxy descriptor trap",
      execution: () =>
        new Proxy(validExecution(), {
          getOwnPropertyDescriptor() {
            throw new Error("descriptor-secret");
          },
        }),
      expectedStatus: "evaluator_failure",
      expectedError: "evaluator_execution_failed",
      expectedPersistenceCalls: 0,
    },
    {
      name: "invalid proxy descriptor trap",
      execution: () =>
        new Proxy(validExecution(), {
          getOwnPropertyDescriptor(target, key) {
            if (key === "kind") {
              return {
                configurable: true,
                enumerable: true,
                get: "not-a-function",
              } as never;
            }
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        }),
      expectedStatus: "evaluator_failure",
      expectedError: "evaluator_execution_failed",
      expectedPersistenceCalls: 0,
    },
    {
      name: "artifact bytes change after digest validation",
      execution: () => {
        const changingArtifact = { id: "artifact", digest: artifactDigest };
        changingProperty(changingArtifact, "value", [
          "ok",
          "ok",
          "mutated-after-validation",
        ]);
        return validExecution(changingArtifact);
      },
      expectedStatus: "invalid",
      expectedError: "artifact_digest_invalid",
      expectedPersistenceCalls: 0,
    },
    {
      name: "host evidence binding changes after comparison",
      execution: () => {
        const unrelatedEvidence = {
          reference: evidence.reference,
          detail: evidence.detail,
          trialId: "trial-unrelated",
          artifactDigest,
        };
        const changingEvidence = {
          ...unrelatedEvidence,
          digest: stableDigest(unrelatedEvidence),
        };
        changingProperty(changingEvidence, "trialId", [trialId, "trial-unrelated"]);
        return {
          kind: "completed",
          evidence: changingEvidence,
          candidate: { kind: "success", artifact },
        };
      },
      inspect: ({ evidence: acceptedEvidence }) =>
        isolationAttestation({
          locator: acceptedEvidence.reference,
          evidenceDigest: acceptedEvidence.digest,
          trialId,
          artifactDigest,
          hostId: isolated.host.id,
          hostConfigurationDigest: isolated.host.configurationDigest,
        }),
      expectedStatus: "unavailable",
      expectedError: "isolation_evidence_invalid",
      expectedPersistenceCalls: 0,
    },
    {
      name: "isolation binding changes after comparison",
      execution: () => validExecution(),
      inspect: () => {
        const unrelatedBinding = {
          locator: evidence.reference,
          evidenceDigest: evidence.digest,
          trialId: "trial-unrelated",
          artifactDigest,
          hostId: "unrelated-host",
          hostConfigurationDigest: isolated.host.configurationDigest,
        };
        const attestation = {
          ...unrelatedBinding,
          digest: stableDigest(unrelatedBinding),
        };
        changingProperty(attestation, "trialId", [trialId, "trial-unrelated"]);
        changingProperty(attestation, "hostId", [isolated.host.id, "unrelated-host"]);
        return attestation;
      },
      expectedStatus: "unavailable",
      expectedError: "isolation_evidence_invalid",
      expectedPersistenceCalls: 0,
    },
    {
      name: "persistence binding changes after comparison",
      execution: () => validExecution(),
      persist: () => {
        const unrelatedBinding = {
          locator,
          trialId: "trial-unrelated",
          artifactDigest,
        };
        const attestation = {
          ...unrelatedBinding,
          digest: stableDigest(unrelatedBinding),
        };
        changingProperty(attestation, "trialId", [trialId, "trial-unrelated"]);
        return attestation;
      },
      expectedStatus: "unavailable",
      expectedError: "artifact_locator_invalid",
      expectedPersistenceCalls: 1,
    },
  ];
  const observations = [];

  for (const scenario of scenarios) {
    let persistenceCalls = 0;
    const verifierValues: string[] = [];
    const result = await runTrial({
      ...fixtureInput(),
      trial: isolated,
      host: {
        ref: isolated.host,
        execute: async () => scenario.execution() as never,
        cleanup: async () => {},
      },
      inspectHostEvidence: scenario.inspect ?? validInspector,
      persistArtifact: async (input) => {
        persistenceCalls += 1;
        return (scenario.persist ?? validPersistence)(input);
      },
      task: {
        ...verifier,
        verify: (verifiedArtifact) => {
          verifierValues.push(verifiedArtifact.value);
          return { status: "valid", metrics: { checks: 1 } };
        },
      },
    });
    const verifierValue = verifierValues[0];
    const measuredBindingMismatch =
      result.status === "measured" &&
      ((verifierValue !== undefined &&
        result.artifact?.digest !== stableDigest(verifierValue)) ||
        result.artifact?.trialId !== trialId ||
        result.hostEvidence?.trialId !== trialId ||
        result.hostEvidence?.artifactDigest !== artifactDigest ||
        result.hostEvidence?.hostId !== isolated.host.id ||
        result.hostEvidence?.hostConfigurationDigest !==
          isolated.host.configurationDigest);
    observations.push({
      name: scenario.name,
      status: result.status,
      error: result.error?.code,
      persistenceCalls,
      verifierValues,
      measuredBindingMismatch,
    });
  }

  assert.deepEqual(
    observations,
    scenarios.map((scenario) => ({
      name: scenario.name,
      status: scenario.expectedStatus,
      error: scenario.expectedError,
      persistenceCalls: scenario.expectedPersistenceCalls,
      verifierValues: [],
      measuredBindingMismatch: false,
    })),
  );
});

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
    evidenceDigest: stableDigest({ reference, detail, trialId, artifactDigest }),
    trialId,
    artifactDigest,
    hostId: trial.host.id,
    hostConfigurationDigest: trial.host.configurationDigest,
    digest: stableDigest({
      locator: reference,
      evidenceDigest: stableDigest({ reference, detail, trialId, artifactDigest }),
      trialId,
      artifactDigest,
      hostId: trial.host.id,
      hostConfigurationDigest: trial.host.configurationDigest,
    }),
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
  const evaluatorLocator =
    `https://artifacts.example/runs/${canonicalTrialId}/artifacts/` +
    artifactDigest.slice("sha256:".length);
  const measured = await runTrial({
    ...fixtureInput(),
    trial: isolated,
    persistArtifact: async () =>
      persistenceAttestation({
        locator: evaluatorLocator,
        trialId: canonicalTrialId,
        artifactDigest,
      }),
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
    evidenceDigest: evidence.digest,
    trialId: canonicalTrialId,
    artifactDigest,
    hostId: isolated.host.id,
    hostConfigurationDigest: isolated.host.configurationDigest,
    digest: stableDigest({
      locator: evidenceReference,
      evidenceDigest: evidence.digest,
      trialId: canonicalTrialId,
      artifactDigest,
      hostId: isolated.host.id,
      hostConfigurationDigest: isolated.host.configurationDigest,
    }),
  });
  assert.equal(measured.artifact?.locator, evaluatorLocator);
});

test("invalid candidate artifacts are classified before isolation evidence", async () => {
  const isolated = isolatedTrial();
  const result = await runTrial({
    ...fixtureInput(),
    trial: isolated,
    candidate: createFakeCandidate({ artifact: undefined }),
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

  assert.equal(result.status, "invalid");
  assert.equal(result.error?.code, "artifact_digest_invalid");
  assert.equal(result.hostEvidence, undefined);
  assert.equal(result.metrics, undefined);
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

test("isolated evidence must bind an immutable reference and exact evidence bytes", async () => {
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

test("representative malformed trial fields share one redacted side-effect-free receipt", async () => {
  const secret = "malformed-secret-must-not-enter-receipt";
  const cyclic = { secret } as { secret: string; self?: unknown };
  cyclic.self = cyclic;
  const throwingEvaluator = Object.defineProperty({}, "repository", {
    enumerable: true,
    get() {
      throw new Error(secret);
    },
  });
  const throwingHost = new Proxy(trial.host, {
    get() {
      throw new Error(secret);
    },
  });
  const scenarios: ReadonlyArray<{
    readonly name: string;
    readonly malformedTrial: unknown;
  }> = [
    { name: "top-level id BigInt", malformedTrial: { ...trial, id: 1n } },
    {
      name: "evaluator getter",
      malformedTrial: { ...trial, evaluator: throwingEvaluator },
    },
    {
      name: "candidate non-plain object",
      malformedTrial: { ...trial, candidate: new Date(0) },
    },
    {
      name: "task BigInt",
      malformedTrial: { ...trial, task: { ...trial.task, id: 1n, secret } },
    },
    {
      name: "harness cycle",
      malformedTrial: { ...trial, harness: { ...trial.harness, id: cyclic } },
    },
    {
      name: "model symbol",
      malformedTrial: { ...trial, model: { ...trial.model, id: Symbol(secret) } },
    },
    { name: "host proxy", malformedTrial: { ...trial, host: throwingHost } },
    {
      name: "repetition function",
      malformedTrial: { ...trial, repetition: () => secret },
    },
  ];
  let fixedReceiptDigest: string | undefined;

  for (const scenario of scenarios) {
    let hostCalls = 0;
    let persistenceCalls = 0;
    let verifierCalls = 0;
    const host = createFakeHost();
    const result = await runTrial({
      ...fixtureInput(),
      trial: scenario.malformedTrial as TrialSpec,
      host: {
        ...host,
        async execute(input) {
          hostCalls += 1;
          return host.execute(input);
        },
      },
      persistArtifact: () => {
        persistenceCalls += 1;
        return undefined;
      },
      task: {
        ...verifier,
        verify: (artifact) => {
          verifierCalls += 1;
          return verifier.verify(artifact);
        },
      },
    });

    fixedReceiptDigest ??= result.receiptDigest;
    assert.equal(result.receiptDigest, fixedReceiptDigest, scenario.name);
    assert.equal(result.status, "invalid", scenario.name);
    assert.equal(result.error?.code, "trial_provenance_invalid", scenario.name);
    assert.equal(result.cleanup.status, "not_required", scenario.name);
    assert.equal(result.performanceClaim, false, scenario.name);
    assert.deepEqual(
      {
        candidate: result.candidate,
        task: result.task,
        harness: result.harness,
        model: result.model,
        host: result.host,
        repetition: result.repetition,
        evidenceClass: result.evidenceClass,
      },
      {
        candidate: null,
        task: null,
        harness: null,
        model: null,
        host: null,
        repetition: null,
        evidenceClass: null,
      },
      scenario.name,
    );
    assert.equal(hostCalls, 0, scenario.name);
    assert.equal(persistenceCalls, 0, scenario.name);
    assert.equal(verifierCalls, 0, scenario.name);
    assert.doesNotMatch(JSON.stringify(result), /malformed-secret/u, scenario.name);
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

test("verifier result descriptors cannot manufacture measured metrics", async () => {
  const isolated = isolatedTrial();
  const trialId = createTrialIdentity(isolated);
  const artifactDigest = stableDigest("ok");
  const evidence = boundIsolationEvidence({
    reference:
      "https://evidence.example/runs/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    detail: "inspectable isolation evidence",
    trialId,
    artifactDigest,
  });
  const host: HostAdapter = {
    ref: isolated.host,
    async execute({ trial: adapterTrial, candidate, workspaceId }) {
      return {
        kind: "completed" as const,
        evidence,
        candidate: await candidate.run({ trial: adapterTrial, workspaceId }),
      };
    },
    async cleanup() {},
  };

  const changingStatus: Record<string, unknown> = { reason: "not measured" };
  let statusReads = 0;
  Object.defineProperty(changingStatus, "status", {
    enumerable: true,
    get() {
      statusReads += 1;
      return statusReads === 6 ? "valid" : "unmeasured";
    },
  });

  const accessorMetrics: Record<string, unknown> = {};
  Object.defineProperty(accessorMetrics, "score", {
    enumerable: true,
    get: () => 1,
  });

  const nonEnumerableEnvelope = { status: "valid", metrics: { score: 1 } };
  Object.defineProperty(nonEnumerableEnvelope, "undeclared", {
    enumerable: false,
    value: "secret",
  });
  const nonEnumerableMetrics = { score: 1 };
  Object.defineProperty(nonEnumerableMetrics, "undeclared", {
    enumerable: false,
    value: 2,
  });
  const prototypeSetterMetrics = { score: 1 };
  Object.defineProperty(prototypeSetterMetrics, "__proto__", {
    enumerable: true,
    value: {
      toJSON: () => ({ forged_credit: 1 }),
    },
  });

  const scenarios: readonly {
    readonly name: string;
    readonly verification: unknown;
    readonly error: "verification_result_invalid" | "verification_metrics_invalid";
  }[] = [
    {
      name: "stateful status accessor",
      verification: changingStatus,
      error: "verification_result_invalid",
    },
    {
      name: "symbol verifier field",
      verification: {
        status: "valid",
        metrics: { score: 1 },
        [Symbol("undeclared")]: "secret",
      },
      error: "verification_result_invalid",
    },
    {
      name: "non-enumerable verifier field",
      verification: nonEnumerableEnvelope,
      error: "verification_result_invalid",
    },
    {
      name: "throwing verifier key trap",
      verification: new Proxy(
        { status: "valid", metrics: { score: 1 } },
        {
          ownKeys() {
            throw new Error("malformed verifier keys");
          },
        },
      ),
      error: "verification_result_invalid",
    },
    {
      name: "accessor metric",
      verification: { status: "valid", metrics: accessorMetrics },
      error: "verification_metrics_invalid",
    },
    {
      name: "symbol metric",
      verification: {
        status: "valid",
        metrics: { score: 1, [Symbol("undeclared")]: 2 },
      },
      error: "verification_metrics_invalid",
    },
    {
      name: "non-enumerable metric",
      verification: { status: "valid", metrics: nonEnumerableMetrics },
      error: "verification_metrics_invalid",
    },
    {
      name: "prototype-setter metric",
      verification: { status: "valid", metrics: prototypeSetterMetrics },
      error: "verification_metrics_invalid",
    },
  ];

  for (const scenario of scenarios) {
    const result = await runTrial({
      ...fixtureInput(),
      trial: isolated,
      host,
      task: {
        ...verifier,
        verify: () => scenario.verification as ReturnType<TaskAdapter["verify"]>,
      },
    });

    assert.equal(result.status, "verifier_failure", scenario.name);
    assert.equal(result.error?.code, scenario.error, scenario.name);
    assert.equal(result.metrics, undefined, scenario.name);
    assert.equal(result.performanceClaim, false, scenario.name);
    assert.doesNotMatch(JSON.stringify(result), /secret/u, scenario.name);
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
  const hostFailure = await runTrial({ ...fixtureInput(), host: explodingHost });

  assert.deepEqual(
    [skipped.status, unavailable.status, hostFailure.status],
    ["skipped", "unavailable", "host_failure"],
  );
  assert.equal(hostFailure.error?.code, "host_execution_failed");
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

test("redacts invalid candidate repository provenance into a fixed receipt", async () => {
  for (const repository of [
    "https://github.com/openboa-ai/coffee-chat?token=receipt-secret",
    "https://github.com/openboa-ai/coffee-chat#receipt-secret",
  ]) {
    let candidateWasCalled = false;
    const candidateRef = { ...trial.candidate, repository };

    const result = await runTrial({
      ...fixtureInput(),
      trial: { ...trial, candidate: candidateRef },
      candidate: {
        ref: candidateRef,
        run: async () => {
          candidateWasCalled = true;
          return { kind: "failure", message: "must not execute" };
        },
      },
    });
    assert.equal(result.status, "invalid");
    assert.equal(result.error?.code, "trial_provenance_invalid");
    assert.equal(result.candidate, null);
    assert.equal(result.task, null);
    assert.equal(result.host, null);
    assert.doesNotMatch(JSON.stringify(result), /receipt-secret/u);
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
  assert.equal(mismatched.candidate, null);
  assert.equal(mismatched.task, null);
  assert.equal(mismatched.host, null);
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
  assert.notEqual(suppliedId.trialId, expectedId);
  assert.equal(suppliedId.candidate, null);
  assert.equal(suppliedId.task, null);
  assert.equal(suppliedId.host, null);
  assert.equal(suppliedId.repetition, null);
  assert.equal(suppliedId.evidenceClass, null);
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
  assert.ok(result.candidate);
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

test("binds an evaluator-persisted artifact locator and timing without raw bytes", async () => {
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
  assert.equal(
    result.artifact?.locator,
    `fixture://workspace-${createTrialIdentity(trial)}/artifacts/${stableDigest("ok").slice("sha256:".length)}`,
  );
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

  const overflowingElapsed = [-Number.MAX_VALUE, Number.MAX_VALUE];
  const overflowingTiming = await runTrial({
    ...fixtureInput(),
    timing: {
      ref: {
        id: "overflowing-monotonic-clock",
        digest: "sha256:overflowing-monotonic-clock",
        kind: "monotonic",
      },
      monotonicNowMs: () => overflowingElapsed.shift() ?? Number.MAX_VALUE,
    } satisfies TimingProvider,
  });
  assert.deepEqual(overflowingTiming.timing, {
    provider: {
      id: "overflowing-monotonic-clock",
      digest: "sha256:overflowing-monotonic-clock",
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
    locator: `fixture://workspace-${createTrialIdentity(trial)}/artifacts/${stableDigest("").slice("sha256:".length)}`,
    digest: stableDigest(""),
    byteSize: 0,
    trialId: createTrialIdentity(trial),
    persistenceDigest: stableDigest({
      locator: `fixture://workspace-${createTrialIdentity(trial)}/artifacts/${stableDigest("").slice("sha256:".length)}`,
      trialId: createTrialIdentity(trial),
      artifactDigest: stableDigest(""),
    }),
  });
});
