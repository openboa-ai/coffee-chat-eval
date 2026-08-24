import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  executeTasteBench,
  TASTE_JUDGE_MODEL,
  TASTE_SOURCE,
  type TasteBenchApi,
} from "../../src/taste.ts";
import { parseRuntimeBundleConfig } from "../../src/runtime-config.ts";
import {
  createFixtureCandidateTransport,
  createResponsesCandidateTransport,
  createResponsesJudgeTransport,
} from "../../src/transports.ts";

function flags(args: readonly string[]): ReadonlyMap<string, string> {
  if (args.length % 2 !== 0) throw new TypeError("flags require --name value pairs");
  const result = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!;
    const value = args[index + 1]!;
    if (!name.startsWith("--") || result.has(name))
      throw new TypeError("invalid bridge flags");
    result.set(name, value);
  }
  return result;
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined || value.length === 0) throw new TypeError(`missing ${name}`);
  return value;
}

function writeOnce(path: string, value: unknown): void {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  mkdirSync(resolve(path, ".."), { recursive: true });
  try {
    writeFileSync(path, serialized, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
      throw error;
    if (readFileSync(path, "utf8") !== serialized)
      throw new TypeError("append-only Bench evidence path contains different bytes");
  }
}

async function main(): Promise<void> {
  const values = flags(process.argv.slice(2));
  const cacheRoot = resolve(required(values, "--cache-root"));
  const evidenceRoot = resolve(required(values, "--evidence-root"));
  const sourceRoot = resolve(
    values.get("--source-root") ?? resolve(cacheRoot, "coffee-chat-taste", "source"),
  );
  const runtimeConfigPath = values.get("--runtime-config");
  const outputPath = resolve(
    values.get("--output") ?? resolve(evidenceRoot, "taste-native.json"),
  );
  const benchCommit = required(values, "--bench-commit");
  const judgeModel = required(values, "--judge-model");
  const profile =
    values.get("--profile") === "score"
      ? "score"
      : values.get("--profile") === "pilot"
        ? "pilot"
        : "smoke";
  for (const [label, path] of [
    ["cache-root", cacheRoot],
    ["evidence-root", evidenceRoot],
    ["source-root", sourceRoot],
  ] as const) {
    if (!isAbsolute(path)) throw new TypeError(`${label} must be absolute`);
  }
  if (benchCommit !== TASTE_SOURCE.commit)
    throw new TypeError("Bench commit is not the admitted pin");
  if (judgeModel !== TASTE_JUDGE_MODEL)
    throw new TypeError("Judge model is not the provisional pin");
  const evaluatorModule = resolve(sourceRoot, "src/evaluator.ts");
  const api = (await import(evaluatorModule)) as TasteBenchApi;
  const bank = JSON.parse(
    readFileSync(resolve(sourceRoot, "bank/bank.json"), "utf8"),
  ) as { cases: readonly { casePath: string }[] };
  const first = bank.cases?.[0];
  if (first === undefined) throw new TypeError("Bench bank has no cases");
  const manifest = JSON.parse(
    readFileSync(resolve(sourceRoot, "bank", first.casePath), "utf8"),
  ) as unknown;
  const manifestForFamily = (family: { readonly ordinal: number }) => {
    const entry = bank.cases?.[family.ordinal];
    if (entry === undefined)
      throw new TypeError(`Bench family is missing: ${family.ordinal}`);
    const familyPath = resolve(sourceRoot, "bank", entry.casePath);
    if (!familyPath.startsWith(`${sourceRoot}/`))
      throw new TypeError("Bench family manifest escapes source root");
    return JSON.parse(readFileSync(familyPath, "utf8")) as unknown;
  };
  const runtime =
    runtimeConfigPath === undefined
      ? undefined
      : parseRuntimeBundleConfig(
          JSON.parse(readFileSync(resolve(runtimeConfigPath), "utf8")) as unknown,
        );
  const candidate =
    runtime === undefined
      ? createFixtureCandidateTransport(
          () => ({
            artifact: { mediaType: "text/plain", content: "fixture" },
            decisionRecord: {
              decision: "fixture",
              evidenceUse: [],
              tradeoffs: [],
              constraints: [],
              uncertainty: null,
            },
          }),
          { evidenceRoot },
        )
      : createResponsesCandidateTransport({
          kind: "agent_stack",
          endpoint: runtime.candidate.endpoint,
          capability: runtime.candidate.capabilityToken,
          model: runtime.candidate.model,
          evidenceRoot,
        });
  if (runtime?.judge === undefined)
    throw new TypeError("Bench smoke requires a separate Judge runtime capability");
  const judge = createResponsesJudgeTransport({
    endpoint: runtime.judge.endpoint,
    capability: runtime.judge.capabilityToken,
    model: runtime.judge.model,
    evidenceRoot,
  });
  const result = await executeTasteBench({
    profile,
    manifest,
    manifestForFamily,
    api,
    candidate,
    judge,
  });
  writeOnce(outputPath, {
    schema: "coffee-chat-eval/coffee-chat-taste-v1",
    sourceCommit: benchCommit,
    profile,
    result,
  });
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
