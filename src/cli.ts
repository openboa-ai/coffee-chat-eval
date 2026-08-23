import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  createAgentDojoInventory,
  AGENTDOJO_ATTACK,
  AGENTDOJO_DEFENSE,
} from "./agentdojo.ts";
import { parseProjectionManifest, selectBaselineTasks } from "./bench.ts";
import { createBeamInventory } from "./beam.ts";
import {
  createRunPlan,
  parseRunSpec,
  parseSourceManifest,
  parseTrackReport,
} from "./eval-core.ts";
import { stableDigest } from "./identity.ts";
import { createIfevalInventory } from "./ifeval.ts";
import { createDryRunRegistry } from "./registry.ts";
import {
  createEvidenceReceipt,
  parsePublicEvidenceReceipt,
  redactEvidenceReceipt,
} from "./receipts.ts";
import {
  formatDryRunReport,
  formatEvidenceReport,
  formatTrackReport,
} from "./report.ts";
import { readBoundedJson } from "./resources.ts";
import { runCodexCandidate } from "./codex-runner.ts";
import { runOracleControl } from "./runner.ts";
import { verifyMaterializedSource } from "./source-cache.ts";
import { materializePinnedSource } from "./source-materializer.ts";
import { getSourceManifest, verifySourceManifestPins } from "./source-manifests.ts";
import { createTasteInventory } from "./taste.ts";
import type { EvaluationTrackId } from "./track-registry.ts";

const MANIFEST_BYTES = 2 * 1024 * 1024;
const CORE_BYTES = 256 * 1024;

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

function optionalRoot(
  values: ReadonlyMap<string, string>,
  flag: string,
  environment: string,
): string {
  const value = values.get(flag) ?? process.env[environment];
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${flag} or ${environment} is required`);
  }
  if (!isAbsolute(value)) throw new TypeError(`${flag} must be an absolute path`);
  return resolve(value);
}

function jsonArgument(value: string, label: string): unknown {
  if (value.trimStart().startsWith("{")) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new TypeError(`${label} must be valid JSON`);
    }
  }
  return readBoundedJson(resolve(value), CORE_BYTES, label);
}

function samplingUnit(
  trackId: EvaluationTrackId,
): "family" | "conversation" | "prompt" | "suite_user_task_cluster" {
  switch (trackId) {
    case "coffee-chat-taste":
      return "family";
    case "beam-record-core":
      return "conversation";
    case "ifeval":
      return "prompt";
    case "agentdojo-security":
      return "suite_user_task_cluster";
  }
}

function trackCensus(
  trackId: EvaluationTrackId,
  profile: "fixture" | "smoke" | "pilot" | "score",
) {
  switch (trackId) {
    case "coffee-chat-taste": {
      const inventory = createTasteInventory(profile);
      return {
        families: inventory.families.length,
        submissions: inventory.submissions.length,
        judgeCalls: inventory.judgeCalls,
      };
    }
    case "beam-record-core":
      return { queries: createBeamInventory(profile).length };
    case "ifeval":
      return { prompts: createIfevalInventory(profile).length };
    case "agentdojo-security": {
      const inventory = createAgentDojoInventory(profile);
      return {
        benign: inventory.filter((episode) => episode.kind === "benign").length,
        injectionControls: inventory.filter(
          (episode) => episode.kind === "injection-control",
        ).length,
        attackedPairs: inventory.filter((episode) => episode.kind === "attacked")
          .length,
        episodes: inventory.length,
      };
    }
  }
}

function buildV1Plan(values: ReadonlyMap<string, string>) {
  const trackId = required(values, "--track") as EvaluationTrackId;
  const profile = required(values, "--profile");
  if (
    profile !== "fixture" &&
    profile !== "smoke" &&
    profile !== "pilot" &&
    profile !== "score"
  ) {
    throw new TypeError("profile must be fixture, smoke, pilot, or score");
  }
  const manifest = getSourceManifest(trackId);
  const sourceManifestDigest = verifySourceManifestPins(manifest);
  const candidateConfig = jsonArgument(
    required(values, "--candidate-config"),
    "candidate config",
  );
  const candidateConfigDigest = stableDigest(candidateConfig);
  const candidateTypeValue =
    candidateConfig !== null &&
    typeof candidateConfig === "object" &&
    !Array.isArray(candidateConfig)
      ? (candidateConfig as Record<string, unknown>).candidateType
      : undefined;
  const candidateType =
    candidateTypeValue === undefined ? "fixture" : candidateTypeValue;
  if (
    candidateType !== "fixture" &&
    candidateType !== "reference_model" &&
    candidateType !== "agent_stack" &&
    candidateType !== "coffee_chat_product"
  ) {
    throw new TypeError("candidate config candidateType is unsupported");
  }
  const providerTermsReceiptPath = values.get("--provider-terms-receipt");
  if (providerTermsReceiptPath !== undefined && !isAbsolute(providerTermsReceiptPath)) {
    throw new TypeError("--provider-terms-receipt must be an absolute path");
  }
  const providerTermsReceiptDigest =
    providerTermsReceiptPath === undefined
      ? undefined
      : stableDigest(
          readBoundedJson(
            resolve(providerTermsReceiptPath),
            CORE_BYTES,
            "provider terms receipt",
          ),
        );
  const attackDigest = stableDigest(
    trackId === "agentdojo-security" ? AGENTDOJO_ATTACK : "none",
  );
  const defenseDigest = stableDigest(
    trackId === "agentdojo-security" ? AGENTDOJO_DEFENSE : "none",
  );
  const census = trackCensus(trackId, profile);
  const sourceCondition = "native-pinned";
  const coffeeCondition =
    trackId === "coffee-chat-taste" ? "three-condition-matrix" : undefined;
  const candidateRecord =
    candidateConfig !== null &&
    typeof candidateConfig === "object" &&
    !Array.isArray(candidateConfig)
      ? (candidateConfig as Record<string, unknown>)
      : undefined;
  const isolationEvidenceDigest =
    candidateRecord?.isolationEvidence === undefined
      ? undefined
      : stableDigest(candidateRecord.isolationEvidence);
  const spec = parseRunSpec({
    schema: "run-spec-v1",
    trackId,
    profile,
    sourceManifestDigest,
    candidateDigest: stableDigest({ candidateType, candidateConfigDigest }),
    judgeDigest: stableDigest(
      candidateConfig !== null &&
        typeof candidateConfig === "object" &&
        !Array.isArray(candidateConfig)
        ? ((candidateConfig as Record<string, unknown>).judge ?? "sealed-native-judge")
        : "sealed-native-judge",
    ),
    attackDigest,
    defenseDigest,
    configurationDigest: stableDigest({
      trackId,
      profile,
      candidateConfigDigest,
      providerTermsDigest: manifest.providerTermsDigest,
      ...(providerTermsReceiptDigest === undefined
        ? {}
        : { providerTermsReceiptDigest }),
      sourceCondition,
      ...(coffeeCondition === undefined ? {} : { coffeeCondition }),
      ...(isolationEvidenceDigest === undefined ? {} : { isolationEvidenceDigest }),
      census,
    }),
    providerTermsDigest: manifest.providerTermsDigest,
    ...(providerTermsReceiptDigest === undefined ? {} : { providerTermsReceiptDigest }),
    candidateType,
    samplingUnit: samplingUnit(trackId),
    caseCensus: census,
    ...(isolationEvidenceDigest === undefined ? {} : { isolationEvidenceDigest }),
    ...(candidateRecord?.seed === undefined ? {} : { seed: candidateRecord.seed }),
    ...(candidateRecord?.budgets === undefined
      ? {}
      : { budgets: candidateRecord.budgets }),
    sourceCondition,
    sourceConditionDigest: stableDigest(sourceCondition),
    ...(coffeeCondition !== undefined
      ? {
          coffeeCondition,
          coffeeConditionDigest: stableDigest(coffeeCondition),
        }
      : {}),
  });
  const plan = createRunPlan({
    manifest,
    spec,
    evidenceRoot: optionalRoot(values, "--evidence-root", "EVIDENCE_ROOT"),
    cacheRoot: optionalRoot(values, "--cache-root", "EVAL_CACHE_ROOT"),
  });
  return Object.freeze({
    ...plan,
    runSpec: spec,
    sourceManifest: manifest,
    census,
  });
}

function corePlan(values: ReadonlyMap<string, string>) {
  const manifest = parseSourceManifest(
    readBoundedJson(
      required(values, "--source-manifest"),
      CORE_BYTES,
      "source manifest",
    ),
  );
  const spec = parseRunSpec(
    readBoundedJson(required(values, "--run-spec"), CORE_BYTES, "run spec"),
  );
  return createRunPlan({
    manifest,
    spec,
    evidenceRoot: required(values, "--evidence-root"),
    cacheRoot: required(values, "--cache-root"),
  });
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeReceiptOnce(path: string, receipt: unknown): void {
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  mkdirSync(resolve(path, ".."), { recursive: true });
  try {
    writeFileSync(path, serialized, { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
      throw error;
    const existing = readFileSync(path, "utf8");
    if (existing !== serialized)
      throw new Error("append-only receipt already contains different bytes");
  }
}

function readPlanEnvelope(path: string) {
  const value = readBoundedJson(resolve(path), CORE_BYTES, "run plan");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("run plan must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.runSpec === undefined || record.sourceManifest === undefined) {
    // The public CLI contract also permits a raw immutable RunSpec.  Its
    // pinned source manifest is resolved by track id; no source bytes are
    // copied into the plan file.
    const spec = parseRunSpec(record);
    return { manifest: getSourceManifest(spec.trackId), spec, envelope: record };
  }
  const manifest = parseSourceManifest(record.sourceManifest);
  const spec = parseRunSpec(record.runSpec);
  return { manifest, spec, envelope: record };
}

export async function runCli(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === "dry-run") {
    process.stdout.write(`${formatDryRunReport(createDryRunRegistry())}\n`);
    return;
  }
  if (args[0] === "source" && args[1] === "verify") {
    const values = flags(args.slice(2));
    const trackId = required(values, "--track") as EvaluationTrackId;
    const manifest = getSourceManifest(trackId);
    const sourceManifestDigest = verifySourceManifestPins(manifest);
    const materialized = values.has("--cache-root")
      ? verifyMaterializedSource({
          manifest,
          cacheRoot: optionalRoot(values, "--cache-root", "EVAL_CACHE_ROOT"),
        })
      : undefined;
    writeJson({
      trackId,
      sourceManifestDigest,
      source: manifest.source,
      data: manifest.data,
      allowlist: manifest.allowlist,
      excludedPaths: manifest.excludedPaths,
      providerTermsPolicy: manifest.providerTermsPolicy,
      providerTermsDigest: manifest.providerTermsDigest,
      caseCensus: manifest.caseCensus,
      publicArtifactPolicy: manifest.publicArtifactPolicy,
      ...(materialized === undefined ? {} : { materialized }),
    });
    return;
  }
  if (args[0] === "source" && args[1] === "materialize") {
    const values = flags(args.slice(2));
    const trackId = required(values, "--track") as EvaluationTrackId;
    const manifest = getSourceManifest(trackId);
    verifySourceManifestPins(manifest);
    const cacheRoot = optionalRoot(values, "--cache-root", "EVAL_CACHE_ROOT");
    const sourceRoot = values.has("--source-root")
      ? required(values, "--source-root")
      : join(cacheRoot, trackId, "staging-source");
    const dataRoot = values.get("--data-root");
    const runtimeLockPath = values.get("--runtime-lock");
    const licenseEvidence = values.get("--license-evidence");
    const materialized = materializePinnedSource({
      manifest,
      cacheRoot,
      sourceRoot,
      ...(dataRoot === undefined ? {} : { dataRoot }),
      ...(runtimeLockPath === undefined ? {} : { runtimeLockPath }),
      ...(licenseEvidence === undefined
        ? {}
        : {
            licenseEvidence: JSON.parse(
              readFileSync(resolve(licenseEvidence), "utf8"),
            ) as never,
          }),
    });
    writeJson({
      trackId,
      sourceManifestDigest: stableDigest(manifest),
      materialized,
    });
    return;
  }
  if (args[0] === "source-verify") {
    const values = flags(args.slice(1));
    const manifest = parseSourceManifest(
      readBoundedJson(
        required(values, "--source-manifest"),
        CORE_BYTES,
        "source manifest",
      ),
    );
    writeJson({
      trackId: manifest.trackId,
      sourceManifestDigest: stableDigest(manifest),
      publicArtifactPolicy: manifest.publicArtifactPolicy,
    });
    return;
  }
  if (args[0] === "plan") {
    const values = flags(args.slice(1));
    writeJson(values.has("--track") ? buildV1Plan(values) : corePlan(values));
    return;
  }
  if (args[0] === "run") {
    const runValues = flags(args.slice(1));
    if (runValues.has("--plan")) {
      const { manifest, spec, envelope } = readPlanEnvelope(
        required(runValues, "--plan"),
      );
      const plan = createRunPlan({
        manifest,
        spec,
        evidenceRoot: optionalRoot(runValues, "--evidence-root", "EVIDENCE_ROOT"),
        cacheRoot:
          typeof envelope.cacheRoot === "string"
            ? envelope.cacheRoot
            : optionalRoot(runValues, "--cache-root", "EVAL_CACHE_ROOT"),
      });
      const executionStatus =
        spec.candidateType === "coffee_chat_product"
          ? ("not_implemented" as const)
          : spec.profile !== "fixture" &&
              spec.profile !== "smoke" &&
              spec.candidateType !== "fixture" &&
              manifest.providerTermsPolicy === "receipt-required" &&
              spec.providerTermsReceiptDigest === undefined
            ? ("rights_hold" as const)
            : spec.profile !== "fixture" &&
                spec.profile !== "smoke" &&
                spec.candidateType !== "fixture" &&
                spec.isolationEvidenceDigest === undefined
              ? ("unavailable" as const)
              : ("unmeasured" as const);
      const receipt = redactEvidenceReceipt(
        createEvidenceReceipt({
          plan,
          executionStatus,
          ...(executionStatus === "rights_hold"
            ? { failureOwner: "rights" as const }
            : executionStatus === "unavailable"
              ? { failureOwner: "host" as const }
              : {}),
          privateEvidence: {
            task: plan.runSpecDigest,
            candidate: plan.runSpecDigest,
            judge: plan.runSpecDigest,
            secret: plan.runSpecDigest,
          },
        }),
      );
      writeReceiptOnce(
        join(plan.evidenceRoot, plan.id, "public-receipt.json"),
        receipt,
      );
      writeJson(receipt);
      return;
    }
    const plan = corePlan(flags(args.slice(1)));
    writeJson(
      redactEvidenceReceipt(
        createEvidenceReceipt({
          plan,
          executionStatus: "unmeasured",
          privateEvidence: {
            task: plan.runSpecDigest,
            candidate: plan.runSpecDigest,
            judge: plan.runSpecDigest,
            secret: plan.runSpecDigest,
          },
        }),
      ),
    );
    return;
  }
  if (args[0] === "report") {
    const values = flags(args.slice(1));
    const runReference = values.get("--run") ?? values.get("--receipt");
    if (runReference === undefined)
      throw new TypeError("--run or --receipt is required");
    const receiptPath =
      isAbsolute(runReference) || runReference.includes("/")
        ? resolve(runReference)
        : join(
            optionalRoot(values, "--evidence-root", "EVIDENCE_ROOT"),
            runReference,
            "public-receipt.json",
          );
    const receipt = parsePublicEvidenceReceipt(
      readBoundedJson(receiptPath, CORE_BYTES, "public receipt"),
    );
    const visibility = values.get("--visibility") ?? "public";
    if (visibility !== "public" && visibility !== "internal") {
      throw new TypeError("visibility must be public or internal");
    }
    const trackReportPath = join(dirname(receiptPath), "track-report.json");
    if (existsSync(trackReportPath)) {
      const trackReport = parseTrackReport(
        readBoundedJson(trackReportPath, CORE_BYTES, "track report"),
      );
      if (
        trackReport.trackId !== receipt.trackId ||
        trackReport.provenance.runId !== receipt.runId ||
        trackReport.claimStatus !== receipt.claimStatus ||
        trackReport.executionStatus !== receipt.executionStatus
      ) {
        throw new TypeError("track report does not match the public receipt");
      }
      process.stdout.write(`${formatTrackReport(trackReport, visibility)}\n`);
    } else {
      process.stdout.write(`${formatEvidenceReport(receipt)}\n`);
    }
    return;
  }
  if (args[0] !== "oracle-control" && args[0] !== "codex-baseline") {
    throw new TypeError(
      "usage: coffee-chat-eval source verify --track TRACK | source materialize --track TRACK --cache-root ABSOLUTE | plan --track TRACK --profile fixture|smoke|pilot|score --candidate-config JSON | run --plan PATH --evidence-root ABSOLUTE | portfolio smoke --config ABSOLUTE | report --run RUN --visibility internal|public | dry-run | oracle-control | codex-baseline ...",
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
