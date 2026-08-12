import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CONDITION_SPECS = [
  { benchCondition: "none", condition: "T0", directory: "t0" },
  { benchCondition: "a", condition: "T1-A", directory: "t1-a" },
  { benchCondition: "b", condition: "T1-B", directory: "t1-b" },
] as const;

type Digest = `sha256:${string}`;
type BenchCondition = (typeof CONDITION_SPECS)[number]["benchCondition"];
type PcdaCondition = (typeof CONDITION_SPECS)[number]["condition"];

const BENCH_SNAPSHOT_BRAND: unique symbol = Symbol("BenchSnapshot");

export interface BenchSnapshot {
  readonly root: string;
  readonly commit: string;
  readonly release: string;
  readonly archiveDigest: Digest;
  readonly bankDigest: Digest;
  readonly stagedTreeDigest: Digest;
  readonly [BENCH_SNAPSHOT_BRAND]: true;
}

export interface StageBenchSnapshotInput {
  readonly repo: string;
  readonly commit: string;
  readonly destination: string;
}

export interface ProjectPcdaFamilyInput {
  readonly snapshot: BenchSnapshot;
  readonly casePath: string;
  readonly destination: string;
}

export interface ProjectedPcdaCondition {
  readonly benchCommit: string;
  readonly archiveDigest: Digest;
  readonly bankDigest: Digest;
  readonly release: string;
  readonly caseSourceDigest: Digest;
  readonly benchCondition: BenchCondition;
  readonly condition: PcdaCondition;
  readonly candidateDigest: Digest;
  readonly verifierDigest: Digest;
  readonly projectionDigest: Digest;
  readonly executionTreeDigest: Digest;
  readonly trialId: string;
  readonly projectionRoot: string;
  readonly taskPath: string;
  readonly taskTomlPath: string;
  readonly perspectivePath: string | null;
  readonly candidateForbiddenFindings: readonly string[];
}

interface ProjectionReport {
  readonly release: string;
  readonly caseId: string;
  readonly condition: BenchCondition;
  readonly sourceDigest: Digest;
  readonly candidateDirectory: string;
  readonly verifierDirectory: string;
  readonly harborDirectory: string;
  readonly candidateDigest: Digest;
  readonly verifierDigest: Digest;
  readonly projectionDigest: Digest;
}

interface BenchSnapshotInspection {
  readonly root: string;
  readonly sourceRepository: string;
  readonly commit: string;
  readonly release: string;
  readonly archiveDigest: Digest;
  readonly bankDigest: Digest;
  readonly stagedTreeDigest: Digest;
}

const BENCH_SNAPSHOTS = new WeakSet<object>();
const BENCH_SNAPSHOT_INSPECTIONS = new WeakMap<object, BenchSnapshotInspection>();

function digestBytes(bytes: Buffer): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function computeStagedTreeDigest(root: string): Digest {
  const entries: Array<{
    path: string;
    type: "directory" | "file" | "symbolic-link";
    mode: number;
    bytes: Buffer;
  }> = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      const relativePath = relative(root, path).split(sep).join("/");
      if (stat.isDirectory()) {
        entries.push({
          path: relativePath,
          type: "directory",
          mode: stat.mode & 0o7777,
          bytes: Buffer.alloc(0),
        });
        visit(path);
      } else if (stat.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          mode: stat.mode & 0o7777,
          bytes: readFileSync(path),
        });
      } else if (stat.isSymbolicLink()) {
        entries.push({
          path: relativePath,
          type: "symbolic-link",
          mode: stat.mode & 0o7777,
          bytes: Buffer.from(readlinkSync(path), "utf8"),
        });
      } else {
        throw new Error(`staged tree contains an unsupported entry: ${relativePath}`);
      }
    }
  };
  visit(root);
  entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.path, "utf8");
    hash.update(
      Buffer.from(
        `${entry.type}\0${pathBytes.length}\0${entry.mode.toString(8)}\0${entry.bytes.length}\0`,
        "utf8",
      ),
    );
    hash.update(pathBytes);
    hash.update(Buffer.from([0]));
    hash.update(entry.bytes);
    hash.update(Buffer.from([0]));
  }
  return `sha256:${hash.digest("hex")}`;
}

function createBenchSnapshot(
  fields: Omit<BenchSnapshot, typeof BENCH_SNAPSHOT_BRAND>,
  sourceRepository: string,
): BenchSnapshot {
  const value = { ...fields } as Omit<BenchSnapshot, typeof BENCH_SNAPSHOT_BRAND> &
    Partial<Pick<BenchSnapshot, typeof BENCH_SNAPSHOT_BRAND>>;
  Object.defineProperty(value, BENCH_SNAPSHOT_BRAND, { value: true });
  Object.freeze(value);
  BENCH_SNAPSHOTS.add(value);
  BENCH_SNAPSHOT_INSPECTIONS.set(
    value,
    Object.freeze({
      root: fields.root,
      sourceRepository,
      commit: fields.commit,
      release: fields.release,
      archiveDigest: fields.archiveDigest,
      bankDigest: fields.bankDigest,
      stagedTreeDigest: fields.stagedTreeDigest,
    }),
  );
  return value as BenchSnapshot;
}

function verifyBenchSnapshot(snapshot: BenchSnapshot): void {
  if (!BENCH_SNAPSHOTS.has(snapshot)) {
    throw new Error("snapshot must be returned by stageBenchSnapshot");
  }
  const expected = BENCH_SNAPSHOT_INSPECTIONS.get(snapshot);
  if (expected === undefined) {
    throw new Error("staged Bench provenance evidence is missing");
  }
  if (
    snapshot.root !== expected.root ||
    realpathSync(snapshot.root) !== expected.root ||
    snapshot.commit !== expected.commit ||
    snapshot.release !== expected.release ||
    snapshot.archiveDigest !== expected.archiveDigest ||
    snapshot.bankDigest !== expected.bankDigest ||
    snapshot.stagedTreeDigest !== expected.stagedTreeDigest
  ) {
    throw new Error("staged Bench snapshot provenance changed after staging");
  }
  if (!COMMIT_PATTERN.test(expected.commit) || !isAbsolute(expected.sourceRepository)) {
    throw new Error("staged Bench commit provenance is invalid");
  }
  let canonicalSourceRepository: string;
  try {
    canonicalSourceRepository = realpathSync(expected.sourceRepository);
  } catch (error) {
    throw new Error("staged Bench source provenance is unavailable", {
      cause: error,
    });
  }
  if (canonicalSourceRepository !== expected.sourceRepository) {
    throw new Error("staged Bench source provenance is no longer canonical");
  }
  verifyExactCommit(expected.sourceRepository, expected.commit);
  if (
    computeGitArchiveDigest(expected.sourceRepository, expected.commit) !==
    expected.archiveDigest
  ) {
    throw new Error("staged Bench archive provenance changed after staging");
  }
  if (computeStagedTreeDigest(expected.root) !== expected.stagedTreeDigest) {
    throw new Error("staged tree digest changed after staging");
  }
}

export function computeExecutionTreeDigest(root: string): Digest {
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("execution tree root must be a regular directory");
  }
  const entries: Array<{
    path: string;
    type: "directory" | "file";
    mode: number;
    bytes: Buffer;
  }> = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      const relativePath = relative(root, path).split(sep).join("/");
      if (stat.isSymbolicLink()) {
        throw new Error(`execution tree contains a symbolic link: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        entries.push({
          path: relativePath,
          type: "directory",
          mode: stat.mode & 0o7777,
          bytes: Buffer.alloc(0),
        });
        visit(path);
      } else if (stat.isFile()) {
        entries.push({
          path: relativePath,
          type: "file",
          mode: stat.mode & 0o7777,
          bytes: readFileSync(path),
        });
      } else {
        throw new Error(`execution tree contains a non-regular entry: ${relativePath}`);
      }
    }
  };
  visit(root);
  entries.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.path, "utf8");
    hash.update(
      Buffer.from(
        `${entry.type}\0${pathBytes.length}\0${entry.mode.toString(8)}\0${entry.bytes.length}\0`,
        "utf8",
      ),
    );
    hash.update(pathBytes);
    hash.update(Buffer.from([0]));
    hash.update(entry.bytes);
    hash.update(Buffer.from([0]));
  }
  return `sha256:${hash.digest("hex")}`;
}

function requireDigest(value: unknown, name: string): Digest {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new Error(`${name} must be a sha256 digest`);
  }
  return value as Digest;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function parseJsonOutput(output: string, name: string): Record<string, unknown> {
  try {
    return record(JSON.parse(output), name);
  } catch (error) {
    throw new Error(`${name} returned invalid JSON`, { cause: error });
  }
}

function safePath(root: string, path: string, name: string): string {
  const absoluteRoot = realpathSync(resolve(root));
  const absolutePath = realpathSync(resolve(path));
  const child = relative(absoluteRoot, absolutePath);
  if (
    child === "" ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error(`${name} must be inside its declared root`);
  }
  return absolutePath;
}

function canonicalPendingPath(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) throw new Error("path has no existing ancestor");
    missing.unshift(basename(existing));
    existing = parent;
  }
  return join(realpathSync(existing), ...missing);
}

function rejectSymbolicLinks(root: string): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`symbolic links are not permitted: ${relative(root, path)}`);
      }
      if (stat.isDirectory()) visit(path);
      else if (!stat.isFile()) {
        throw new Error(`unsupported archive entry: ${relative(root, path)}`);
      }
    }
  };
  visit(root);
}

function stageEnvironment(home: string): NodeJS.ProcessEnv {
  mkdirSync(home, { recursive: true });
  return {
    HOME: home,
    LANG: "C.UTF-8",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    npm_config_cache: join(home, ".npm"),
  };
}

function runBench(root: string, args: readonly string[]): string {
  const home = mkdtempSync(join(tmpdir(), "pcda-bench-command-"));
  try {
    const output = execFileSync(
      "node",
      ["--experimental-strip-types", "src/cli.ts", ...args],
      {
        cwd: root,
        encoding: "utf8",
        env: stageEnvironment(home),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return output.trim();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function verifyExactCommit(repository: string, commit: string): void {
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error("commit must be a 40-character lowercase commit");
  }
  const status = execFileSync(
    "git",
    ["-C", repository, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" },
  ).trim();
  if (status.length > 0) throw new Error("Bench repository must be clean");

  let resolved: string;
  try {
    resolved = execFileSync(
      "git",
      ["-C", repository, "rev-parse", "--verify", `${commit}^{commit}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  } catch (error) {
    throw new Error("requested commit is missing from the Bench repository", {
      cause: error,
    });
  }
  if (resolved !== commit) throw new Error("requested commit did not resolve exactly");
  try {
    execFileSync(
      "git",
      ["-C", repository, "merge-base", "--is-ancestor", commit, "HEAD"],
      {
        stdio: "ignore",
      },
    );
  } catch (error) {
    throw new Error("requested commit is not reachable from Bench HEAD", {
      cause: error,
    });
  }
}

function computeGitArchiveDigest(repository: string, commit: string): Digest {
  const temporary = mkdtempSync(
    join(realpathSync(tmpdir()), "pcda-bench-archive-proof-"),
  );
  const archive = join(temporary, "bench.tar");
  try {
    execFileSync(
      "git",
      ["-C", repository, "archive", "--format=tar", "--output", archive, commit],
      { stdio: "ignore" },
    );
    return digestBytes(readFileSync(archive));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function stageBenchSnapshot(input: StageBenchSnapshotInput): BenchSnapshot {
  const repository = realpathSync(resolve(input.repo));
  const destination = canonicalPendingPath(input.destination);
  if (existsSync(destination)) throw new Error("destination must not exist");
  verifyExactCommit(repository, input.commit);

  mkdirSync(dirname(destination), { recursive: true });
  const temporary = mkdtempSync(join(dirname(destination), ".pcda-bench-stage-"));
  const snapshot = join(temporary, "snapshot");
  const archive = join(temporary, "bench.tar");
  mkdirSync(snapshot);

  try {
    execFileSync(
      "git",
      ["-C", repository, "archive", "--format=tar", "--output", archive, input.commit],
      { stdio: "ignore" },
    );
    const archiveDigest = digestBytes(readFileSync(archive));
    execFileSync("tar", ["-xf", archive, "-C", snapshot], { stdio: "ignore" });
    rejectSymbolicLinks(snapshot);

    if (!existsSync(join(snapshot, "package-lock.json"))) {
      throw new Error("staged Bench snapshot must contain package-lock.json");
    }
    execFileSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: snapshot,
      env: stageEnvironment(join(temporary, "home")),
      stdio: "ignore",
    });

    const packageJson = record(
      JSON.parse(readFileSync(join(snapshot, "package.json"), "utf8")),
      "Bench package.json",
    );
    const release = requireString(packageJson.version, "Bench release");
    const campaignRoot = join(snapshot, "bank", "campaign");
    const campaign = record(
      JSON.parse(readFileSync(join(campaignRoot, "campaign.json"), "utf8")),
      "Bench campaign metadata",
    );
    if (campaign.release !== release || campaign.auditState !== "valid") {
      throw new Error("staged Bench campaign metadata is not valid for its release");
    }
    const bankDigest = requireDigest(
      campaign.selectedBankDigest,
      "Bench selected bank digest",
    );
    for (const partition of ["development", "calibration", "release", "bridge"]) {
      const validation = parseJsonOutput(
        runBench(snapshot, ["validate", join(campaignRoot, partition)]),
        "Bench validate command",
      );
      if (validation.state !== "valid") {
        throw new Error(`staged Bench ${partition} partition validation failed`);
      }
      requireDigest(validation.digest, `Bench ${partition} partition digest`);
    }

    renameSync(snapshot, destination);
    rmSync(temporary, { recursive: true, force: true });
    const canonicalRoot = realpathSync(destination);
    const stagedTreeDigest = computeStagedTreeDigest(canonicalRoot);
    return createBenchSnapshot(
      {
        root: canonicalRoot,
        commit: input.commit,
        release,
        archiveDigest,
        bankDigest,
        stagedTreeDigest,
      },
      repository,
    );
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function scanObjectForSealedKeys(
  value: unknown,
  path: string,
  findings: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      scanObjectForSealedKeys(entry, `${path}[${index}]`, findings),
    );
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (["acceptedRegions", "judgment", "oracle"].includes(key)) {
      findings.push(`${path}:${key}`);
    }
    scanObjectForSealedKeys(entry, `${path}.${key}`, findings);
  }
}

function candidateForbiddenFindings(roots: readonly string[]): readonly string[] {
  const findings: string[] = [];
  const visit = (root: string, directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const file = relative(root, path).split(sep).join("/");
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        findings.push(`${file}:symbolic-link`);
        continue;
      }
      if (/(^|[-_.])(judgment|oracle|verifier)([-_.]|$)/iu.test(entry.name)) {
        findings.push(`${file}:sealed-name`);
      }
      if (stat.isDirectory()) visit(root, path);
      else if (stat.isFile() && entry.name.endsWith(".json")) {
        try {
          scanObjectForSealedKeys(
            JSON.parse(readFileSync(path, "utf8")),
            file,
            findings,
          );
        } catch {
          findings.push(`${file}:invalid-json`);
        }
      }
    }
  };
  roots.forEach((root) => visit(root, root));
  return findings.sort();
}

function parseProjectionReport(
  value: Record<string, unknown>,
  expectedRoot: string,
  benchCondition: BenchCondition,
  snapshot: BenchSnapshot,
): ProjectionReport {
  if (value.release !== snapshot.release || value.condition !== benchCondition) {
    throw new Error("Bench projection returned an unexpected release or condition");
  }
  const report: ProjectionReport = {
    release: snapshot.release,
    caseId: requireString(value.caseId, "projection caseId"),
    condition: benchCondition,
    sourceDigest: requireDigest(value.sourceDigest, "projection sourceDigest"),
    candidateDirectory: safePath(
      expectedRoot,
      requireString(value.candidateDirectory, "candidateDirectory"),
      "candidateDirectory",
    ),
    verifierDirectory: safePath(
      expectedRoot,
      requireString(value.verifierDirectory, "verifierDirectory"),
      "verifierDirectory",
    ),
    harborDirectory: safePath(
      expectedRoot,
      requireString(value.harborDirectory, "harborDirectory"),
      "harborDirectory",
    ),
    candidateDigest: requireDigest(value.candidateDigest, "candidateDigest"),
    verifierDigest: requireDigest(value.verifierDigest, "verifierDigest"),
    projectionDigest: requireDigest(value.projectionDigest, "projectionDigest"),
  };
  for (const path of [
    report.candidateDirectory,
    report.verifierDirectory,
    report.harborDirectory,
  ]) {
    if (!lstatSync(path).isDirectory())
      throw new Error("projection path must be a directory");
  }
  return report;
}

export function projectPcdaFamily(
  input: ProjectPcdaFamilyInput,
): readonly ProjectedPcdaCondition[] {
  verifyBenchSnapshot(input.snapshot);
  const destination = canonicalPendingPath(input.destination);
  if (existsSync(destination)) throw new Error("projection destination must not exist");
  if (isAbsolute(input.casePath) || input.casePath.split(/[\\/]/u).includes("..")) {
    throw new Error(
      "casePath must be a relative path inside the staged Bench snapshot",
    );
  }
  const snapshotRoot = realpathSync(input.snapshot.root);
  const caseFile = safePath(
    snapshotRoot,
    join(snapshotRoot, input.casePath),
    "casePath",
  );
  if (!lstatSync(caseFile).isFile()) throw new Error("casePath must be a regular file");
  const caseSource = record(JSON.parse(readFileSync(caseFile, "utf8")), "PCDA case");
  const caseSourceDigest = requireDigest(caseSource.sourceDigest, "case sourceDigest");
  mkdirSync(destination, { recursive: false });

  return Object.freeze(
    CONDITION_SPECS.map((spec) => {
      const requestedProjectionRoot = join(destination, spec.directory);
      const args = [
        "project",
        caseFile,
        spec.benchCondition,
        requestedProjectionRoot,
      ] as const;
      verifyBenchSnapshot(input.snapshot);
      const rawReport = runBench(snapshotRoot, args);
      verifyBenchSnapshot(input.snapshot);
      const report = parseProjectionReport(
        parseJsonOutput(rawReport, "Bench project command"),
        requestedProjectionRoot,
        spec.benchCondition,
        input.snapshot,
      );
      const projectionRoot = realpathSync(requestedProjectionRoot);
      if (report.sourceDigest !== caseSourceDigest) {
        throw new Error("projection source digest does not match the selected case");
      }
      const task = record(
        JSON.parse(readFileSync(join(report.candidateDirectory, "task.json"), "utf8")),
        "candidate task",
      );
      if (task.condition !== spec.condition) {
        throw new Error("Bench condition mapping does not match T0/T1-A/T1-B");
      }
      const trialId = requireString(task.trialId, "trialId");
      if (!/^trial-[0-9a-f]{64}$/u.test(trialId)) {
        throw new Error("trialId must be a stable trial identity");
      }
      const requestedPerspectivePath = join(
        report.candidateDirectory,
        "perspective.json",
      );
      if (spec.condition === "T0" && existsSync(requestedPerspectivePath)) {
        throw new Error("T0 candidate projection must not contain a perspective");
      }
      if (spec.condition !== "T0" && !existsSync(requestedPerspectivePath)) {
        throw new Error(
          `${spec.condition} candidate projection must contain its perspective`,
        );
      }
      const findings = candidateForbiddenFindings([
        report.candidateDirectory,
        join(report.harborDirectory, "environment"),
      ]);
      if (findings.length > 0) {
        throw new Error(
          `candidate-visible projection contains sealed data: ${findings.join(", ")}`,
        );
      }
      return Object.freeze({
        benchCommit: input.snapshot.commit,
        archiveDigest: input.snapshot.archiveDigest,
        bankDigest: input.snapshot.bankDigest,
        release: input.snapshot.release,
        caseSourceDigest,
        benchCondition: spec.benchCondition,
        condition: spec.condition,
        candidateDigest: report.candidateDigest,
        verifierDigest: report.verifierDigest,
        projectionDigest: report.projectionDigest,
        executionTreeDigest: computeExecutionTreeDigest(projectionRoot),
        trialId,
        projectionRoot,
        taskPath: report.harborDirectory,
        taskTomlPath: realpathSync(join(report.harborDirectory, "task.toml")),
        perspectivePath:
          spec.condition === "T0" ? null : realpathSync(requestedPerspectivePath),
        candidateForbiddenFindings: findings,
      });
    }),
  );
}
