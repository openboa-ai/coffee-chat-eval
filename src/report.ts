import type { DryRunRegistry } from "./registry.ts";
import type { PublicEvidenceReceipt } from "./receipts.ts";
import type { TrackReport } from "./eval-core.ts";

type ReportBoundary = TrackReport["provenance"] | PublicEvidenceReceipt;

function productBoundaryMatches(left: ReportBoundary, right: ReportBoundary): boolean {
  const leftPresent = left.candidateMode !== undefined;
  const rightPresent = right.candidateMode !== undefined;
  if (!leftPresent || !rightPresent) return leftPresent === rightPresent;
  return (
    left.candidateMode === right.candidateMode &&
    JSON.stringify(left.capabilitiesUsed) === JSON.stringify(right.capabilitiesUsed) &&
    left.productBehaviorExercised === right.productBehaviorExercised &&
    left.referenceHost === right.referenceHost &&
    left.productIdentity?.repository === right.productIdentity?.repository &&
    left.productIdentity?.commit === right.productIdentity?.commit &&
    left.productIdentity?.calver === right.productIdentity?.calver &&
    left.productIdentity?.packageDigest === right.productIdentity?.packageDigest
  );
}

function rightsBoundaryMatches(left: ReportBoundary, right: ReportBoundary): boolean {
  const leftPresent = left.rightsRiskAcceptanceDigest !== undefined;
  const rightPresent = right.rightsRiskAcceptanceDigest !== undefined;
  if (!leftPresent || !rightPresent) return leftPresent === rightPresent;
  return (
    left.rightsRiskAcceptanceDigest === right.rightsRiskAcceptanceDigest &&
    left.licenseCleared === right.licenseCleared &&
    left.rightsExecutionScope === right.rightsExecutionScope
  );
}

export function assertTrackReportMatchesReceipt(
  report: TrackReport,
  receipt: PublicEvidenceReceipt,
): void {
  if (
    report.trackId !== receipt.trackId ||
    report.provenance.runId !== receipt.runId ||
    report.provenance.sourceManifestDigest !== receipt.sourceManifestDigest ||
    report.claimStatus !== receipt.claimStatus ||
    report.executionStatus !== receipt.executionStatus ||
    !productBoundaryMatches(report.provenance, receipt) ||
    !rightsBoundaryMatches(report.provenance, receipt)
  ) {
    throw new TypeError("track report does not match the public receipt");
  }
}

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
  const productBoundary =
    receipt.candidateMode === undefined
      ? []
      : [
          `Candidate mode: ${receipt.candidateMode}`,
          "Capabilities used: none",
          `Product behavior exercised: ${String(receipt.productBehaviorExercised)}`,
          "Connectivity evidence is not a Product performance claim.",
        ];
  const rightsBoundary =
    receipt.rightsRiskAcceptanceDigest === undefined
      ? []
      : [
          `Rights risk acceptance: ${receipt.rightsRiskAcceptanceDigest}`,
          `License cleared: ${String(receipt.licenseCleared)}`,
          `Rights execution scope: ${receipt.rightsExecutionScope}`,
          "Numeric IFEval metrics remain private calibration evidence.",
        ];
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
    ...productBoundary,
    ...rightsBoundary,
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
  const productConnectivityPublic =
    visibility === "public" && report.provenance.candidateMode === "connectivity_only";
  const riskAcceptedIfevalPublic =
    visibility === "public" &&
    report.trackId === "ifeval" &&
    report.provenance.rightsRiskAcceptanceDigest !== undefined;
  const suppressMetrics =
    tastePublic ||
    invalidPublic ||
    productConnectivityPublic ||
    riskAcceptedIfevalPublic;
  const productBoundary =
    report.provenance.candidateMode === undefined
      ? []
      : [
          `Candidate mode: ${report.provenance.candidateMode}`,
          "Capabilities used: none",
          `Product behavior exercised: ${String(report.provenance.productBehaviorExercised)}`,
          "Connectivity evidence is not a Product performance claim.",
        ];
  const metricLines = suppressMetrics
    ? []
    : report.nativeMetricIds.map((metricId) => {
        const metric = report.metrics[metricId]!;
        return `${metricId}: ${metric.numerator ?? "unmeasured"}/${metric.denominator ?? "unmeasured"} (value: ${metric.value ?? "unmeasured"})`;
      });
  const rightsBoundary =
    report.provenance.rightsRiskAcceptanceDigest === undefined
      ? []
      : [
          `Rights risk acceptance: ${report.provenance.rightsRiskAcceptanceDigest}`,
          `License cleared: ${String(report.provenance.licenseCleared)}`,
          `Rights execution scope: ${report.provenance.rightsExecutionScope}`,
        ];
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
        : productConnectivityPublic
          ? [
              "Numeric reference-host metrics are withheld because no Product behavior was exercised.",
            ]
          : riskAcceptedIfevalPublic
            ? [
                "Numeric IFEval metrics are withheld from this risk-accepted private calibration report.",
              ]
            : []),
    ...productBoundary,
    ...rightsBoundary,
    ...metricLines,
    "No composite score is emitted.",
  ].join("\n");
}
