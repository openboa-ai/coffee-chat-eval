export interface DryRunEntry {
  readonly id: string;
  readonly status: "unmeasured" | "unavailable";
  readonly reason: string;
}

export interface DryRunRegistry {
  readonly calver: "2026.8.12";
  readonly mode: "contract-only";
  readonly entries: readonly DryRunEntry[];
}

export function createDryRunRegistry(): DryRunRegistry {
  return Object.freeze({
    calver: "2026.8.12" as const,
    mode: "contract-only" as const,
    entries: Object.freeze([
      {
        id: "bench-projection",
        status: "unmeasured" as const,
        reason: "candidate-neutral Harbor tasks are ready for execution",
      },
      {
        id: "native-harbor-codex",
        status: "unavailable" as const,
        reason: "credential_isolation_unavailable",
      },
      {
        id: "harbor-codex-proxy",
        status: "unmeasured" as const,
        reason: "manual_baseline_receipts_exist_without_qualified_semantic_judgment",
      },
    ]),
  });
}
