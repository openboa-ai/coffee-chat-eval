import { stableDigest } from "./identity.ts";
import { putEvidence, type EvidenceRecord } from "./evidence.ts";
import type {
  CandidateTransport,
  JudgeTransport,
  InteractiveAgentSession,
  InteractiveAgentTransport,
  PrivateArtifactRef,
} from "./eval-core.ts";

export interface CapabilityDescriptor {
  readonly scope: "candidate" | "judge";
  readonly expiresAt: string;
  readonly maxRequests: number;
  readonly digest: `sha256:${string}`;
}

function artifactFromValue(
  root: string,
  value: unknown,
  mediaType = "application/json",
): PrivateArtifactRef {
  const serialized =
    typeof value === "string" ? value : `${JSON.stringify(value)}\n`;
  const evidence: EvidenceRecord = putEvidence(root, serialized, "private");
  return Object.freeze({
    path: evidence.path,
    digest: evidence.digest,
    mediaType,
    bytes: Buffer.byteLength(serialized, "utf8"),
  });
}

export function issueCapabilityDescriptor(input: {
  readonly scope: CapabilityDescriptor["scope"];
  readonly expiresAt: string;
  readonly maxRequests: number;
}): CapabilityDescriptor {
  if (!Number.isSafeInteger(input.maxRequests) || input.maxRequests < 1) {
    throw new TypeError("capability maxRequests must be a positive integer");
  }
  if (Number.isNaN(Date.parse(input.expiresAt)))
    throw new TypeError("capability expiry must be an ISO date");
  return Object.freeze({ ...input, digest: stableDigest(input) });
}

export function createFixtureCandidateTransport(
  handler: (input: unknown) => unknown,
  options: { readonly evidenceRoot?: string } = {},
): CandidateTransport {
  const evidenceRoot = options.evidenceRoot ?? "/tmp/coffee-chat-eval-fixture-evidence";
  return Object.freeze({
    kind: "fixture" as const,
    run: async (input: unknown) => {
      const started = Date.now();
      try {
        const output = artifactFromValue(evidenceRoot, handler(input));
        return {
          state: "measured" as const,
          output,
          outputDigest: output.digest,
          latencyMs: Math.max(0, Date.now() - started),
          inputTokens: null,
          outputTokens: null,
        };
      } catch (error) {
        return {
          state: "failed" as const,
          reason: error instanceof Error ? error.message : "fixture candidate failed",
          failureOwner: "candidate" as const,
        };
      }
    },
  });
}

export function createNotImplementedTransport(
  kind: "fixture" | "reference_model" | "agent_stack" | "coffee_chat_product",
): CandidateTransport {
  return Object.freeze({
    kind,
    run: async () => ({
      state: "not_implemented" as const,
      reason: `${kind} interactive interface is not implemented`,
    }),
  });
}

async function postBroker(
  endpoint: string,
  capability: string,
  body: unknown,
): Promise<unknown> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${capability}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) throw new Error(`broker returned HTTP ${response.status}`);
    return (await response.json()) as unknown;
  } catch (error) {
    throw new Error("broker session unavailable", { cause: error });
  }
}

function responseText(value: unknown): { readonly value: unknown; readonly mediaType: string } {
  if (typeof value === "string") return { value, mediaType: "text/plain" };
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.output_text === "string") return { value: record.output_text, mediaType: "text/plain" };
    if (Array.isArray(record.output)) {
      const content: unknown[] = [];
      for (const item of record.output) {
        if (item !== null && typeof item === "object") {
          const itemRecord = item as Record<string, unknown>;
          if (itemRecord.type === "function_call") {
            content.push({
              type: "function_call",
              call_id: itemRecord.call_id,
              name: itemRecord.name,
              arguments: itemRecord.arguments,
            });
          } else if (Array.isArray(itemRecord.content)) {
            content.push(...itemRecord.content);
          }
        }
      }
      if (content.length > 0) return { value: content, mediaType: "application/json" };
    }
  }
  return { value, mediaType: "application/json" };
}

async function callResponses(input: {
  readonly endpoint: string;
  readonly capability: string;
  readonly model: string;
  readonly body: unknown;
}): Promise<unknown> {
  return postBroker(input.endpoint, input.capability, {
    model: input.model,
    ...((input.body !== null && typeof input.body === "object") ? input.body : { input: input.body }),
  });
}

export function createResponsesCandidateTransport(input: {
  readonly endpoint: string;
  readonly capability: string;
  readonly model: string;
  readonly evidenceRoot: string;
}): CandidateTransport {
  if (input.capability.length === 0) throw new TypeError("scoped capability is required");
  if (input.model.length === 0) throw new TypeError("candidate model is required");
  return Object.freeze({
    kind: "agent_stack" as const,
    run: async (request: unknown) => {
      const started = Date.now();
      try {
        const response = await callResponses({
          endpoint: input.endpoint,
          capability: input.capability,
          model: input.model,
          body: request,
        });
        const normalized = responseText(response);
        const output = artifactFromValue(input.evidenceRoot, normalized.value, normalized.mediaType);
        const responseRecord = response !== null && typeof response === "object" ? response as Record<string, unknown> : {};
        const usage = responseRecord.usage !== null && typeof responseRecord.usage === "object" ? responseRecord.usage as Record<string, unknown> : {};
        return {
          state: "measured" as const,
          output,
          outputDigest: output.digest,
          latencyMs: Math.max(0, Date.now() - started),
          inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
          outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
        };
      } catch (error) {
        return {
          state: "failed" as const,
          reason: error instanceof Error ? error.message : "candidate broker failed",
          failureOwner: "candidate" as const,
        };
      }
    },
  });
}

export function createResponsesJudgeTransport(input: {
  readonly endpoint: string;
  readonly capability: string;
  readonly model: string;
  readonly evidenceRoot: string;
}): JudgeTransport {
  if (input.capability.length === 0) throw new TypeError("scoped capability is required");
  if (input.model.length === 0) throw new TypeError("judge model is required");
  return Object.freeze({
    kind: "sealed-judge" as const,
    evaluate: async (request: unknown) => {
      const started = Date.now();
      try {
        const response = await callResponses({
          endpoint: input.endpoint,
          capability: input.capability,
          model: input.model,
          body: request,
        });
        const verdict = artifactFromValue(input.evidenceRoot, response, "application/json");
        const responseRecord = response !== null && typeof response === "object" ? response as Record<string, unknown> : {};
        const usage = responseRecord.usage !== null && typeof responseRecord.usage === "object" ? responseRecord.usage as Record<string, unknown> : {};
        return {
          state: "measured" as const,
          verdict,
          verdictDigest: verdict.digest,
          latencyMs: Math.max(0, Date.now() - started),
          inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : null,
          outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : null,
        };
      } catch (error) {
        return {
          state: "unavailable" as const,
          reason: error instanceof Error ? error.message : "judge broker failed",
          failureOwner: "judge" as const,
        };
      }
    },
  });
}

export function createInteractiveBrokerTransport(input: {
  readonly endpoint: string;
  readonly capability: string;
  readonly model: string;
}): InteractiveAgentTransport {
  const endpoint = new URL(input.endpoint);
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new TypeError("broker endpoint must use HTTP or HTTPS");
  }
  if (
    endpoint.hostname !== "127.0.0.1" &&
    endpoint.hostname !== "localhost" &&
    endpoint.hostname !== "[::1]" &&
    endpoint.hostname !== "::1"
  ) {
    throw new TypeError("broker endpoint must be host-local");
  }
  if (input.capability.length === 0)
    throw new TypeError("scoped capability is required");
  if (input.model.length === 0) throw new TypeError("broker model is required");
  return Object.freeze({
    kind: "agent_stack" as const,
    run: async () => ({
      state: "unavailable" as const,
      reason: "interactive broker transport requires a session",
      failureOwner: "host" as const,
    }),
    openSession: async (sessionInput: unknown): Promise<InteractiveAgentSession> => {
      const opened = await postBroker(endpoint.toString(), input.capability, {
        type: "open",
        model: input.model,
        input: sessionInput,
      });
      return Object.freeze({
        send: async (message: unknown) =>
          postBroker(endpoint.toString(), input.capability, {
            type: "message",
            session: opened,
            message,
          }),
        close: async () => {
          await postBroker(endpoint.toString(), input.capability, {
            type: "close",
            session: opened,
          });
        },
      });
    },
  });
}
