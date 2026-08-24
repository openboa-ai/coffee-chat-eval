import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

import { startResponsesProxy, type ResponsesProxyHandle } from "./responses-proxy.ts";
import { validateResponsesUpstreamUrl } from "./responses-proxy-process.ts";
import { parseRuntimeBundleConfig } from "./runtime-config.ts";

const MAX_ENV_FILE_BYTES = 64 * 1024;

interface ChildStartOptions {
  readonly providerEnvFile: string;
  readonly providerKeyEnv: string;
  readonly upstreamUrl: string;
  readonly candidateModel: string;
  readonly judgeModel: string;
  readonly candidateMaxRequests: number;
  readonly judgeMaxRequests: number;
  readonly ttlSeconds: number;
}

function dotenvValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    if (value.length < 2 || value.at(-1) !== quote) {
      throw new TypeError("provider env file contains an unterminated quoted value");
    }
    const inner = value.slice(1, -1);
    if (quote === "'") return inner;
    try {
      return JSON.parse(value) as string;
    } catch {
      throw new TypeError("provider env file contains an invalid quoted value");
    }
  }
  return value;
}

function providerKeyFromPrivateFile(path: string, keyName: string): string {
  if (!isAbsolute(path)) throw new TypeError("provider env file path must be absolute");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(keyName)) {
    throw new TypeError("provider env key name is invalid");
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError("provider env file must be a regular file, not a symlink");
  }
  if (stat.size < 1 || stat.size > MAX_ENV_FILE_BYTES) {
    throw new TypeError("provider env file size is invalid");
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new TypeError("provider env file must not be accessible by group or others");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new TypeError("provider env file must be owned by the proxy process user");
  }

  const contents = readFileSync(path, "utf8");
  let result: string | undefined;
  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/u.exec(
      trimmed,
    );
    if (match === null) {
      throw new TypeError(`provider env file syntax is invalid on line ${index + 1}`);
    }
    if (match[1] !== keyName) continue;
    if (result !== undefined) {
      throw new TypeError("provider env file contains the provider key more than once");
    }
    result = dotenvValue(match[2] ?? "");
  }
  if (result === undefined || result.length === 0) {
    throw new TypeError(
      "provider env file does not contain the configured provider key",
    );
  }
  return result;
}

function startOptions(value: unknown): ChildStartOptions {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("proxy child start options must be an object");
  }
  const record = value as Record<string, unknown>;
  const exactKeys = [
    "providerEnvFile",
    "providerKeyEnv",
    "upstreamUrl",
    "candidateModel",
    "judgeModel",
    "candidateMaxRequests",
    "judgeMaxRequests",
    "ttlSeconds",
  ];
  if (
    Object.keys(record).length !== exactKeys.length ||
    exactKeys.some((key) => !(key in record))
  ) {
    throw new TypeError("proxy child start options have unexpected fields");
  }
  for (const key of [
    "providerEnvFile",
    "providerKeyEnv",
    "upstreamUrl",
    "candidateModel",
    "judgeModel",
  ]) {
    if (typeof record[key] !== "string" || (record[key] as string).length === 0) {
      throw new TypeError(`proxy child ${key} must be a non-empty string`);
    }
  }
  if (
    !Number.isSafeInteger(record.candidateMaxRequests) ||
    (record.candidateMaxRequests as number) < 1 ||
    !Number.isSafeInteger(record.judgeMaxRequests) ||
    (record.judgeMaxRequests as number) < 0 ||
    !Number.isSafeInteger(record.ttlSeconds) ||
    (record.ttlSeconds as number) < 60
  ) {
    throw new TypeError("proxy child request caps or TTL are invalid");
  }
  return record as unknown as ChildStartOptions;
}

let handles: ResponsesProxyHandle[] = [];
let startReceived = false;
let shuttingDown = false;

async function send(message: Record<string, unknown>): Promise<void> {
  if (process.send === undefined || !process.connected) return;
  await new Promise<void>((resolve, reject) => {
    process.send?.(message, (error) => (error === null ? resolve() : reject(error)));
  });
}

async function closeHandles(): Promise<void> {
  let firstError: unknown;
  for (const handle of [...handles].reverse()) {
    try {
      await handle.close();
    } catch (error) {
      firstError ??= error;
    }
  }
  handles = [];
  if (firstError !== undefined) throw firstError;
}

async function shutdown(notifyParent: boolean, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await closeHandles();
    if (notifyParent) await send({ type: "closed" });
  } catch {
    exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
    process.exitCode = exitCode;
  }
}

function safeReason(error: unknown): string {
  if (error instanceof TypeError && error.message.length <= 240) return error.message;
  return "credential proxy startup failed";
}

async function start(value: unknown): Promise<void> {
  if (startReceived) throw new TypeError("proxy child accepts one start message");
  startReceived = true;
  const options = startOptions(value);
  const upstreamUrl = validateResponsesUpstreamUrl(options.upstreamUrl);
  const providerKey = providerKeyFromPrivateFile(
    options.providerEnvFile,
    options.providerKeyEnv,
  );
  try {
    const expiresAt = new Date(Date.now() + options.ttlSeconds * 1000).toISOString();
    const candidate = await startResponsesProxy({
      apiKey: providerKey,
      allowedModels: [options.candidateModel],
      upstreamUrl,
      bindHost: "127.0.0.1",
      advertisedHost: "127.0.0.1",
      maxRequests: options.candidateMaxRequests,
      expiresAt,
    });
    handles.push(candidate);
    let judge: ResponsesProxyHandle | undefined;
    if (options.judgeMaxRequests > 0) {
      judge = await startResponsesProxy({
        apiKey: providerKey,
        allowedModels: [options.judgeModel],
        upstreamUrl,
        bindHost: "127.0.0.1",
        advertisedHost: "127.0.0.1",
        maxRequests: options.judgeMaxRequests,
        expiresAt,
      });
      handles.push(judge);
    }
    const runtime = parseRuntimeBundleConfig({
      schema: "runtime-bundle-v1",
      candidate: {
        schema: "runtime-capability-v1",
        scope: "candidate",
        endpoint: `${candidate.baseUrl}/responses`,
        capabilityToken: candidate.capabilityToken,
        model: options.candidateModel,
        expiresAt,
        maxRequests: options.candidateMaxRequests,
      },
      ...(judge === undefined
        ? {}
        : {
            judge: {
              schema: "runtime-capability-v1",
              scope: "judge",
              endpoint: `${judge.baseUrl}/responses`,
              capabilityToken: judge.capabilityToken,
              model: options.judgeModel,
              expiresAt,
              maxRequests: options.judgeMaxRequests,
            },
          }),
    });
    await send({ type: "ready", runtime });
  } catch (error) {
    await closeHandles().catch(() => undefined);
    await send({ type: "error", reason: safeReason(error) }).catch(() => undefined);
    await shutdown(false, 1);
  }
}

process.on("message", (message: unknown) => {
  if (message === null || typeof message !== "object" || Array.isArray(message)) return;
  const record = message as Record<string, unknown>;
  if (record.type === "start") {
    void start(record.options).catch(async (error: unknown) => {
      await send({ type: "error", reason: safeReason(error) }).catch(() => undefined);
      await shutdown(false, 1);
    });
    return;
  }
  if (record.type === "shutdown") void shutdown(true, 0);
});

process.once("disconnect", () => void shutdown(false, 0));
process.once("SIGTERM", () => void shutdown(false, 0));
process.once("SIGINT", () => void shutdown(false, 0));
