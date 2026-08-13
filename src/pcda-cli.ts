import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

import { calibratePcdaNativeResults } from "./pcda-receipt.ts";
import { PCDA_CALIBRATION_RESULT_BYTES, readBoundedJson } from "./pcda-resources.ts";

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

function readCalibration(path: string, label: string): unknown {
  if (!isAbsolute(path)) throw new Error(`${label} path must be absolute`);
  return readBoundedJson(path, PCDA_CALIBRATION_RESULT_BYTES, label);
}

export async function runPcdaCli(argv: readonly string[]): Promise<PcdaCliResult> {
  const [command, ...rest] = argv;
  const parsed = flags(rest);
  if (command !== "calibrate") {
    throw new Error(
      "usage: pcda-cli calibrate --oracle-result PATH --noop-result PATH",
    );
  }
  exactFlags(parsed, ["--oracle-result", "--noop-result"]);
  const report = calibratePcdaNativeResults({
    oracle: readCalibration(required(parsed, "--oracle-result"), "Oracle result"),
    noop: readCalibration(required(parsed, "--noop-result"), "no-op result"),
  });
  return { exitCode: report.state === "accepted" ? 0 : 1, report };
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
