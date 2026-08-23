import type { DryRunRegistry } from "./registry.ts";
import type { PublicEvidenceReceipt } from "./receipts.ts";
import type { TrackReport } from "./eval-core.ts";

export function formatDryRunReport(registry: DryRunRegistry): string {
  const entries = registry.entries
    .map((entry) => `- ${entry.id}: ${entry.status} (${entry.reason})`)
    .join("\n");
  return [
    `Coffee Chat Eval contract status`,
    `CalVer: ${registry.calver}`,
    `Mode: ${registry.mode}`,
    entries,
    `Oracle execution is plumbing evidence; no benchmark score is produced.`,
  ].join("\n");
}

export function formatEvidenceReport(receipt: PublicEvidenceReceipt): string {
  return [
    "Coffee Chat Eval receipt",
    `Run: ${receipt.runId}`,
    `Track: ${receipt.trackId}`,
    `Profile: ${receipt.profile}`,
    `Execution: ${receipt.executionStatus}`,
    `Claim: ${receipt.claimStatus}`,
    ...(receipt.trackId === "coffee-chat-taste" ? ["Benchmark: not_active"] : []),
    ...(receipt.failureOwner === undefined
      ? []
      : [`Failure owner: ${receipt.failureOwner}`]),
    "No numeric score is emitted by this report.",
  ].join("\n");
}

export function formatTrackReport(
  report: TrackReport,
  visibility: "internal" | "public" = "public",
): string {
  const tastePublic = report.trackId === "coffee-chat-taste" && visibility === "public";
  const invalidPublic =
    visibility === "public" && report.executionStatus !== "measured";
  const suppressMetrics = tastePublic || invalidPublic;
  const metricLines = suppressMetrics
    ? []
    : report.nativeMetricIds.map((metricId) => {
        const metric = report.metrics[metricId]!;
        return `${metricId}: ${metric.numerator ?? "unmeasured"}/${metric.denominator ?? "unmeasured"} (value: ${metric.value ?? "unmeasured"})`;
      });
  return [
    `Track: ${report.trackId}`,
    `Execution: ${report.executionStatus}`,
    `Claim: ${report.claimStatus}`,
    `Visibility: ${visibility}`,
    ...(tastePublic
      ? [
          "Benchmark: not_active",
          "Numeric Taste metrics are withheld from public reports.",
        ]
      : invalidPublic
        ? ["Numeric metrics are withheld because execution is not measured."]
        : []),
    ...metricLines,
    "No composite score is emitted.",
  ].join("\n");
}
