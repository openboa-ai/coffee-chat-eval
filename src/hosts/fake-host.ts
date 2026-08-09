import { stableDigest } from "../identity.ts";
import type { HostAdapter } from "../types.ts";

const reference = {
  id: "fixture-host",
  isolationClass: "fixture" as const,
  configurationDigest: stableDigest("fixture-host-configuration"),
  isolationReference: "fixture://fake-host",
};

export function createFakeHost(
  options: {
    readonly evidence?: string;
    readonly failure?: "host";
  } = {},
): HostAdapter {
  return {
    ref: reference,
    async execute({ trial, candidate, workspaceId }) {
      if (options.failure === "host")
        return { kind: "host_failure", message: "fixture host failure" };
      const evidenceReference = `fixture://${workspaceId}`;
      const detail = options.evidence ?? "controlled fake host; no external execution";
      return {
        kind: "completed",
        evidence: {
          reference: evidenceReference,
          digest: stableDigest({ reference: evidenceReference, detail }),
          detail,
        },
        candidate: await candidate.run({ trial, workspaceId }),
      };
    },
    async cleanup() {},
  };
}
