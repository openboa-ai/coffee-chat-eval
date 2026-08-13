import type { ParsedHarborResult } from "./harbor.ts";
import {
  traceExecCommand,
  traceObservationJson,
  validateCodexTraceEvidence,
} from "./protocol-canary.ts";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CASE_KEY = 1001 as const;
const SOURCE_DIGEST =
  "sha256:d5ef5259a025140861c13b78b2be73479893b29d3cd1ed12cfda9446427d0396" as const;
const SOURCE_MANIFEST_DIGEST =
  "sha256:b7a02386bc8304e3338030fe4f4d97fb19a6ff1948f57d833482a199c2dab741" as const;

export interface ValidatedIFEvalTrace {
  readonly benchmarkInputRead: "verified";
  readonly candidateInputDelivery: "not_supported";
  readonly publicEntrypointInvocation: "verified";
  readonly capabilityStatus: "not_implemented";
}

export interface ValidatedIFEvalArtifact {
  readonly resultArtifact: "verified";
  readonly resultState: "not_implemented";
}

export interface BenchmarkExecutionReceiptInput {
  readonly evaluatorCommit: string;
  readonly candidateCommit: string;
  readonly pluginVersion: string;
  readonly installedPluginDigest: string;
  readonly model: string;
  readonly harborResult: ParsedHarborResult;
  readonly traceEvidence: ValidatedIFEvalTrace;
  readonly artifactEvidence: ValidatedIFEvalArtifact;
  readonly sourceManifestDigest: string;
  readonly harborResultPath: string;
  readonly codexTracePath: string;
  readonly cleanup: "verified";
  readonly hostEvidence: {
    readonly harborLockPath: string;
    readonly harborLockDigest: string;
    readonly taskImageDefinitionDigest: string;
    readonly verifierImageDefinitionDigest: string;
  };
}

export interface BenchmarkExecutionReceipt {
  readonly schema: "coffee-chat-eval/benchmark-execution";
  readonly calver: "2026.8.12";
  readonly executionStatus: "executed";
  readonly resultState: "not_implemented";
  readonly measurement: "not_performed";
  readonly benchmark: {
    readonly name: "IFEval";
    readonly caseKey: typeof CASE_KEY;
    readonly sourceDigest: typeof SOURCE_DIGEST;
    readonly sourceManifestDigest: string;
  };
  readonly evaluatorCommit: string;
  readonly candidateCommit: string;
  readonly pluginVersion: string;
  readonly installedPluginDigest: string;
  readonly backend: "harbor";
  readonly harness: "codex";
  readonly model: string;
  readonly nativeTrialId: string;
  readonly nativeTrialName: string;
  readonly nativeHarborReward: number;
  readonly benchmarkInputRead: "verified";
  readonly candidateInputDelivery: "not_supported";
  readonly publicEntrypointInvocation: "verified";
  readonly resultArtifact: "verified";
  readonly harborResultPath: string;
  readonly codexTracePath: string;
  readonly cleanup: "verified";
  readonly hostEvidence: BenchmarkExecutionReceiptInput["hostEvidence"];
  readonly interpretation: "execution-only; no Coffee Chat performance claim";
}

export function validateIFEvalTraceEvidence(trace: unknown): ValidatedIFEvalTrace {
  const pluginTrace = validateCodexTraceEvidence(trace);
  const root = record(trace);
  const steps = Array.isArray(root?.steps) ? root.steps.map(record) : [];
  const readInput = steps.some((step) => {
    if (step?.source !== "agent" || !Array.isArray(step.tool_calls)) return false;
    const called = step.tool_calls.map(record).some((call) => {
      const args = record(call?.arguments);
      const command = traceExecCommand(args?.input);
      return (
        call?.function_name === "exec" &&
        command?.cmd === "cat /app/ifeval-case.json" &&
        command.workdir === "/app"
      );
    });
    if (!called) return false;
    const observation = traceObservationJson(step.observation);
    return (
      observation !== undefined &&
      Object.keys(observation).sort().join(",") ===
        "benchmark,key,prompt,source_digest" &&
      observation.benchmark === "IFEval" &&
      observation.key === CASE_KEY &&
      typeof observation.prompt === "string" &&
      observation.source_digest === SOURCE_DIGEST
    );
  });
  if (!readInput) {
    throw new Error("Codex trace lacks the pinned IFEval input evidence");
  }
  return Object.freeze({
    benchmarkInputRead: "verified",
    candidateInputDelivery: "not_supported",
    publicEntrypointInvocation: pluginTrace.publicEntrypointInvocation,
    capabilityStatus: pluginTrace.capabilityStatus,
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function validateIFEvalResultArtifact(
  artifact: unknown,
): ValidatedIFEvalArtifact {
  const value = record(artifact);
  if (
    value === undefined ||
    Object.keys(value).sort().join(",") !==
      "benchmark,key,response,source_digest,status" ||
    value?.benchmark !== "IFEval" ||
    value.key !== CASE_KEY ||
    value.source_digest !== SOURCE_DIGEST ||
    value.status !== "not_implemented" ||
    value.response !== ""
  ) {
    throw new Error("collected IFEval result artifact is invalid");
  }
  return Object.freeze({
    resultArtifact: "verified",
    resultState: "not_implemented",
  });
}

export function createBenchmarkExecutionReceipt(
  input: BenchmarkExecutionReceiptInput,
): BenchmarkExecutionReceipt {
  if (input.harborResult.resultState !== "unmeasured") {
    throw new Error("a failed Harbor trial cannot prove benchmark execution");
  }
  if (
    !COMMIT_PATTERN.test(input.evaluatorCommit) ||
    !COMMIT_PATTERN.test(input.candidateCommit)
  ) {
    throw new Error("benchmark receipt commits must be full lowercase Git commits");
  }
  if (input.sourceManifestDigest !== SOURCE_MANIFEST_DIGEST) {
    throw new Error("source manifest digest does not match the pinned IFEval source");
  }
  if (!DIGEST_PATTERN.test(input.installedPluginDigest)) {
    throw new Error("installedPluginDigest must be a sha256 digest");
  }
  for (const digest of [
    input.hostEvidence.harborLockDigest,
    input.hostEvidence.taskImageDefinitionDigest,
    input.hostEvidence.verifierImageDefinitionDigest,
  ]) {
    if (!DIGEST_PATTERN.test(digest)) {
      throw new Error("benchmark host evidence must use sha256 digests");
    }
  }

  return Object.freeze({
    schema: "coffee-chat-eval/benchmark-execution",
    calver: "2026.8.12",
    executionStatus: "executed",
    resultState: input.artifactEvidence.resultState,
    measurement: "not_performed",
    benchmark: Object.freeze({
      name: "IFEval",
      caseKey: CASE_KEY,
      sourceDigest: SOURCE_DIGEST,
      sourceManifestDigest: input.sourceManifestDigest,
    }),
    evaluatorCommit: input.evaluatorCommit,
    candidateCommit: input.candidateCommit,
    pluginVersion: input.pluginVersion,
    installedPluginDigest: input.installedPluginDigest,
    backend: "harbor",
    harness: "codex",
    model: input.model,
    nativeTrialId: input.harborResult.nativeTrialId,
    nativeTrialName: input.harborResult.nativeTrialName,
    nativeHarborReward: input.harborResult.nativeReward,
    benchmarkInputRead: input.traceEvidence.benchmarkInputRead,
    candidateInputDelivery: input.traceEvidence.candidateInputDelivery,
    publicEntrypointInvocation: input.traceEvidence.publicEntrypointInvocation,
    resultArtifact: input.artifactEvidence.resultArtifact,
    harborResultPath: input.harborResultPath,
    codexTracePath: input.codexTracePath,
    cleanup: input.cleanup,
    hostEvidence: Object.freeze({ ...input.hostEvidence }),
    interpretation: "execution-only; no Coffee Chat performance claim",
  });
}
