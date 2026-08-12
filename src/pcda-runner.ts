import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attestAndJudgeWithStagedBench,
  projectPcdaFamily,
  stageBenchSnapshot,
} from "./pcda-bench.ts";
import {
  buildPcdaHarborArgs,
  executePcdaSpawn,
  resolveUvxTool,
} from "./pcda-harbor.ts";
import {
  authorizeCombinedBudget,
  buildPcdaCampaignReceipt,
  buildPcdaFailureReceipt,
  buildUnsignedPcdaAttestation,
  parsePcdaNativeResult,
  type Digest,
  type PcdaConditionEvidence,
} from "./pcda-receipt.ts";

const CAMPAIGN_CAP_NANO_USD = 50_000_000_000;
const CANDIDATE_RESERVATION_NANO_USD = 20_000_000_000;
const CANDIDATE_CALL_RESERVATION_NANO_USD = 6_000_000_000;
const LIVE_TIMEOUT_MS = 30 * 60 * 1_000;

export function debitJudgeCost(
  remainingNanoUsd: number,
  settledNanoUsd: number | undefined,
): number {
  if (settledNanoUsd === undefined) {
    throw new Error("judge cost evidence is unavailable");
  }
  if (
    !Number.isSafeInteger(settledNanoUsd) ||
    settledNanoUsd < 0 ||
    settledNanoUsd > remainingNanoUsd
  ) {
    throw new Error("combined campaign cost exceeded USD 50");
  }
  return remainingNanoUsd - settledNanoUsd;
}

export function settleJudgeCost(input: {
  readonly judgeState:
    | "measured"
    | "judge_disagreement"
    | "judge_unavailable"
    | "candidate_invalid"
    | "candidate_failure"
    | "verifier_failure"
    | "unmeasured";
  readonly settledNanoUsd?: number;
}): number {
  if (input.settledNanoUsd !== undefined) return input.settledNanoUsd;
  if (
    input.judgeState === "candidate_invalid" ||
    input.judgeState === "candidate_failure" ||
    input.judgeState === "verifier_failure"
  ) {
    return 0;
  }
  throw new Error("judge cost evidence is unavailable");
}

export interface PcdaManualRequest {
  readonly benchRepo: string;
  readonly benchCommit: string;
  readonly casePath: string;
  readonly candidateModel: "gpt-5.6-terra";
  readonly credentialName: string;
  readonly uvxPath: string;
  readonly uvxDigest: Digest;
  readonly uvxVersion: string;
  readonly jobsRoot: string;
}

function artifactManifestDigest(path: string): Digest {
  const artifact = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const manifest =
    artifact !== null && typeof artifact === "object" && !Array.isArray(artifact)
      ? (artifact as Record<string, unknown>).manifest
      : undefined;
  const value =
    manifest !== null && typeof manifest === "object" && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).artifactDigest
      : undefined;
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error("candidate artifact manifest must contain artifactDigest");
  }
  return value as Digest;
}

export function locatePcdaTrialResult(jobDirectory: string): string {
  const root = resolve(jobDirectory);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Harbor jobs root must be a real directory");
  }
  const jobs = readdirSync(root, { withFileTypes: true }).filter((entry) =>
    /^coffee-chat-pcda-(?:t0|t1-a|t1-b)$/u.test(entry.name),
  );
  if (jobs.length !== 1 || jobs[0]!.isSymbolicLink() || !jobs[0]!.isDirectory()) {
    throw new Error("Harbor jobs root must contain exactly one native job");
  }
  const job = join(root, jobs[0]!.name);
  const trials = readdirSync(job, { withFileTypes: true }).filter((entry) =>
    /^harbor__[A-Za-z0-9_-]+$/u.test(entry.name),
  );
  if (trials.length !== 1 || trials[0]!.isSymbolicLink() || !trials[0]!.isDirectory()) {
    throw new Error("Harbor job must contain exactly one native trial");
  }
  const result = join(job, trials[0]!.name, "result.json");
  const resultStat = lstatSync(result);
  if (resultStat.isSymbolicLink() || !resultStat.isFile()) {
    throw new Error("Harbor native trial result must be a real file");
  }
  return result;
}

function requireHarborOutputArtifact(trial: string): string {
  const artifacts = join(trial, "artifacts");
  const manifestPath = join(artifacts, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error("Harbor artifact manifest is missing");
  }
  const manifestStat = lstatSync(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error("Harbor artifact manifest must be a real file");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new Error("Harbor artifact manifest must be valid JSON");
  }
  if (!Array.isArray(manifest)) {
    throw new Error("Harbor artifact manifest must be an array");
  }
  const outputs = manifest.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).source === "/app/output.json",
  );
  const output = outputs[0] as Record<string, unknown> | undefined;
  if (
    outputs.length !== 1 ||
    output?.destination !== "artifacts/app/output.json" ||
    output.type !== "file" ||
    output.status !== "ok" ||
    output.service !== null
  ) {
    throw new Error("Harbor artifact manifest must record one successful output");
  }
  const artifactPath = join(artifacts, "app", "output.json");
  if (!existsSync(artifactPath)) {
    throw new Error("Harbor output artifact is missing");
  }
  const artifactStat = lstatSync(artifactPath);
  if (artifactStat.isSymbolicLink() || !artifactStat.isFile()) {
    throw new Error("Harbor output artifact must be a real file");
  }
  return artifactPath;
}

type PcdaDeterministicVerdict = {
  readonly state:
    "unmeasured" | "candidate_invalid" | "candidate_failure" | "verifier_failure";
  readonly accepted: boolean;
  readonly criticalFailure: boolean;
  readonly reasonCode:
    "none" | "candidate_invalid" | "candidate_failure" | "verifier_failure";
};

function requireHarborVerifierVerdict(
  trial: string,
  nativeState: "accepted" | "rejected",
): PcdaDeterministicVerdict {
  const path = join(trial, "verifier", "verdict.json");
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Harbor verifier verdict must be a real file");
  }
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Harbor verifier verdict must be an object");
  }
  const verdict = value as Record<string, unknown>;
  if (
    Object.keys(verdict).sort().join(",") !==
      "accepted,criticalFailure,reasons,state" ||
    typeof verdict.accepted !== "boolean" ||
    typeof verdict.criticalFailure !== "boolean" ||
    !Array.isArray(verdict.reasons) ||
    !verdict.reasons.every((reason) => typeof reason === "string")
  ) {
    throw new Error("Harbor verifier verdict has an invalid shape");
  }
  const state = verdict.state;
  if (
    state !== "unmeasured" &&
    state !== "candidate_invalid" &&
    state !== "candidate_failure" &&
    state !== "verifier_failure"
  ) {
    throw new Error("Harbor verifier verdict has an invalid state");
  }
  const accepted = verdict.accepted;
  const criticalFailure = verdict.criticalFailure;
  if (
    (nativeState === "accepted" &&
      (state !== "unmeasured" || !accepted || criticalFailure)) ||
    (nativeState === "rejected" && (state === "unmeasured" || accepted))
  ) {
    throw new Error("Harbor reward and verifier verdict disagree");
  }
  return {
    state,
    accepted,
    criticalFailure,
    reasonCode: state === "unmeasured" ? "none" : state,
  };
}

export function inspectPcdaTrial(
  jobDirectory: string,
  candidateModel: "gpt-5.6-terra",
): {
  native: ReturnType<typeof parsePcdaNativeResult>;
  deterministic: PcdaDeterministicVerdict;
  artifactPath: string;
  artifactDigest: Digest;
  settledNanoUsd: number | null;
} {
  const resultPath = locatePcdaTrialResult(jobDirectory);
  const raw = JSON.parse(readFileSync(resultPath, "utf8")) as unknown;
  const native = parsePcdaNativeResult(raw, {
    agentName: "codex",
    agentVersion: "0.147.0",
    modelName: candidateModel,
  });
  if (native.state === "invalid") throw new Error(native.reason);
  const trial = dirname(resultPath);
  const artifactPath = requireHarborOutputArtifact(trial);
  const settledNanoUsd = candidateSettledNanoUsd(raw);
  return {
    native,
    deterministic: requireHarborVerifierVerdict(trial, native.state),
    artifactPath,
    artifactDigest: artifactManifestDigest(artifactPath),
    settledNanoUsd,
  };
}

export function candidateSettledNanoUsd(raw: unknown): number | null {
  const agentResult =
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).agent_result
      : undefined;
  const agent =
    agentResult !== null &&
    typeof agentResult === "object" &&
    !Array.isArray(agentResult)
      ? (agentResult as Record<string, unknown>)
      : undefined;
  const boundedTokens = (value: unknown, label: string): number | null => {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10 ** 12) {
      throw new Error(`${label} must be a bounded token count`);
    }
    return Number(value);
  };
  const inputTokens = boundedTokens(agent?.n_input_tokens, "n_input_tokens");
  boundedTokens(agent?.n_cache_tokens, "n_cache_tokens");
  const outputTokens = boundedTokens(agent?.n_output_tokens, "n_output_tokens");
  const reportedCost = agent?.cost_usd;
  if (
    reportedCost !== null &&
    reportedCost !== undefined &&
    (typeof reportedCost !== "number" ||
      !Number.isFinite(reportedCost) ||
      reportedCost < 0)
  ) {
    throw new Error("native Harbor candidate cost must be non-negative");
  }
  const estimatedCost =
    inputTokens === null && outputTokens === null
      ? null
      : ((inputTokens ?? 0) * 2 + (outputTokens ?? 0) * 12) / 1_000_000;
  const costUsd =
    typeof reportedCost === "number"
      ? Math.max(reportedCost, estimatedCost ?? 0)
      : estimatedCost;
  const settledNanoUsd = costUsd === null ? null : Math.ceil(costUsd * 1_000_000_000);
  if (
    settledNanoUsd !== null &&
    (!Number.isSafeInteger(settledNanoUsd) || settledNanoUsd > CAMPAIGN_CAP_NANO_USD)
  ) {
    throw new Error("native Harbor candidate settled cost exceeds the campaign cap");
  }
  return settledNanoUsd;
}

function dockerContainers(): Set<string> {
  const output = execFileSync("docker", ["ps", "--all", "--quiet"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Set(output.split(/\s+/u).filter(Boolean));
}

function currentDockerHost(): string {
  const value = execFileSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
  if (value === "") throw new Error("current Docker context has no endpoint");
  return value;
}

function loadNamedCredential(name: string): string {
  const value = process.env[name];
  if (value === undefined) throw new Error(`credential ${name} is not available`);
  return value;
}

function benchInvoke(input: {
  command: string;
  args: readonly string[];
  environment: Readonly<Record<string, string>>;
}): Promise<{ exitCode: number; stdout: string }> {
  const secrets = [
    input.environment.OPENAI_API_KEY,
    input.environment.COFFEE_CHAT_EVAL_ATTESTATION_KEY,
  ].filter((value): value is string => typeof value === "string" && value !== "");
  try {
    const stdout = execFileSync(input.command, [...input.args], {
      encoding: "utf8",
      env: { ...input.environment },
      maxBuffer: 1_000_000,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60 * 1_000,
    });
    if (secrets.some((secret) => stdout.includes(secret))) {
      throw new Error("Bench child output contained credential material");
    }
    return Promise.resolve({ exitCode: 0, stdout });
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    const stdout = Buffer.isBuffer(failure.stdout)
      ? failure.stdout.toString("utf8")
      : String(failure.stdout ?? "");
    const stderr = Buffer.isBuffer(failure.stderr)
      ? failure.stderr.toString("utf8")
      : String(failure.stderr ?? "");
    if (secrets.some((secret) => stdout.includes(secret) || stderr.includes(secret))) {
      throw new Error("Bench child output contained credential material");
    }
    return Promise.resolve({
      exitCode: Number.isSafeInteger(failure.status) ? Number(failure.status) : 1,
      stdout,
    });
  }
}

export async function runPcdaManualCampaign(
  request: PcdaManualRequest,
): Promise<{ readonly exitCode: number; readonly report: unknown }> {
  const evaluatorRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const evaluatorCommit = execFileSync(
    "git",
    ["-C", evaluatorRoot, "rev-parse", "HEAD"],
    {
      encoding: "utf8",
    },
  ).trim();
  const evaluatorTreeClean =
    execFileSync("git", ["-C", evaluatorRoot, "status", "--porcelain"], {
      encoding: "utf8",
    }).trim().length === 0;
  if (!evaluatorTreeClean)
    throw new Error("manual PCDA run requires a clean evaluator commit");

  const reservation = authorizeCombinedBudget({
    capNanoUsd: CAMPAIGN_CAP_NANO_USD,
    candidatePlannedNanoUsd: CANDIDATE_RESERVATION_NANO_USD,
    candidateSettledNanoUsd: 0,
    judgeWorstCaseNanoUsd: CAMPAIGN_CAP_NANO_USD - CANDIDATE_RESERVATION_NANO_USD,
  });
  if (reservation.state !== "authorized") {
    throw new Error("combined campaign reservation was not authorized");
  }

  mkdirSync(request.jobsRoot, { recursive: true });
  const campaignRoot = mkdtempSync(join(request.jobsRoot, "pcda-campaign-"));
  const snapshot = stageBenchSnapshot({
    repo: request.benchRepo,
    commit: request.benchCommit,
    destination: join(campaignRoot, "bench"),
  });
  const projections = projectPcdaFamily({
    snapshot,
    casePath: request.casePath,
    destination: join(campaignRoot, "projection"),
  });
  const uvx = resolveUvxTool(
    request.uvxPath,
    Object.freeze({
      expectedDigest: request.uvxDigest,
      expectedVersion: request.uvxVersion,
    }),
  );
  const evidence: Array<{
    projection: (typeof projections)[number];
    trial: ReturnType<typeof inspectPcdaTrial>;
    cleanup: { state: "completed"; matchingContainers: 0 };
  }> = [];
  const dockerHost = currentDockerHost();
  for (const projection of projections) {
    const observedBeforeCall = evidence.reduce((total, current) => {
      if (current.trial.settledNanoUsd === null) {
        throw new Error(
          "candidate cost evidence is unavailable; refusing another provider call",
        );
      }
      const next = total + current.trial.settledNanoUsd;
      if (!Number.isSafeInteger(next)) throw new Error("candidate cost sum overflow");
      return next;
    }, 0);
    if (
      observedBeforeCall + CANDIDATE_CALL_RESERVATION_NANO_USD >
      CANDIDATE_RESERVATION_NANO_USD
    ) {
      throw new Error(
        "candidate reservation is insufficient for another provider call",
      );
    }
    const before = dockerContainers();
    const launch = buildPcdaHarborArgs({
      projection,
      uvxTool: uvx,
      candidateProviderHost: "api.openai.com",
      candidateModel: request.candidateModel,
      dockerHost,
      jobsRoot: join(campaignRoot, "jobs"),
      candidateCredential: {
        available: true,
        source: "saved-openai-api-key",
        authorization: "candidate-and-judge",
      },
    });
    if (launch.state !== "ready") throw new Error(launch.reason);
    let spawned: ReturnType<typeof executePcdaSpawn> | undefined;
    try {
      spawned = executePcdaSpawn({
        launch,
        credentialName: request.credentialName,
        loadCredential: loadNamedCredential,
        spawn: (command, args, environment) => {
          try {
            const stdout = execFileSync(command, [...args], {
              encoding: "utf8",
              env: { ...environment },
              maxBuffer: 1_000_000,
              stdio: ["ignore", "pipe", "pipe"],
              timeout: LIVE_TIMEOUT_MS,
            });
            return { exitCode: 0, boundedOutput: stdout };
          } catch (error) {
            const failure = error as {
              status?: number;
              stdout?: Buffer | string;
              stderr?: Buffer | string;
            };
            const output = [failure.stdout, failure.stderr]
              .map((value) =>
                Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? ""),
              )
              .join("\n");
            return {
              exitCode: Number.isSafeInteger(failure.status)
                ? Number(failure.status)
                : 1,
              boundedOutput: output,
            };
          }
        },
      });
    } finally {
      const after = dockerContainers();
      const remaining = [...after].filter((id) => !before.has(id));
      if (remaining.length !== 0) {
        throw new Error("Harbor container cleanup is incomplete");
      }
    }
    if (spawned === undefined || spawned.state !== "completed") {
      const completedCandidateSettledNanoUsd = evidence.reduce(
        (total, item) => total + (item.trial.settledNanoUsd ?? 0),
        0,
      );
      return {
        exitCode: 2,
        report: buildPcdaFailureReceipt({
          evaluatorCommit,
          evaluatorTreeClean,
          benchCommit: snapshot.commit,
          bankDigest: snapshot.bankDigest,
          candidateModel: request.candidateModel,
          failedCondition: projection.condition,
          completedCandidateSettledNanoUsd,
          reason: "Harbor candidate failed after verified cleanup",
          cleanup: { state: "completed", matchingContainers: 0 },
        }),
      };
    }
    evidence.push({
      projection,
      trial: inspectPcdaTrial(spawned.jobDirectory, request.candidateModel),
      cleanup: { state: "completed", matchingContainers: 0 },
    });
    if (evidence.at(-1)?.trial.settledNanoUsd === null) {
      throw new Error(
        "candidate cost evidence is unavailable; refusing remaining provider calls",
      );
    }
    const observedCandidateCost = evidence.reduce((total, current) => {
      if (current.trial.settledNanoUsd === null) return total;
      const next = total + current.trial.settledNanoUsd;
      if (!Number.isSafeInteger(next)) throw new Error("candidate cost sum overflow");
      return next;
    }, 0);
    if (observedCandidateCost > CANDIDATE_RESERVATION_NANO_USD) {
      throw new Error("candidate cost exceeded its pre-run reservation");
    }
  }

  const candidateSettled = evidence.every((item) => item.trial.settledNanoUsd !== null)
    ? evidence.reduce((total, item) => total + (item.trial.settledNanoUsd ?? 0), 0)
    : null;
  const budget = authorizeCombinedBudget({
    capNanoUsd: CAMPAIGN_CAP_NANO_USD,
    candidatePlannedNanoUsd: CANDIDATE_RESERVATION_NANO_USD,
    candidateSettledNanoUsd: candidateSettled,
    judgeWorstCaseNanoUsd:
      candidateSettled === null ? 0 : CAMPAIGN_CAP_NANO_USD - candidateSettled,
  });
  if (budget.state === "unmeasured") {
    throw new Error(
      `${budget.reason}; refusing judge calls without candidate cost evidence`,
    );
  }
  if (budget.state !== "authorized") throw new Error(budget.reason);
  let remaining = budget.judgeBudgetNanoUsd;
  const conditions: PcdaConditionEvidence[] = [];
  for (const item of evidence) {
    const unsigned = buildUnsignedPcdaAttestation({
      projection: item.projection,
      artifactDigest: item.trial.artifactDigest,
      benchCommit: snapshot.commit,
      bankDigest: snapshot.bankDigest,
      deterministic: item.trial.deterministic,
    });
    const judged = await attestAndJudgeWithStagedBench({
      snapshot,
      projection: item.projection,
      artifactPath: item.trial.artifactPath,
      unsignedAttestation: unsigned,
      capabilityKey: randomBytes(32).toString("base64url"),
      remainingJudgeCapNanoUsd: remaining,
      credentialName: request.credentialName,
      loadCredential: loadNamedCredential,
      workspace: join(campaignRoot, `judge-${item.projection.condition.toLowerCase()}`),
      invoke: benchInvoke,
    });
    remaining = debitJudgeCost(remaining, settleJudgeCost(judged));
    conditions.push({
      condition: item.projection.condition,
      native: item.trial.native,
      artifactDigest: item.trial.artifactDigest,
      candidateSettledNanoUsd: item.trial.settledNanoUsd ?? 0,
      cleanup: item.cleanup,
      judge: {
        state: judged.judgeState,
        resultDigest: judged.resultDigest,
        ...(judged.settledNanoUsd === undefined
          ? {}
          : { settledNanoUsd: judged.settledNanoUsd }),
      },
    });
  }
  const report = buildPcdaCampaignReceipt({
    evaluatorCommit,
    evaluatorTreeClean,
    benchCommit: snapshot.commit,
    bankDigest: snapshot.bankDigest,
    candidateModel: request.candidateModel,
    campaignCapNanoUsd: CAMPAIGN_CAP_NANO_USD,
    candidateReservationNanoUsd: CANDIDATE_RESERVATION_NANO_USD,
    candidateCallReservationNanoUsd: CANDIDATE_CALL_RESERVATION_NANO_USD,
    remainingBudgetNanoUsd: remaining,
    conditions,
  });
  const measured = report.conditions.every(
    (condition) => condition.measurementState === "measured",
  );
  return {
    exitCode: measured ? 0 : 2,
    report: {
      state: measured ? "measured" : "unmeasured",
      receipt: report,
    },
  };
}
