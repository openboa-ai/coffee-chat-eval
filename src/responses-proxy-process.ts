import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

import {
  parseRuntimeBundleConfig,
  type RuntimeBundleConfig,
} from "./runtime-config.ts";
import { OPENAI_RESPONSES_UPSTREAM_URL } from "./responses-proxy.ts";

const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;

export interface ResponsesProxyProcessOptions {
  readonly providerEnvFile: string;
  readonly providerKeyEnv: string;
  readonly upstreamUrl?: string;
  readonly candidateModel: string;
  readonly judgeModel: string;
  readonly candidateMaxRequests: number;
  readonly judgeMaxRequests: number;
  readonly ttlSeconds: number;
  readonly productPackageRoot?: string;
}

export interface ResponsesProxyProcessHandle {
  readonly runtime: RuntimeBundleConfig;
  readonly close: () => Promise<void>;
}

interface ChildRuntimeMessage {
  readonly type: "ready";
  readonly runtime: unknown;
}

interface ChildErrorMessage {
  readonly type: "error";
  readonly reason: string;
}

interface ChildClosedMessage {
  readonly type: "closed";
}

type ChildMessage = ChildRuntimeMessage | ChildErrorMessage | ChildClosedMessage;

function isChildMessage(value: unknown): value is ChildMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const type = (value as Record<string, unknown>).type;
  return type === "ready" || type === "error" || type === "closed";
}

function assertProviderKeyName(value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(value)) {
    throw new TypeError("providerKeyEnv must be an environment variable name");
  }
}

/**
 * Permit the exact production endpoint or a numeric loopback replay endpoint.
 * Queries, fragments, credentials, redirects, and hostname aliases are excluded.
 */
export function validateResponsesUpstreamUrl(value: string | undefined): string {
  if (value === undefined) return OPENAI_RESPONSES_UPSTREAM_URL;
  if (value === OPENAI_RESPONSES_UPSTREAM_URL) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(
      "upstreamUrl must be the exact official OpenAI Responses URL or a loopback replay endpoint",
    );
  }
  const isNumericLoopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (
    !isNumericLoopback ||
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    parsed.pathname.length === 0
  ) {
    throw new TypeError(
      "upstreamUrl must be the exact official OpenAI Responses URL or a loopback replay endpoint",
    );
  }
  return parsed.toString();
}

function strictChildEnvironment(): NodeJS.ProcessEnv {
  return Object.freeze({
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
  });
}

function childEntrypoint(): { readonly path: string; readonly execArgv: string[] } {
  const ownPath = fileURLToPath(import.meta.url);
  const extension = extname(ownPath);
  if (extension !== ".ts" && extension !== ".js") {
    throw new TypeError("proxy process module extension is unsupported");
  }
  return {
    path: join(dirname(ownPath), `responses-proxy-process-child${extension}`),
    execArgv: extension === ".ts" ? ["--experimental-strip-types"] : [],
  };
}

function after(milliseconds: number, label: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), milliseconds);
    timer.unref();
  });
}

async function terminate(child: ChildProcess, exited: Promise<void>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exited;
    return;
  }
  child.kill("SIGTERM");
  try {
    await Promise.race([exited, after(1_000, "proxy child termination timed out")]);
  } catch {
    child.kill("SIGKILL");
    await exited;
  }
}

/**
 * Start the credential-bearing proxy in a dedicated OS process. This process
 * receives only scoped capability metadata; it never opens the provider env file.
 */
export async function startResponsesProxyProcess(
  options: ResponsesProxyProcessOptions,
): Promise<ResponsesProxyProcessHandle> {
  if (!isAbsolute(options.providerEnvFile)) {
    throw new TypeError("providerEnvFile must be an absolute path");
  }
  assertProviderKeyName(options.providerKeyEnv);
  if (Object.hasOwn(process.env, options.providerKeyEnv)) {
    throw new TypeError(
      `${options.providerKeyEnv} must not be present in the Eval parent environment`,
    );
  }
  const upstreamUrl = validateResponsesUpstreamUrl(options.upstreamUrl);
  if (
    !Number.isSafeInteger(options.candidateMaxRequests) ||
    options.candidateMaxRequests < 1
  ) {
    throw new TypeError("candidate proxy request cap must be positive");
  }
  if (!Number.isSafeInteger(options.judgeMaxRequests) || options.judgeMaxRequests < 0) {
    throw new TypeError("Judge proxy request cap must be non-negative");
  }
  if (!Number.isSafeInteger(options.ttlSeconds) || options.ttlSeconds < 60) {
    throw new TypeError("proxy capability TTL must be at least 60 seconds");
  }

  const entrypoint = childEntrypoint();
  const child = fork(entrypoint.path, [], {
    env: strictChildEnvironment(),
    execArgv: entrypoint.execArgv,
    serialization: "json",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  let resolveReady!: (runtime: RuntimeBundleConfig) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<RuntimeBundleConfig>(
    (resolveReadyValue, rejectReadyValue) => {
      resolveReady = resolveReadyValue;
      rejectReady = rejectReadyValue;
    },
  );
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolveClosedValue) => {
    resolveClosed = resolveClosedValue;
  });
  const exited = new Promise<void>((resolveExited) => {
    child.once("exit", () => resolveExited());
  });
  let readySettled = false;
  let closedAcknowledged = false;

  child.on("message", (message: unknown) => {
    if (!isChildMessage(message)) return;
    if (message.type === "ready" && !readySettled) {
      try {
        const childRuntime = parseRuntimeBundleConfig(message.runtime);
        const runtime =
          options.productPackageRoot === undefined
            ? childRuntime
            : parseRuntimeBundleConfig({
                ...childRuntime,
                productHost: {
                  schema: "product-host-runtime-v1",
                  host: "eval-skills-reference-host-v1",
                  packageRoot: resolve(options.productPackageRoot),
                },
              });
        readySettled = true;
        resolveReady(runtime);
      } catch {
        readySettled = true;
        rejectReady(new TypeError("proxy child returned invalid runtime metadata"));
      }
      return;
    }
    if (message.type === "error" && !readySettled) {
      readySettled = true;
      rejectReady(new Error(`proxy child failed: ${message.reason}`));
      return;
    }
    if (message.type === "closed") {
      closedAcknowledged = true;
      resolveClosed();
    }
  });
  child.once("error", () => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(new Error("proxy child process could not start"));
    }
  });
  child.once("exit", (code, signal) => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(
        new Error(
          `proxy child exited before readiness (${code === null ? signal : code})`,
        ),
      );
    }
  });

  child.send({
    type: "start",
    options: {
      providerEnvFile: resolve(options.providerEnvFile),
      providerKeyEnv: options.providerKeyEnv,
      upstreamUrl,
      candidateModel: options.candidateModel,
      judgeModel: options.judgeModel,
      candidateMaxRequests: options.candidateMaxRequests,
      judgeMaxRequests: options.judgeMaxRequests,
      ttlSeconds: options.ttlSeconds,
    },
  });

  let runtime: RuntimeBundleConfig;
  try {
    runtime = await Promise.race([
      ready,
      after(START_TIMEOUT_MS, "proxy child readiness timed out"),
    ]);
  } catch (error) {
    await terminate(child, exited);
    throw error;
  }

  let closePromise: Promise<void> | undefined;
  return Object.freeze({
    runtime,
    close: () => {
      closePromise ??= (async () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          await exited;
          if (!closedAcknowledged) {
            throw new Error("proxy child exited without cleanup acknowledgement");
          }
          return;
        }
        child.send({ type: "shutdown" });
        try {
          await Promise.race([
            closed,
            after(STOP_TIMEOUT_MS, "proxy child cleanup timed out"),
          ]);
          await Promise.race([
            exited,
            after(STOP_TIMEOUT_MS, "proxy child exit timed out"),
          ]);
        } catch (error) {
          await terminate(child, exited);
          throw error;
        }
      })();
      return closePromise;
    },
  });
}
