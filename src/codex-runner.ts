import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { BaselineTask, ProjectionManifest } from "./bench.ts";
import {
  CODEX_MODELS,
  CODEX_PROXY_HOST,
  createHarborCodexPlan,
  type CodexModel,
} from "./codex.ts";
import {
  HARBOR_VERSION,
  parseHarborTrialResult,
  type ParsedHarborResult,
} from "./harbor.ts";
import { readBoundedJson } from "./resources.ts";
import { startResponsesProxy } from "./responses-proxy.ts";

const RESULT_BYTES = 2 * 1024 * 1024;
const ARTIFACT_BYTES = 8 * 1024 * 1024;

export interface CandidateTaskOverlay {
  readonly path: string;
  readonly configurationDigest: `sha256:${string}`;
}

export interface CandidateArtifactEvidence {
  readonly path: string;
  readonly bytes: number;
  readonly digest: `sha256:${string}`;
}

export interface CodexCandidateReceipt {
  readonly schema: "coffee-chat-eval/codex-candidate";
  readonly benchmark: {
    readonly repository: "https://github.com/openboa-ai/coffee-chat-bench";
    readonly commit: string;
    readonly release: string;
    readonly bankDigest: string;
    readonly projectionDigest: string;
  };
  readonly harness: {
    readonly name: "harbor";
    readonly version: typeof HARBOR_VERSION;
    readonly adapter: "harbor-codex-proxy";
  };
  readonly candidate: {
    readonly model: CodexModel;
    readonly conditionRole: "task_only" | "direct_context";
    readonly condition: BaselineTask["condition"];
  };
  readonly isolation: {
    readonly host: "docker";
    readonly containerDeleted: boolean;
    readonly providerCredential: "proxy_capability_only";
    readonly providerKeyInCandidateArtifacts: boolean;
    readonly proxyHost: typeof CODEX_PROXY_HOST;
    readonly proxyRequestLimit: number;
    readonly proxyAcceptedRequests: number;
    readonly proxyRejectedRequests: number;
  };
  readonly runtimeOverlay: {
    readonly configurationDigest: `sha256:${string}`;
    readonly proxyConfigDigest: `sha256:${string}`;
    readonly agentNetwork: "allowlist";
    readonly allowedHosts: readonly [typeof CODEX_PROXY_HOST];
  };
  readonly execution: ParsedHarborResult;
  readonly artifacts: readonly CandidateArtifactEvidence[];
  readonly measurement: "unmeasured";
}

function digestBytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertAbsolute(value: string, label: string): void {
  if (!isAbsolute(value)) throw new TypeError(`${label} must be absolute`);
}

function prepareJobsRoot(raw: string): string {
  assertAbsolute(raw, "jobs root");
  const jobsRoot = resolve(raw);
  const parent = dirname(jobsRoot);
  if (realpathSync(parent) !== parent) {
    throw new TypeError("jobs root parent must be a canonical Docker-shareable path");
  }
  mkdirSync(jobsRoot, { recursive: false });
  return jobsRoot;
}

function trialResultPath(jobRoot: string): string {
  const trials = readdirSync(jobRoot, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && entry.name.includes("__"),
  );
  if (trials.length !== 1) throw new Error("Harbor job must produce exactly one trial");
  return join(jobRoot, trials[0]!.name, "result.json");
}

function appendAgentOverlay(taskToml: string): string {
  const header = /^\[agent\][ \t]*$/mu;
  const match = header.exec(taskToml);
  const policy = `network_mode = "allowlist"\nallowed_hosts = ["${CODEX_PROXY_HOST}"]\n`;
  if (match !== null) {
    const sectionStart = match.index + match[0].length;
    const nextSection = /^\[[^\]]+\]\s*$/mu.exec(taskToml.slice(sectionStart));
    const sectionEnd =
      nextSection === null ? taskToml.length : sectionStart + nextSection.index;
    const section = taskToml.slice(sectionStart, sectionEnd);
    if (/^network_mode\s*=/mu.test(section) || /^allowed_hosts\s*=/mu.test(section)) {
      throw new TypeError("candidate overlay refuses to overwrite a task agent policy");
    }
    return `${taskToml.slice(0, sectionStart)}\n${policy}${taskToml.slice(sectionStart)}`;
  }
  return `${taskToml.trimEnd()}\n\n[agent]\n${policy}`;
}

export function createCandidateTaskOverlay(input: {
  readonly sourceTaskPath: string;
  readonly destinationTaskPath: string;
}): CandidateTaskOverlay {
  assertAbsolute(input.sourceTaskPath, "source task path");
  assertAbsolute(input.destinationTaskPath, "destination task path");
  if (!existsSync(input.sourceTaskPath))
    throw new TypeError("source task path is missing");
  if (existsSync(input.destinationTaskPath)) {
    throw new TypeError("destination task path must not already exist");
  }
  cpSync(input.sourceTaskPath, input.destinationTaskPath, { recursive: true });
  const taskTomlPath = join(input.destinationTaskPath, "task.toml");
  const overlayToml = appendAgentOverlay(readFileSync(taskTomlPath, "utf8"));
  writeFileSync(taskTomlPath, overlayToml, { encoding: "utf8" });
  return Object.freeze({
    path: input.destinationTaskPath,
    configurationDigest: digestBytes(Buffer.from(overlayToml, "utf8")),
  });
}

function collectFiles(root: string): CandidateArtifactEvidence[] {
  if (!existsSync(root)) return [];
  const entries = readdirSync(root, { withFileTypes: true });
  const files: CandidateArtifactEvidence[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path));
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = statSync(path);
    if (stat.size > ARTIFACT_BYTES) continue;
    const bytes = readFileSync(path);
    files.push({
      path: relative(root, path),
      bytes: bytes.byteLength,
      digest: digestBytes(bytes),
    });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function candidateArtifacts(trialRoot: string): CandidateArtifactEvidence[] {
  const files = [
    ...collectFiles(join(trialRoot, "agent")),
    ...collectFiles(join(trialRoot, "artifacts")),
  ];
  return files.map((file) => ({ ...file, path: file.path.replace(/^\.\//u, "") }));
}

function runHarbor(
  command: string,
  args: readonly string[],
): Promise<{ readonly status: number | null; readonly error?: Error }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"] as const,
    });
    child.stdout?.resume();
    child.stderr?.resume();
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (status) =>
      resolve(spawnError === undefined ? { status } : { status, error: spawnError }),
    );
  });
}

function containsSecret(root: string, secret: string): boolean {
  if (secret.length === 0 || !existsSync(root)) return false;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && statSync(path).size <= ARTIFACT_BYTES) {
        if (readFileSync(path).includes(Buffer.from(secret))) return true;
      }
    }
  }
  return false;
}

function conditionRole(
  condition: BaselineTask["condition"],
): "task_only" | "direct_context" {
  if (condition === "task_only") return "task_only";
  if (condition === "diagnostic_target_a" || condition === "diagnostic_target_b") {
    return "direct_context";
  }
  throw new TypeError(`condition is not a baseline candidate condition: ${condition}`);
}

function createProxyConfig(path: string, baseUrl: string): `sha256:${string}` {
  const config = [
    'model_provider = "coffee_chat_eval_proxy"',
    "",
    "[model_providers.coffee_chat_eval_proxy]",
    'name = "Coffee Chat Eval Responses Proxy"',
    `base_url = "${baseUrl}"`,
    'wire_api = "responses"',
    "",
  ].join("\n");
  writeFileSync(path, config, { encoding: "utf8", flag: "wx" });
  return digestBytes(Buffer.from(config, "utf8"));
}

export async function runCodexCandidate(input: {
  readonly task: BaselineTask;
  readonly manifest: ProjectionManifest;
  readonly benchmarkCommit: string;
  readonly harborCommand: string;
  readonly jobsRoot: string;
  readonly model: string;
  readonly apiKey: string;
}): Promise<CodexCandidateReceipt> {
  if (!CODEX_MODELS.includes(input.model as CodexModel)) {
    throw new TypeError(`unsupported Codex model: ${input.model}`);
  }
  const model = input.model as CodexModel;
  if (input.apiKey.length === 0) throw new TypeError("OpenAI API key is required");
  const jobsRoot = prepareJobsRoot(input.jobsRoot);
  const overlay = createCandidateTaskOverlay({
    sourceTaskPath: input.task.path,
    destinationTaskPath: join(jobsRoot, "candidate-task"),
  });
  const proxy = await startResponsesProxy({
    apiKey: input.apiKey,
    allowedModels: [model],
    bindHost: "0.0.0.0",
    advertisedHost: CODEX_PROXY_HOST,
  });
  let execution: ParsedHarborResult = {
    resultState: "invalid",
    failureClass: "host",
    reason: "Harbor candidate process failed",
  };
  let artifacts: CandidateArtifactEvidence[] = [];
  let proxyConfigDigest: `sha256:${string}`;
  try {
    const proxyConfigPath = join(jobsRoot, "codex-proxy.toml");
    proxyConfigDigest = createProxyConfig(proxyConfigPath, proxy.baseUrl);
    const plan = createHarborCodexPlan({
      task: { ...input.task, path: overlay.path },
      harborCommand: input.harborCommand,
      jobsRoot,
      model,
      proxyBaseUrl: proxy.baseUrl,
      capabilityToken: proxy.capabilityToken,
      proxyConfigPath,
    });
    const run = await runHarbor(plan.command, plan.args);
    if (run.error === undefined && run.status === 0) {
      try {
        const resultPath = trialResultPath(plan.jobRoot);
        execution = parseHarborTrialResult(
          readBoundedJson(resultPath, RESULT_BYTES, "Harbor candidate result"),
        );
        artifacts = candidateArtifacts(dirname(resultPath));
      } catch {
        execution = {
          resultState: "invalid",
          failureClass: "artifact",
          reason: "Harbor candidate result or trace artifact is missing or invalid",
        };
      }
    }
    const providerKeyInCandidateArtifacts = containsSecret(jobsRoot, input.apiKey);
    if (providerKeyInCandidateArtifacts) {
      execution = {
        resultState: "invalid",
        failureClass: "candidate",
        reason: "provider credential appeared in candidate-owned state",
      };
    }

    const stats = proxy.stats();
    return Object.freeze({
      schema: "coffee-chat-eval/codex-candidate",
      benchmark: {
        repository: "https://github.com/openboa-ai/coffee-chat-bench" as const,
        commit: input.benchmarkCommit,
        release: input.manifest.release,
        bankDigest: input.manifest.bankDigest,
        projectionDigest: input.manifest.projectionDigest,
      },
      harness: {
        name: "harbor" as const,
        version: HARBOR_VERSION,
        adapter: "harbor-codex-proxy" as const,
      },
      candidate: {
        model,
        conditionRole: conditionRole(input.task.condition),
        condition: input.task.condition,
      },
      isolation: {
        host: "docker" as const,
        containerDeleted:
          execution.resultState === "executed" && execution.nativeEnvironmentDelete,
        providerCredential: "proxy_capability_only" as const,
        providerKeyInCandidateArtifacts,
        proxyHost: CODEX_PROXY_HOST,
        proxyRequestLimit: 16,
        proxyAcceptedRequests: stats.acceptedRequests,
        proxyRejectedRequests: stats.rejectedRequests,
      },
      runtimeOverlay: {
        configurationDigest: overlay.configurationDigest,
        proxyConfigDigest,
        agentNetwork: "allowlist" as const,
        allowedHosts: [CODEX_PROXY_HOST] as const,
      },
      execution,
      artifacts,
      measurement: "unmeasured" as const,
    });
  } finally {
    await proxy.close();
    rmSync(overlay.path, { recursive: true, force: true });
  }
}
