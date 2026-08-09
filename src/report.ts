import type { DryRunRegistry } from "./registry.ts";

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
