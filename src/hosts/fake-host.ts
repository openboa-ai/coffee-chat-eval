import type { HostAdapter } from "../types.ts";

export function createFakeHost(
  options: {
    readonly evidence?: string;
    readonly failure?: "host";
  } = {},
): HostAdapter {
  return {
    ref: { id: "fixture-host", isolationClass: "fixture" },
    async execute({ trial, candidate, workspaceId }) {
      if (options.failure === "host")
        return { kind: "host_failure", message: "fixture host failure" };
      return {
        kind: "completed",
        evidence: {
          reference: `fixture://${workspaceId}`,
          detail: options.evidence ?? "controlled fake host; no external execution",
        },
        candidate: await candidate.run({ trial, workspaceId }),
      };
    },
    async cleanup() {},
  };
}
