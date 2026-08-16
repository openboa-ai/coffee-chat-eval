import { join } from "node:path";

import { stableDigest } from "./identity.ts";

export const BENCHMARK_CONDITIONS = [
  "task_only",
  "nondiagnostic_target_a",
  "nondiagnostic_target_b",
  "diagnostic_target_a",
  "diagnostic_target_b",
] as const;

export type BenchmarkCondition = (typeof BENCHMARK_CONDITIONS)[number];
export type DiagnosticTarget = "a" | "b";

type Digest = `sha256:${string}`;

export interface ProjectionTask {
  readonly caseId: string;
  readonly condition: BenchmarkCondition;
  readonly trialId: string;
  readonly taskDigest: Digest;
  readonly directory: string;
  readonly taskBytesDigest: Digest;
}

export interface ProjectionManifest {
  readonly release: string;
  readonly harborTaskSchema: "1.4";
  readonly bankDigest: Digest;
  readonly tasks: readonly ProjectionTask[];
  readonly projectionDigest: Digest;
}

export interface BaselineTask extends ProjectionTask {
  readonly path: string;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const trialPattern = /^trial-[0-9a-f]{24}$/u;
const directoryPattern = /^task-[0-9a-f]{24}$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  if (
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())
  ) {
    throw new TypeError("projection manifest has unexpected fields");
  }
}

function digest(value: unknown, label: string): Digest {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return value as Digest;
}

function parseTask(value: unknown): ProjectionTask {
  const task = record(value);
  if (task === undefined) throw new TypeError("projection task must be an object");
  exactKeys(task, [
    "caseId",
    "condition",
    "trialId",
    "taskDigest",
    "directory",
    "taskBytesDigest",
  ]);
  if (typeof task.caseId !== "string" || task.caseId.length === 0) {
    throw new TypeError("projection task caseId must not be empty");
  }
  if (!BENCHMARK_CONDITIONS.includes(task.condition as BenchmarkCondition)) {
    throw new TypeError("projection task condition is unsupported");
  }
  if (typeof task.trialId !== "string" || !trialPattern.test(task.trialId)) {
    throw new TypeError("projection task trialId is invalid");
  }
  if (typeof task.directory !== "string" || !directoryPattern.test(task.directory)) {
    throw new TypeError("projection task directory is invalid");
  }
  return {
    caseId: task.caseId,
    condition: task.condition as BenchmarkCondition,
    trialId: task.trialId,
    taskDigest: digest(task.taskDigest, "projection task digest"),
    directory: task.directory,
    taskBytesDigest: digest(task.taskBytesDigest, "projection task bytes digest"),
  };
}

export function parseProjectionManifest(value: unknown): ProjectionManifest {
  const manifest = record(value);
  if (manifest === undefined)
    throw new TypeError("projection manifest must be an object");
  exactKeys(manifest, [
    "release",
    "harborTaskSchema",
    "bankDigest",
    "tasks",
    "projectionDigest",
  ]);
  if (
    typeof manifest.release !== "string" ||
    manifest.harborTaskSchema !== "1.4" ||
    !Array.isArray(manifest.tasks)
  ) {
    throw new TypeError("projection manifest header is invalid");
  }
  const tasks = manifest.tasks.map(parseTask);
  if (tasks.length !== 80)
    throw new TypeError("projection must contain exactly 80 tasks");
  const identities = new Set(tasks.map((task) => `${task.caseId}\0${task.condition}`));
  const directories = new Set(tasks.map(({ directory }) => directory));
  if (identities.size !== 80 || directories.size !== 80) {
    throw new TypeError("projection tasks must have unique case-condition identities");
  }
  const semantic = {
    release: manifest.release,
    harborTaskSchema: "1.4" as const,
    bankDigest: digest(manifest.bankDigest, "bank digest"),
    tasks,
  };
  const projectionDigest = digest(manifest.projectionDigest, "projection digest");
  if (stableDigest(semantic) !== projectionDigest) {
    throw new TypeError("projection digest does not match its manifest");
  }
  return Object.freeze({ ...semantic, tasks: Object.freeze(tasks), projectionDigest });
}

export function selectBaselineTasks(input: {
  readonly manifest: ProjectionManifest;
  readonly projectionRoot: string;
  readonly caseId: string;
  readonly diagnosticTarget: DiagnosticTarget;
}): readonly [BaselineTask, BaselineTask] {
  const conditions = [
    "task_only",
    `diagnostic_target_${input.diagnosticTarget}`,
  ] as const;
  const selected = conditions.map((condition) => {
    const task = input.manifest.tasks.find(
      (candidate) =>
        candidate.caseId === input.caseId && candidate.condition === condition,
    );
    if (task === undefined)
      throw new TypeError(`projection lacks ${input.caseId}/${condition}`);
    return Object.freeze({ ...task, path: join(input.projectionRoot, task.directory) });
  });
  return Object.freeze(selected) as readonly [BaselineTask, BaselineTask];
}
