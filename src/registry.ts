export interface DryRunEntry {
  readonly id: string;
  readonly status: "unmeasured" | "unavailable" | "rights_hold";
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
      {
        id: "coffee-chat-taste",
        status: "unmeasured" as const,
        reason: "32 families / 96 submissions / 672 Judge calls; benchmark not_active",
      },
      {
        id: "beam-record-core",
        status: "unmeasured" as const,
        reason: "20 conversations / 240 queries; upstream-code-exact diagnostic",
      },
      {
        id: "ifeval",
        status: "rights_hold" as const,
        reason:
          "punkt_tab_license_unclarified; native non-fixture execution is blocked before candidate calls",
      },
      {
        id: "agentdojo-security",
        status: "unmeasured" as const,
        reason:
          "97 user + 35 injection + 949 attacked = 1081 episodes; no security certification",
      },
    ]),
  });
}
