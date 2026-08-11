export interface DryRunEntry {
  readonly id: string;
  readonly status: "unmeasured" | "unavailable";
  readonly reason: string;
}

export interface DryRunRegistry {
  readonly calver: "2026.8.12";
  readonly mode: "fixture-only";
  readonly entries: readonly DryRunEntry[];
}

export function createDryRunRegistry(): DryRunRegistry {
  return Object.freeze({
    calver: "2026.8.12" as const,
    mode: "fixture-only" as const,
    entries: Object.freeze([
      {
        id: "fixture-candidate-host",
        status: "unmeasured" as const,
        reason: "fixture-only dry run",
      },
      {
        id: "real-provider-host",
        status: "unavailable" as const,
        reason: "performance benchmark adapters are not implemented",
      },
    ]),
  });
}
