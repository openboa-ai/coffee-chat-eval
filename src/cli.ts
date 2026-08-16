import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseProjectionManifest, selectBaselineTasks } from "./bench.ts";
import { createDryRunRegistry } from "./registry.ts";
import { formatDryRunReport } from "./report.ts";
import { readBoundedJson } from "./resources.ts";
import { runCodexCandidate } from "./codex-runner.ts";
import { runOracleControl } from "./runner.ts";

const MANIFEST_BYTES = 2 * 1024 * 1024;

function flags(args: readonly string[]): ReadonlyMap<string, string> {
  if (args.length % 2 !== 0) throw new TypeError("flags require --name value pairs");
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]!;
    const value = args[index + 1]!;
    if (!name.startsWith("--") || parsed.has(name))
      throw new TypeError("invalid flags");
    parsed.set(name, value);
  }
  return parsed;
}

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined || value.length === 0) throw new TypeError(`missing ${name}`);
  return value;
}

export async function runCli(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === "dry-run") {
    process.stdout.write(`${formatDryRunReport(createDryRunRegistry())}\n`);
    return;
  }
  if (args[0] !== "oracle-control" && args[0] !== "codex-baseline") {
    throw new TypeError(
      "usage: coffee-chat-eval dry-run | oracle-control | codex-baseline --projection-root PATH --case-id ID --diagnostic-target a|b --bench-commit SHA --harbor-command PATH --jobs-root PATH",
    );
  }
  const values = flags(args.slice(1));
  const projectionRoot = resolve(required(values, "--projection-root"));
  const target = required(values, "--diagnostic-target");
  if (target !== "a" && target !== "b")
    throw new TypeError("diagnostic target must be a or b");
  const manifest = parseProjectionManifest(
    readBoundedJson(
      resolve(projectionRoot, "projection-manifest.json"),
      MANIFEST_BYTES,
      "projection manifest",
    ),
  );
  const tasks = selectBaselineTasks({
    manifest,
    projectionRoot,
    caseId: required(values, "--case-id"),
    diagnosticTarget: target,
  });
  const jobsRoot = resolve(required(values, "--jobs-root"));
  mkdirSync(jobsRoot, { recursive: false });
  const benchmarkCommit = required(values, "--bench-commit");
  const harborCommand = resolve(required(values, "--harbor-command"));
  const receipts =
    args[0] === "oracle-control"
      ? tasks.map((task, index) =>
          runOracleControl({
            task,
            manifest,
            benchmarkCommit,
            harborCommand,
            jobsRoot: resolve(jobsRoot, String(index)),
          }),
        )
      : await Promise.all(
          tasks.map((task, index) => {
            const apiKey = process.env.OPENAI_API_KEY;
            if (apiKey === undefined || apiKey.length === 0) {
              throw new TypeError("OPENAI_API_KEY environment variable is required");
            }
            return runCodexCandidate({
              task,
              manifest,
              benchmarkCommit,
              harborCommand,
              jobsRoot: resolve(jobsRoot, String(index)),
              model: required(values, "--model"),
              apiKey,
            });
          }),
        );
  const serialized = `${JSON.stringify(receipts, null, 2)}\n`;
  writeFileSync(resolve(jobsRoot, "receipts.json"), serialized, { flag: "wx" });
  process.stdout.write(serialized);
}

if (process.argv[1]?.endsWith("/cli.ts")) {
  void runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
