import type { DryRunRegistry } from "./registry.ts";

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
