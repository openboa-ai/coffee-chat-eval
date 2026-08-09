import type { DryRunRegistry } from "./registry.ts";
import type { TrialReceipt } from "./types.ts";

export function formatDryRunReport(registry: DryRunRegistry): string {
  const entries = registry.entries
    .map((entry) => `- ${entry.id}: ${entry.status} (${entry.reason})`)
    .join("\n");
  return [
    `Coffee Chat evaluator dry run`,
    `CalVer: ${registry.calver}`,
    `Mode: ${registry.mode}`,
    entries,
    `No Coffee Chat performance score is produced.`,
  ].join("\n");
}

export function summarizeReceipts(
  receipts: readonly TrialReceipt[],
): Readonly<Record<string, number>> {
  return receipts.reduce<Record<string, number>>((summary, receipt) => {
    summary[receipt.status] = (summary[receipt.status] ?? 0) + 1;
    return summary;
  }, {});
}
