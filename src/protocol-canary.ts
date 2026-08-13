import type { ParsedHarborResult } from "./harbor.ts";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export interface ProtocolCanaryReceiptInput {
  readonly trialId: string;
  readonly evaluatorCommit: string;
  readonly candidateCommit: string;
  readonly taskDigest: string;
  readonly plugin: ValidatedPluginInstall;
  readonly trace: ValidatedCodexTrace;
  readonly artifact: ValidatedProtocolCanaryArtifact;
  readonly model: string;
  readonly harborResult: ParsedHarborResult;
  readonly harborResultPath: string;
  readonly codexTracePath: string;
  readonly isolationReference: string;
  readonly hostEvidence: {
    readonly harborLockPath: string;
    readonly harborLockDigest: string;
    readonly taskImageDefinitionDigest: string;
    readonly verifierImageDefinitionDigest: string;
  };
  readonly cleanup: "verified";
}

export interface ProtocolCanaryReceipt {
  readonly schema: "coffee-chat-eval/protocol-canary";
  readonly calver: "2026.8.12";
  readonly trialId: string;
  readonly resultState: "unmeasured";
  readonly evaluator: {
    readonly repository: "https://github.com/openboa-ai/coffee-chat-eval";
    readonly commit: string;
    readonly calver: "2026.8.12";
  };
  readonly candidate: {
    readonly repository: "https://github.com/openboa-ai/coffee-chat";
    readonly commit: string;
    readonly pluginVersion: string;
    readonly installedPluginDigest: string;
  };
  readonly execution: {
    readonly backend: "harbor";
    readonly harborVersion: "0.21.0";
    readonly harness: "codex";
    readonly codexVersion: "0.147.0";
    readonly model: string;
    readonly nativeTrialId: string;
    readonly nativeTrialName: string;
    readonly isolationReference: string;
    readonly hostEvidence: {
      readonly harborLockPath: string;
      readonly harborLockDigest: string;
      readonly taskImageDefinitionDigest: string;
      readonly verifierImageDefinitionDigest: string;
    };
    readonly cleanup: "verified";
  };
  readonly evidence: {
    readonly taskDigest: string;
    readonly nativeReward: number;
    readonly pluginSkillDiscovery: "verified";
    readonly publicEntrypointInvocation: "verified";
    readonly capabilityStatus: "not_implemented";
    readonly candidateArtifact: "verified";
    readonly harborResultPath: string;
    readonly codexTracePath: string;
  };
}

export interface PluginInstallEvidence {
  readonly available: unknown;
  readonly installation: unknown;
  readonly installed: unknown;
  readonly sourceDigest: string;
  readonly installedDigest: string;
}

export interface ValidatedPluginInstall {
  readonly pluginId: "coffee-chat@openboa-ai";
  readonly version: string;
  readonly installedPath: string;
  readonly digest: string;
}

export interface ValidatedCodexTrace {
  readonly pluginSkillDiscovery: "verified";
  readonly publicEntrypointInvocation: "verified";
  readonly capabilityStatus: "not_implemented";
}

export interface ValidatedProtocolCanaryArtifact {
  readonly candidateArtifact: "verified";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function assertEvidenceBudget(value: unknown, label: string): void {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  let characters = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > 10_000 || current.depth > 16) {
      throw new Error(`${label} exceeds its structural resource limit`);
    }
    if (typeof current.value === "string") {
      characters += current.value.length;
      if (characters > 2 * 1024 * 1024) {
        throw new Error(`${label} exceeds its text resource limit`);
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > 512) {
        throw new Error(`${label} exceeds its array resource limit`);
      }
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    const record = asRecord(current.value);
    if (record === undefined) continue;
    const entries = Object.entries(record);
    if (entries.length > 256) {
      throw new Error(`${label} exceeds its object resource limit`);
    }
    for (const [key, item] of entries) {
      characters += key.length;
      pending.push({ value: item, depth: current.depth + 1 });
    }
  }
}

export function traceExecCommand(input: unknown): Record<string, unknown> | undefined {
  if (typeof input !== "string" || input.length > 8_192) return undefined;
  const match = /^const r = await tools\.exec_command\((\{[^\n]*\})\);$/u.exec(input);
  if (match?.[1] === undefined) return undefined;
  try {
    const command = asRecord(JSON.parse(match[1]) as unknown);
    if (
      command === undefined ||
      Object.keys(command).sort().join(",") !== "cmd,workdir"
    ) {
      return undefined;
    }
    return command;
  } catch {
    return undefined;
  }
}

export function traceObservationJson(
  observation: unknown,
): Record<string, unknown> | undefined {
  const root = asRecord(observation);
  if (!Array.isArray(root?.results) || root.results.length !== 1) return undefined;
  const result = asRecord(root.results[0]);
  if (typeof result?.content !== "string" || result.content.length > 1024 * 1024) {
    return undefined;
  }
  try {
    return asRecord(JSON.parse(result.content) as unknown);
  } catch {
    return undefined;
  }
}

function pluginEntry(value: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map(asRecord)
    .find((entry) => entry?.pluginId === "coffee-chat@openboa-ai");
}

export function validatePluginInstallEvidence(
  evidence: PluginInstallEvidence,
): ValidatedPluginInstall {
  assertEvidenceBudget(evidence, "Plugin installation evidence");
  if (
    !DIGEST_PATTERN.test(evidence.sourceDigest) ||
    evidence.sourceDigest !== evidence.installedDigest
  ) {
    throw new Error("Coffee Chat Plugin source and installed-cache digest mismatch");
  }

  const available = asRecord(evidence.available);
  const installation = asRecord(evidence.installation);
  const installed = asRecord(evidence.installed);
  const discovered = pluginEntry(available?.available);
  const active = pluginEntry(installed?.installed);

  if (
    discovered?.installed !== false ||
    installation?.pluginId !== "coffee-chat@openboa-ai" ||
    active?.installed !== true ||
    active.enabled !== true
  ) {
    throw new Error(
      "Coffee Chat Plugin discovery and installation evidence is invalid",
    );
  }
  if (
    typeof installation.installedPath !== "string" ||
    typeof active.version !== "string" ||
    installation.installedPath.length === 0
  ) {
    throw new Error("Coffee Chat Plugin installation identity is incomplete");
  }

  return Object.freeze({
    pluginId: "coffee-chat@openboa-ai",
    version: active.version,
    installedPath: installation.installedPath,
    digest: evidence.installedDigest,
  });
}

export function validateCodexTraceEvidence(trace: unknown): ValidatedCodexTrace {
  assertEvidenceBudget(trace, "Codex trace");
  const root = asRecord(trace);
  const steps =
    Array.isArray(root?.steps) && root.steps.length <= 256
      ? root.steps.map(asRecord)
      : [];
  const discovery = steps.some(
    (step) =>
      step?.source === "system" &&
      typeof step.message === "string" &&
      /^coffee-chat:coffee-chat \(file: \/tmp\/codex-home\/plugins\/cache\/openboa-ai\/coffee-chat\/[^/]+\/skills\/coffee-chat\/SKILL\.md\)$/u.test(
        step.message,
      ),
  );
  if (!discovery) {
    throw new Error("Codex trace lacks fresh Coffee Chat Plugin Skill discovery");
  }
  const invocation = steps.some((step) => {
    if (step?.source !== "agent" || !Array.isArray(step.tool_calls)) return false;
    const observation = traceObservationJson(step.observation);
    return step.tool_calls.map(asRecord).some((call) => {
      const args = asRecord(call?.arguments);
      const command = traceExecCommand(args?.input);
      return (
        call?.function_name === "exec" &&
        command?.cmd === "node scripts/run.mjs" &&
        typeof command.workdir === "string" &&
        /^\/tmp\/codex-home\/plugins\/cache\/openboa-ai\/coffee-chat\/[^/]+\/skills\/coffee-chat$/u.test(
          command.workdir,
        ) &&
        observation !== undefined &&
        Object.keys(observation).sort().join(",") === "capability,schema,status" &&
        observation.schema === "coffee-chat-capability-result" &&
        observation.capability === "coffee-chat" &&
        observation.status === "not_implemented"
      );
    });
  });
  if (!invocation) {
    throw new Error("Codex trace lacks public entrypoint invocation evidence");
  }

  return Object.freeze({
    pluginSkillDiscovery: "verified",
    publicEntrypointInvocation: "verified",
    capabilityStatus: "not_implemented",
  });
}

export function validateProtocolCanaryArtifact(
  artifact: unknown,
): ValidatedProtocolCanaryArtifact {
  assertEvidenceBudget(artifact, "protocol canary artifact");
  const value = asRecord(artifact);
  if (
    value === undefined ||
    Object.keys(value).sort().join(",") !== "entrypoint,protocol,status" ||
    value.protocol !== "coffee-chat-plugin" ||
    value.entrypoint !== "coffee-chat" ||
    value.status !== "invoked"
  ) {
    throw new Error("collected protocol canary artifact is invalid");
  }
  return Object.freeze({ candidateArtifact: "verified" });
}

export function createProtocolCanaryReceipt(
  input: ProtocolCanaryReceiptInput,
): ProtocolCanaryReceipt {
  if (input.harborResult.resultState !== "unmeasured") {
    throw new Error("a failed Harbor trial cannot produce a conformance receipt");
  }
  if (!COMMIT_PATTERN.test(input.candidateCommit)) {
    throw new Error("candidateCommit must be a full lowercase Git commit");
  }
  if (!COMMIT_PATTERN.test(input.evaluatorCommit)) {
    throw new Error("evaluatorCommit must be a full lowercase Git commit");
  }
  for (const [name, digest] of [
    ["taskDigest", input.taskDigest],
    ["installedPluginDigest", input.plugin.digest],
    ["harborLockDigest", input.hostEvidence.harborLockDigest],
    ["taskImageDefinitionDigest", input.hostEvidence.taskImageDefinitionDigest],
    ["verifierImageDefinitionDigest", input.hostEvidence.verifierImageDefinitionDigest],
  ] as const) {
    if (!DIGEST_PATTERN.test(digest)) {
      throw new Error(`${name} must be a sha256 digest`);
    }
  }

  return Object.freeze({
    schema: "coffee-chat-eval/protocol-canary",
    calver: "2026.8.12",
    trialId: input.trialId,
    resultState: "unmeasured",
    evaluator: Object.freeze({
      repository: "https://github.com/openboa-ai/coffee-chat-eval",
      commit: input.evaluatorCommit,
      calver: "2026.8.12",
    }),
    candidate: Object.freeze({
      repository: "https://github.com/openboa-ai/coffee-chat",
      commit: input.candidateCommit,
      pluginVersion: input.plugin.version,
      installedPluginDigest: input.plugin.digest,
    }),
    execution: Object.freeze({
      backend: "harbor",
      harborVersion: "0.21.0",
      harness: "codex",
      codexVersion: "0.147.0",
      model: input.model,
      nativeTrialId: input.harborResult.nativeTrialId,
      nativeTrialName: input.harborResult.nativeTrialName,
      isolationReference: input.isolationReference,
      hostEvidence: Object.freeze({ ...input.hostEvidence }),
      cleanup: input.cleanup,
    }),
    evidence: Object.freeze({
      taskDigest: input.taskDigest,
      nativeReward: input.harborResult.nativeReward,
      pluginSkillDiscovery: input.trace.pluginSkillDiscovery,
      publicEntrypointInvocation: input.trace.publicEntrypointInvocation,
      capabilityStatus: input.trace.capabilityStatus,
      candidateArtifact: input.artifact.candidateArtifact,
      harborResultPath: input.harborResultPath,
      codexTracePath: input.codexTracePath,
    }),
  });
}

export function formatProtocolCanaryReport(receipt: ProtocolCanaryReceipt): string {
  return [
    "Coffee Chat protocol canary",
    `Result: ${receipt.resultState}`,
    `Candidate: ${receipt.candidate.commit}`,
    `Backend: Harbor ${receipt.execution.harborVersion} / Codex`,
    `Native Harbor reward: ${receipt.evidence.nativeReward}`,
    `Cleanup: ${receipt.execution.cleanup}`,
    "No Coffee Chat performance claim is produced.",
  ].join("\n");
}
