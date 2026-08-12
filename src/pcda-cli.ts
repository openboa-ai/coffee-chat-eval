import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { calibratePcdaNativeResults } from "./pcda-receipt.ts";
import { runPcdaManualCampaign, type PcdaManualRequest } from "./pcda-runner.ts";

export const PCDA_BENCH_SIGNER_COMMIT =
  "b8b7328c0df402b0935b1bb390109164d689bb8f" as const;

export interface PcdaCliResult {
  readonly exitCode: number;
  readonly report: unknown;
}

function flags(argv: readonly string[]): ReadonlyMap<string, string> {
  if (argv.length % 2 !== 0) throw new Error("PCDA flags require name/value pairs");
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--")) {
      throw new Error("PCDA flags require --name value pairs");
    }
    if (parsed.has(name)) throw new Error(`duplicate PCDA flag: ${name}`);
    parsed.set(name, value);
  }
  return parsed;
}

function exactFlags(
  parsed: ReadonlyMap<string, string>,
  expected: readonly string[],
): void {
  const actual = [...parsed.keys()].sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((name, index) => name !== wanted[index])
  ) {
    throw new Error(`PCDA command requires exactly: ${expected.join(", ")}`);
  }
}

function required(parsed: ReadonlyMap<string, string>, name: string): string {
  const value = parsed.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readJson(path: string): unknown {
  if (!isAbsolute(path)) throw new Error("calibration evidence path must be absolute");
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function validateManualRequest(parsed: ReadonlyMap<string, string>): PcdaManualRequest {
  const benchRepo = required(parsed, "--bench-repo");
  const benchCommit = required(parsed, "--bench-commit");
  const casePath = required(parsed, "--case");
  const model = required(parsed, "--candidate-model");
  const credentialName = required(parsed, "--candidate-credential-env");
  const uvxPath = required(parsed, "--uvx-path");
  const uvxDigest = required(parsed, "--uvx-digest");
  const uvxVersion = required(parsed, "--uvx-version");
  const jobsRoot = required(parsed, "--jobs-root");
  if (!isAbsolute(benchRepo)) throw new Error("--bench-repo must be absolute");
  if (!/^[0-9a-f]{40}$/u.test(benchCommit)) {
    throw new Error("--bench-commit must be an exact lowercase commit");
  }
  if (benchCommit !== PCDA_BENCH_SIGNER_COMMIT) {
    throw new Error(`--bench-commit must be ${PCDA_BENCH_SIGNER_COMMIT}`);
  }
  if (casePath.startsWith("/") || casePath.split("/").includes("..")) {
    throw new Error("--case must be a repository-relative path");
  }
  if (model !== "gpt-5.6-terra") {
    throw new Error("--candidate-model must be gpt-5.6-terra");
  }
  if (
    credentialName === "OPENAI_API_KEY" ||
    !/^[A-Z][A-Z0-9_]{2,127}$/u.test(credentialName)
  ) {
    throw new Error(
      "--candidate-credential-env requires a dedicated parent credential name",
    );
  }
  if (!isAbsolute(uvxPath) || !isAbsolute(jobsRoot)) {
    throw new Error("--uvx-path and --jobs-root must be absolute");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(uvxDigest)) {
    throw new Error("--uvx-digest must be a sha256 digest");
  }
  return {
    benchRepo,
    benchCommit,
    casePath,
    candidateModel: model,
    credentialName,
    uvxPath,
    uvxDigest: uvxDigest as `sha256:${string}`,
    uvxVersion,
    jobsRoot,
  };
}

export interface PcdaCliDependencies {
  readonly runManual: (request: PcdaManualRequest) => Promise<PcdaCliResult>;
}

export async function runPcdaCli(
  argv: readonly string[],
  dependencies: PcdaCliDependencies = { runManual: runPcdaManualCampaign },
): Promise<PcdaCliResult> {
  const [command, ...rest] = argv;
  const parsed = flags(rest);
  if (command === "calibrate") {
    exactFlags(parsed, ["--oracle-result", "--noop-result"]);
    const report = calibratePcdaNativeResults({
      oracle: readJson(required(parsed, "--oracle-result")),
      noop: readJson(required(parsed, "--noop-result")),
    });
    return { exitCode: report.state === "accepted" ? 0 : 1, report };
  }
  if (command === "codex") {
    exactFlags(parsed, [
      "--bench-repo",
      "--bench-commit",
      "--case",
      "--candidate-model",
      "--candidate-credential-env",
      "--uvx-path",
      "--uvx-digest",
      "--uvx-version",
      "--jobs-root",
    ]);
    return dependencies.runManual(validateManualRequest(parsed));
  }
  throw new Error("usage: pcda-cli calibrate ... | codex ...");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  try {
    const result = await runPcdaCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result.report)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
