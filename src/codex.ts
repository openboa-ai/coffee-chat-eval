import { isAbsolute } from "node:path";

import type { BaselineTask } from "./bench.ts";

export const CODEX_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;
export type CodexModel = (typeof CODEX_MODELS)[number];

export const CODEX_PROXY_HOST = "host.docker.internal" as const;

const SETUP_HOSTS = [
  "deb.debian.org",
  "security.debian.org",
  "github.com",
  "raw.githubusercontent.com",
  "nodejs.org",
  "registry.npmjs.org",
  "npmjs.org",
] as const;

export interface HarborCodexPlan {
  readonly task: BaselineTask;
  readonly command: string;
  readonly args: readonly string[];
  readonly jobName: string;
  readonly jobRoot: string;
  readonly model: CodexModel;
  readonly proxyConfigPath: string;
}

function requireAbsolute(value: string, label: string): void {
  if (!isAbsolute(value)) throw new TypeError(`${label} must be absolute`);
}

function model(value: string): CodexModel {
  if (!CODEX_MODELS.includes(value as CodexModel)) {
    throw new TypeError(`unsupported Codex model: ${value}`);
  }
  return value as CodexModel;
}

export function createHarborCodexPlan(input: {
  readonly task: BaselineTask;
  readonly harborCommand: string;
  readonly jobsRoot: string;
  readonly model: string;
  readonly proxyBaseUrl: string;
  readonly capabilityToken: string;
  readonly proxyConfigPath: string;
}): HarborCodexPlan {
  requireAbsolute(input.task.path, "Harbor task path");
  requireAbsolute(input.harborCommand, "Harbor command");
  requireAbsolute(input.jobsRoot, "Harbor jobs root");
  requireAbsolute(input.proxyConfigPath, "Codex proxy config");
  if (input.capabilityToken.length === 0) {
    throw new TypeError("Codex proxy capability is required");
  }
  const selectedModel = model(input.model);
  const proxy = new URL(input.proxyBaseUrl);
  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    throw new TypeError("Codex proxy URL must use HTTP or HTTPS");
  }
  const jobName = `bench-codex-${input.task.condition}-${selectedModel}`.replace(
    /[^a-zA-Z0-9._-]/gu,
    "-",
  );
  const args = [
    "run",
    "-p",
    input.task.path,
    "-a",
    "codex",
    "-m",
    selectedModel,
    "-o",
    input.jobsRoot,
    "--job-name",
    jobName,
    "--n-concurrent",
    "1",
    "-k",
    "1",
    "-y",
    "--agent-env",
    `OPENAI_API_KEY=${input.capabilityToken}`,
    "--agent-kwarg",
    `config=${input.proxyConfigPath}`,
    "--allow-agent-host",
    CODEX_PROXY_HOST,
    ...SETUP_HOSTS.flatMap((host) => ["--allow-environment-host", host]),
    "--agent-kwarg",
    "reasoning_effort=low",
    "--agent-kwarg",
    "reasoning_summary=none",
    "--agent-kwarg",
    "web_search=disabled",
  ] as const;
  return Object.freeze({
    task: input.task,
    command: input.harborCommand,
    args: Object.freeze(args),
    jobName,
    jobRoot: `${input.jobsRoot}/${jobName}`,
    model: selectedModel,
    proxyConfigPath: input.proxyConfigPath,
  });
}
