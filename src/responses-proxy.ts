import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

const DEFAULT_UPSTREAM = "https://api.openai.com/v1/responses";
const DEFAULT_MAX_REQUESTS = 16;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface ResponsesProxyOptions {
  readonly apiKey: string;
  readonly allowedModels: readonly string[];
  readonly upstreamUrl?: string;
  readonly bindHost?: string;
  readonly advertisedHost?: string;
  readonly maxRequests?: number;
  readonly maxBodyBytes?: number;
}

export interface ResponsesProxyStats {
  readonly acceptedRequests: number;
  readonly rejectedRequests: number;
}

export interface ResponsesProxyHandle {
  readonly baseUrl: string;
  readonly capabilityToken: string;
  readonly stats: () => ResponsesProxyStats;
  readonly close: () => Promise<void>;
}

function json(
  response: ServerResponse,
  status: number,
  body: Record<string, string>,
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function hasCapability(request: IncomingMessage, token: string): boolean {
  const received = request.headers.authorization;
  const expected = `Bearer ${token}`;
  if (typeof received !== "string") return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length &&
    timingSafeEqual(receivedBytes, expectedBytes)
  );
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new RangeError("request body exceeds proxy limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function modelFrom(body: Buffer): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const model = (parsed as Record<string, unknown>).model;
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined;
  }
}

function listen(server: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, host, () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("proxy did not expose a TCP address"));
        return;
      }
      resolve(address.port);
    });
  });
}

export async function startResponsesProxy(
  options: ResponsesProxyOptions,
): Promise<ResponsesProxyHandle> {
  if (options.apiKey.length === 0) throw new TypeError("proxy API key is required");
  if (options.allowedModels.length === 0) {
    throw new TypeError("proxy must allow at least one model");
  }
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(maxRequests) || maxRequests < 1) {
    throw new TypeError("proxy maxRequests must be a positive integer");
  }
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new TypeError("proxy maxBodyBytes must be a positive integer");
  }

  const upstreamUrl = options.upstreamUrl ?? DEFAULT_UPSTREAM;
  const allowedModels = new Set(options.allowedModels);
  const capabilityToken = randomBytes(32).toString("hex");
  const bindHost = options.bindHost ?? "0.0.0.0";
  const advertisedHost = options.advertisedHost ?? "host.docker.internal";
  let acceptedRequests = 0;
  let rejectedRequests = 0;

  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://proxy").pathname;
      if (request.method !== "POST" || path !== "/v1/responses") {
        rejectedRequests += 1;
        json(response, 404, { error: "proxy route not found" });
        return;
      }
      if (!hasCapability(request, capabilityToken)) {
        rejectedRequests += 1;
        json(response, 401, { error: "proxy capability required" });
        return;
      }
      if (acceptedRequests >= maxRequests) {
        rejectedRequests += 1;
        json(response, 429, { error: "proxy request budget exhausted" });
        return;
      }
      const body = await readBody(request, maxBodyBytes);
      const model = modelFrom(body);
      if (model === undefined) {
        rejectedRequests += 1;
        json(response, 400, { error: "request model is required" });
        return;
      }
      if (!allowedModels.has(model)) {
        rejectedRequests += 1;
        json(response, 403, { error: "model is not allowed for this run" });
        return;
      }

      acceptedRequests += 1;
      const upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": request.headers["content-type"] ?? "application/json",
          accept: request.headers.accept ?? "application/json",
        },
        body: body.toString("utf8"),
      });
      response.statusCode = upstream.status;
      response.setHeader("cache-control", "no-store");
      const contentType = upstream.headers.get("content-type");
      if (contentType !== null) response.setHeader("content-type", contentType);
      if (upstream.body === null) {
        response.end();
        return;
      }
      for await (const chunk of upstream.body) response.write(chunk);
      response.end();
    } catch (error) {
      if (!response.headersSent) {
        const status = error instanceof RangeError ? 413 : 502;
        json(response, status, {
          error:
            status === 413 ? "request body is too large" : "upstream request failed",
        });
      } else {
        response.destroy();
      }
    }
  });

  const port = await listen(server, bindHost);
  return Object.freeze({
    baseUrl: `http://${advertisedHost}:${port}/v1`,
    capabilityToken,
    stats: () => Object.freeze({ acceptedRequests, rejectedRequests }),
    close: async () => {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  });
}
