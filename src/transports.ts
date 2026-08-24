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
  const serialized = typeof value === "string" ? value : `${JSON.stringify(value)}\n`;
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

export function createFixtureJudgeTransport(
  handler: (input: unknown) => unknown,
  options: { readonly evidenceRoot?: string } = {},
): JudgeTransport {
  const evidenceRoot = options.evidenceRoot ?? "/tmp/coffee-chat-eval-fixture-evidence";
  return Object.freeze({
    kind: "sealed-judge" as const,
    evaluate: async (input: unknown) => {
      const started = Date.now();
      try {
        const verdict = artifactFromValue(evidenceRoot, handler(input));
        return {
          state: "measured" as const,
          verdict,
          verdictDigest: verdict.digest,
          latencyMs: Math.max(0, Date.now() - started),
          inputTokens: null,
          outputTokens: null,
        };
      } catch (error) {
        return {
          state: "failed" as const,
          reason: error instanceof Error ? error.message : "fixture Judge failed",
          failureOwner: "judge" as const,
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

class BrokerSessionUnavailableError extends Error {
  constructor(cause: unknown) {
    super("broker session unavailable", { cause });
    this.name = "BrokerSessionUnavailableError";
  }
}

async function postBroker(
  endpoint: string,
  capability: string,
  body: unknown,
): Promise<unknown> {
  const serializedBody = JSON.stringify(body);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${capability}`,
        "content-type": "application/json",
      },
      body: serializedBody,
      // Provider-backed smoke calls may take longer than a local fixture. The
      // broker's request cap and capability expiry remain the hard limits; the
      // transport timeout only bounds a single stalled request.
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new BrokerSessionUnavailableError(error);
  }
  if (!response.ok) {
    throw new BrokerSessionUnavailableError(
      new Error(`broker returned HTTP ${response.status}`),
    );
  }
  let responseBody: string;
  try {
    responseBody = await response.text();
  } catch (error) {
    throw new BrokerSessionUnavailableError(error);
  }
  return JSON.parse(responseBody) as unknown;
}

function responseText(value: unknown): {
  readonly value: unknown;
  readonly mediaType: string;
} {
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.output_text === "string")
      return { value: record.output_text, mediaType: "text/plain" };
    if (Array.isArray(record.output)) {
      const text: string[] = [];
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
            for (const entry of itemRecord.content) {
              if (
                entry !== null &&
                typeof entry === "object" &&
                (entry as Record<string, unknown>).type === "output_text" &&
                typeof (entry as Record<string, unknown>).text === "string"
              ) {
                text.push((entry as Record<string, unknown>).text as string);
              } else {
                content.push(entry);
              }
            }
          }
        }
      }
      if (content.length === 0 && text.length > 0)
        return { value: text.join(""), mediaType: "text/plain" };
      if (text.length > 0) {
        content.unshift({ type: "output_text", text: text.join("") });
      }
      if (content.length > 0) return { value: content, mediaType: "application/json" };
    }
  }
  throw new TypeError("Responses completion has no usable output");
}

class ResponsesEnvelopeError extends Error {
  readonly outcome: "unavailable" | "failed";

  constructor(message: string, outcome: "unavailable" | "failed") {
    super(message);
    this.name = "ResponsesEnvelopeError";
    this.outcome = outcome;
  }
}

function validateResponsesEnvelope(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ResponsesEnvelopeError(
      "Responses completion envelope is invalid",
      "failed",
    );
  }
  const record = value as Record<string, unknown>;
  if (record.error !== undefined && record.error !== null) {
    throw new ResponsesEnvelopeError(
      "Responses completion reported an error",
      "failed",
    );
  }
  if (record.status !== "completed") {
    throw new ResponsesEnvelopeError(
      "Responses completion did not finish",
      record.status === "incomplete" ||
        record.status === "in_progress" ||
        record.status === "queued"
        ? "unavailable"
        : "failed",
    );
  }
  try {
    responseText(record);
  } catch {
    throw new ResponsesEnvelopeError(
      "Responses completion has no usable output",
      "failed",
    );
  }
  return record;
}

type JsonObject = Readonly<Record<string, unknown>>;

function objectValue(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function serialized(value: unknown): string {
  const result = JSON.stringify(value, null, 2);
  return result ?? String(value);
}

function jsonSchemaFormat(name: string, schema: JsonObject): JsonObject {
  return Object.freeze({
    type: "json_schema",
    name,
    strict: true,
    schema,
  });
}

const nonemptyStringSchema = Object.freeze({ type: "string", minLength: 1 });
// The pinned Bench validator uses nonemptyArray for evidenceUse, tradeoffs,
// and constraints. Keep the provider schema at least as strict as that native
// CandidateSubmission contract so invalid completions never reach the Judge.
const candidateSubmissionFormat = jsonSchemaFormat(
  "coffee_chat_candidate_submission",
  Object.freeze({
    type: "object",
    properties: Object.freeze({
      artifact: Object.freeze({
        type: "object",
        properties: Object.freeze({
          mediaType: Object.freeze({
            type: "string",
            enum: Object.freeze(["text/plain"]),
          }),
          content: nonemptyStringSchema,
        }),
        required: Object.freeze(["mediaType", "content"]),
        additionalProperties: false,
      }),
      decisionRecord: Object.freeze({
        type: "object",
        properties: Object.freeze({
          decision: nonemptyStringSchema,
          evidenceUse: Object.freeze({
            type: "array",
            minItems: 1,
            items: Object.freeze({
              type: "object",
              properties: Object.freeze({
                sourceId: nonemptyStringSchema,
                use: nonemptyStringSchema,
              }),
              required: Object.freeze(["sourceId", "use"]),
              additionalProperties: false,
            }),
          }),
          tradeoffs: Object.freeze({
            type: "array",
            minItems: 1,
            items: Object.freeze({
              type: "object",
              properties: Object.freeze({
                factors: Object.freeze({
                  type: "array",
                  items: nonemptyStringSchema,
                  minItems: 2,
                  maxItems: 2,
                }),
                resolution: nonemptyStringSchema,
              }),
              required: Object.freeze(["factors", "resolution"]),
              additionalProperties: false,
            }),
          }),
          constraints: Object.freeze({
            type: "array",
            minItems: 1,
            items: Object.freeze({
              type: "object",
              properties: Object.freeze({
                constraint: nonemptyStringSchema,
                handling: nonemptyStringSchema,
              }),
              required: Object.freeze(["constraint", "handling"]),
              additionalProperties: false,
            }),
          }),
          uncertainty: Object.freeze({ type: Object.freeze(["string", "null"]) }),
        }),
        required: Object.freeze([
          "decision",
          "evidenceUse",
          "tradeoffs",
          "constraints",
          "uncertainty",
        ]),
        additionalProperties: false,
      }),
    }),
    required: Object.freeze(["artifact", "decisionRecord"]),
    additionalProperties: false,
  }),
);

function genericResponsesBody(value: unknown): JsonObject {
  const record = objectValue(value);
  if (record !== undefined && Object.hasOwn(record, "input")) return record;
  if (typeof value === "string" || Array.isArray(value)) {
    return Object.freeze({ input: value });
  }
  return Object.freeze({ input: serialized(value) });
}

function candidateResponsesBody(value: unknown): JsonObject {
  const record = objectValue(value);
  if (record === undefined || Object.hasOwn(record, "input")) {
    return genericResponsesBody(value);
  }
  if (
    typeof record.familyId === "string" &&
    typeof record.condition === "string" &&
    Object.hasOwn(record, "benchmarkInput")
  ) {
    return Object.freeze({
      input: [
        "Complete the supplied Coffee Chat benchmark task.",
        "Return only the structured candidate submission requested by the response schema. The artifact is the task deliverable; the decision record is a concise stated rationale, not hidden chain-of-thought.",
        `<benchmark_input>\n${serialized(record.benchmarkInput)}\n</benchmark_input>`,
      ].join("\n\n"),
      text: Object.freeze({ format: candidateSubmissionFormat }),
    });
  }
  if (Object.hasOwn(record, "conversation") && typeof record.question === "string") {
    return Object.freeze({
      input: [
        "Answer the question using only the supplied conversation record.",
        `<conversation>\n${serialized(record.conversation)}\n</conversation>`,
        `<question>\n${record.question}\n</question>`,
      ].join("\n\n"),
    });
  }
  if (typeof record.caseId === "string" && typeof record.prompt === "string") {
    return Object.freeze({ input: record.prompt });
  }
  if (typeof record.prompt === "string") {
    return Object.freeze({ input: record.prompt });
  }
  return genericResponsesBody(value);
}

function judgeResponsesBody(value: unknown): JsonObject {
  const record = objectValue(value);
  if (record === undefined || Object.hasOwn(record, "input")) {
    return genericResponsesBody(value);
  }
  if (typeof record.prompt !== "string") return genericResponsesBody(value);
  const nativeTasteRequest = record.kind === "pointwise" || record.kind === "pairwise";
  return Object.freeze({
    input: record.prompt,
    ...(nativeTasteRequest
      ? { text: Object.freeze({ format: Object.freeze({ type: "json_object" }) }) }
      : {}),
  });
}

async function callResponses(input: {
  readonly endpoint: string;
  readonly capability: string;
  readonly model: string;
  readonly body: JsonObject;
}): Promise<unknown> {
  const response = await postBroker(input.endpoint, input.capability, {
    ...input.body,
    model: input.model,
    store: false,
  });
  return validateResponsesEnvelope(response);
}

export function createResponsesCandidateTransport(input: {
  readonly kind: "reference_model" | "agent_stack";
  readonly endpoint: string;
  readonly capability: string;
  readonly model: string;
  readonly evidenceRoot: string;
}): CandidateTransport {
  if (input.kind !== "reference_model" && input.kind !== "agent_stack") {
    throw new TypeError(
      "Responses candidate kind must be reference_model or agent_stack",
    );
  }
  if (input.capability.length === 0)
    throw new TypeError("scoped capability is required");
  if (input.model.length === 0) throw new TypeError("candidate model is required");
  return Object.freeze({
    kind: input.kind,
    run: async (request: unknown) => {
      const started = Date.now();
      try {
        const response = await callResponses({
          endpoint: input.endpoint,
          capability: input.capability,
          model: input.model,
          body: candidateResponsesBody(request),
        });
        const normalized = responseText(response);
        const output = artifactFromValue(
          input.evidenceRoot,
          normalized.value,
          normalized.mediaType,
        );
        const responseRecord =
          response !== null && typeof response === "object"
            ? (response as Record<string, unknown>)
            : {};
        const usage =
          responseRecord.usage !== null && typeof responseRecord.usage === "object"
            ? (responseRecord.usage as Record<string, unknown>)
            : {};
        return {
          state: "measured" as const,
          output,
          outputDigest: output.digest,
          latencyMs: Math.max(0, Date.now() - started),
          inputTokens:
            typeof usage.input_tokens === "number" ? usage.input_tokens : null,
          outputTokens:
            typeof usage.output_tokens === "number" ? usage.output_tokens : null,
        };
      } catch (error) {
        return {
          state:
            error instanceof ResponsesEnvelopeError
              ? error.outcome
              : error instanceof BrokerSessionUnavailableError
                ? ("unavailable" as const)
                : ("failed" as const),
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
  if (input.capability.length === 0)
    throw new TypeError("scoped capability is required");
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
          body: judgeResponsesBody(request),
        });
        const normalized = responseText(response);
        const verdict = artifactFromValue(
          input.evidenceRoot,
          normalized.value,
          normalized.mediaType,
        );
        const responseRecord =
          response !== null && typeof response === "object"
            ? (response as Record<string, unknown>)
            : {};
        const usage =
          responseRecord.usage !== null && typeof responseRecord.usage === "object"
            ? (responseRecord.usage as Record<string, unknown>)
            : {};
        return {
          state: "measured" as const,
          verdict,
          verdictDigest: verdict.digest,
          latencyMs: Math.max(0, Date.now() - started),
          inputTokens:
            typeof usage.input_tokens === "number" ? usage.input_tokens : null,
          outputTokens:
            typeof usage.output_tokens === "number" ? usage.output_tokens : null,
        };
      } catch (error) {
        return {
          state:
            error instanceof ResponsesEnvelopeError
              ? error.outcome
              : error instanceof BrokerSessionUnavailableError
                ? ("unavailable" as const)
                : ("failed" as const),
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
