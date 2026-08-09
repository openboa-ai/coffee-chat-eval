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
    async execute({ trial, trialId, candidate, workspaceId }) {
      if (options.failure === "host")
        return { kind: "host_failure", message: "fixture host failure" };
      const candidateRun = await candidate.run({ trial, workspaceId });
      if (candidateRun.kind === "failure" || !candidateRun.artifact) {
        return { kind: "completed", candidate: candidateRun };
      }
      const evidenceReference = `fixture://${workspaceId}`;
      const artifactLocator =
        `fixture://${workspaceId}/artifacts/` +
        candidateRun.artifact.digest.slice("sha256:".length);
      const detail = options.evidence ?? "controlled fake host; no external execution";
      const binding = {
        reference: evidenceReference,
        detail,
        trialId,
        artifactDigest: candidateRun.artifact.digest,
        artifactLocator,
      };
      return {
        kind: "completed",
        artifactLocator,
        evidence: {
          ...binding,
          digest: stableDigest(binding),
        },
        candidate: candidateRun,
      };
    },
    async cleanup() {},
  };
}
