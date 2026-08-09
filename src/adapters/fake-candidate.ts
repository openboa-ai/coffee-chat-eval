import { stableDigest } from "../identity.ts";
import type { CandidateAdapter, CandidateRef } from "../types.ts";

const reference: CandidateRef = {
  repository: "https://github.com/openboa-ai/coffee-chat",
  commit: "0123456789abcdef0123456789abcdef01234567",
  calver: "2026.8.9",
  adapter: "fake-candidate",
};

export function createFakeCandidate(
  options: {
    readonly failure?: "candidate";
    readonly artifact?: undefined;
  } = {},
): CandidateAdapter {
  return {
    ref: reference,
    async run({ trial }) {
      if (options.failure === "candidate")
        return { kind: "failure", message: "fixture candidate failure" };
      if (Object.hasOwn(options, "artifact")) return { kind: "success" };
      const value = "ok";
      return {
        kind: "success",
        artifact: {
          id: `artifact-${trial.id ?? "unidentified"}`,
          digest: stableDigest(value),
          value,
        },
      };
    },
  };
}
