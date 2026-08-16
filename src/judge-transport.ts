import { startResponsesProxy } from "./responses-proxy.ts";

const RESPONSE_BYTES = 2 * 1024 * 1024;

export interface ResponsesJudgeRequest {
  readonly model: string;
  readonly system: string;
  readonly input: string;
  readonly allowedVerdicts: readonly [string, ...string[]];
}

export type ResponsesJudgeResult =
  | {
      readonly state: "succeeded";
      readonly resolvedModel: string;
      readonly responseText: string;
      readonly usage: null;
    }
  | {
      readonly state: "unavailable" | "failed";
      readonly resolvedModel: string | null;
      readonly cause: string;
    };

export interface ResponsesJudgeTransportHandle {
  readonly transport: (request: ResponsesJudgeRequest) => Promise<ResponsesJudgeResult>;
  readonly proxyCapabilityToken: string;
  readonly close: () => Promise<void>;
}

function responseText(value: unknown): string | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = responseText(item);
      if (text !== undefined) return text;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record.type === "output_text" && typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.output_text === "string") return record.output_text;
  for (const item of Object.values(record)) {
    const text = responseText(item);
    if (text !== undefined) return text;
  }
  return undefined;
}

function schema(allowedVerdicts: readonly [string, ...string[]]) {
  return {
    type: "json_schema",
    name: "judge_verdict",
    strict: true,
    schema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: [...allowedVerdicts] },
      },
      required: ["verdict"],
      additionalProperties: false,
    },
  } as const;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > RESPONSE_BYTES) throw new TypeError("judge response is too large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TypeError("judge response is not JSON");
  }
}

function failureCause(status: number, value: unknown): string {
  if (value !== null && typeof value === "object") {
    const error = (value as Record<string, unknown>).error;
    if (error !== null && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.length > 0) {
        return `judge provider returned HTTP ${status}: ${message.slice(0, 400)}`;
      }
    }
  }
  return `judge provider returned HTTP ${status}`;
}

export async function createResponsesJudgeTransport(input: {
  readonly apiKey: string;
  readonly allowedModels: readonly [string, ...string[]];
  readonly upstreamUrl?: string;
  readonly timeoutMs?: number;
}): Promise<ResponsesJudgeTransportHandle> {
  if (input.apiKey.length === 0) throw new TypeError("judge provider key is required");
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new TypeError("judge timeout must be at least one second");
  }
  const proxy = await startResponsesProxy({
    apiKey: input.apiKey,
    allowedModels: input.allowedModels,
    ...(input.upstreamUrl === undefined ? {} : { upstreamUrl: input.upstreamUrl }),
    bindHost: "127.0.0.1",
    advertisedHost: "127.0.0.1",
    maxRequests: input.allowedModels.length * 8,
  });
  const transport = async (
    request: ResponsesJudgeRequest,
  ): Promise<ResponsesJudgeResult> => {
    if (!input.allowedModels.includes(request.model)) {
      return {
        state: "unavailable",
        resolvedModel: null,
        cause: `judge model is not allowed: ${request.model}`,
      };
    }
    const body = {
      model: request.model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: request.system }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: request.input }],
        },
      ],
      text: { format: schema(request.allowedVerdicts) },
      max_output_tokens: 512,
      store: false,
    };
    try {
      const response = await fetch(`${proxy.baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${proxy.capabilityToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const value = await readJson(response);
      if (!response.ok) {
        return {
          state: response.status === 429 ? "unavailable" : "failed",
          resolvedModel: null,
          cause: failureCause(response.status, value),
        };
      }
      const text = responseText(value);
      if (text === undefined || text.length === 0) {
        const keys =
          value !== null && typeof value === "object" && !Array.isArray(value)
            ? Object.keys(value).sort().join(",")
            : "non-object";
        return {
          state: "failed",
          resolvedModel: null,
          cause: `judge response did not contain output text (keys: ${keys})`,
        };
      }
      const resolvedModel =
        value !== null &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).model === "string"
          ? ((value as Record<string, unknown>).model as string)
          : request.model;
      return { state: "succeeded", resolvedModel, responseText: text, usage: null };
    } catch (error) {
      return {
        state: "failed",
        resolvedModel: null,
        cause: error instanceof Error ? error.message : "judge transport failed",
      };
    }
  };
  const handle: ResponsesJudgeTransportHandle = {
    transport,
    proxyCapabilityToken: proxy.capabilityToken,
    close: proxy.close,
  };
  return Object.freeze(handle);
}
