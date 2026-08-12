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
  buildUnsignedPcdaAttestation,
  parsePcdaNativeResult,
  type Digest,
  type PcdaConditionEvidence,
} from "./pcda-receipt.ts";

const CAMPAIGN_CAP_NANO_USD = 50_000_000_000;
const CANDIDATE_RESERVATION_NANO_USD = 20_000_000_000;
const CANDIDATE_CALL_RESERVATION_NANO_USD = 6_000_000_000;
const LIVE_TIMEOUT_MS = 30 * 60 * 1_000;

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

function filesNamed(root: string, name: string): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Harbor evidence must not be linked");
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === name) found.push(path);
    }
  };
  visit(root);
  return found;
}

function inspectTrial(jobDirectory: string): {
  native: ReturnType<typeof parsePcdaNativeResult>;
  artifactPath: string;
  artifactDigest: Digest;
  settledNanoUsd: number | null;
} {
  const results = filesNamed(jobDirectory, "result.json");
  if (results.length !== 1) {
    throw new Error("Harbor job must contain exactly one native trial result");
  }
  const resultPath = results[0]!;
  const raw = JSON.parse(readFileSync(resultPath, "utf8")) as unknown;
  const native = parsePcdaNativeResult(raw);
  if (native.state === "invalid") throw new Error(native.reason);
  const trial = dirname(resultPath);
  const artifactPath = join(trial, "artifacts", "app", "output.json");
  if (!existsSync(artifactPath) || !lstatSync(artifactPath).isFile()) {
    throw new Error("Harbor trial must contain exactly one output.json artifact");
  }
  const settledNanoUsd = candidateSettledNanoUsd(raw);
  return {
    native,
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
    trial: ReturnType<typeof inspectTrial>;
    cleanup: { state: "completed"; matchingContainers: 0 };
  }> = [];
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
      throw new Error("Harbor candidate failed after verified cleanup");
    }
    evidence.push({
      projection,
      trial: inspectTrial(spawned.jobDirectory),
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
      deterministic: {
        ...(item.trial.native.state === "accepted"
          ? {
              state: "unmeasured" as const,
              accepted: true,
              criticalFailure: false,
              reasonCode: "none" as const,
            }
          : {
              state: "candidate_invalid" as const,
              accepted: false,
              criticalFailure: true,
              reasonCode: "candidate_invalid" as const,
            }),
      },
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
    if (item.trial.native.state === "accepted" && judged.settledNanoUsd === undefined) {
      throw new Error("judge cost evidence is unavailable");
    }
    if (judged.settledNanoUsd !== undefined) remaining -= judged.settledNanoUsd;
    if (remaining < 0) throw new Error("combined campaign cost exceeded USD 50");
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
