import { stableDigest } from "./identity.ts";
import { parseSourceManifest, type SourceManifest } from "./eval-core.ts";
import type { EvaluationTrackId } from "./track-registry.ts";

/**
 * The provider receipt is deliberately a policy digest, not a provider key.
 * It binds the host-held broker, separate candidate/Judge capabilities, and
 * terms re-check required before any paid run.
 */
export const PROVIDER_TERMS_DIGEST = stableDigest({
  schema: "coffee-chat-eval/provider-terms-v1",
  broker: "host-held",
  capabilities: ["candidate", "judge"],
  termsRecheck: "required",
});

const SOURCE_MANIFESTS_RAW = {
  "coffee-chat-taste": {
    schema: "source-manifest-v1",
    trackId: "coffee-chat-taste",
    source: {
      repository: "https://github.com/openboa-ai/coffee-chat-bench",
      commit: "43d3350be9e7aa2498b7843dad3a956728fe5d54",
      license: "MIT",
      licenseDigest:
        "sha256:6db6f04aa9ed319bfb1b0b90269cace3ed8231d7bd180bacce38a866e040d9a4",
    },
    allowlist: ["bank/bank.json", "bank/public/cases/**", "src/**", "LICENSE", "README.md", "package.json"],
    excludedPaths: ["sealed/**", "raw-responses/**"],
    notices: [
      "https://github.com/openboa-ai/coffee-chat-bench/blob/43d3350be9e7aa2498b7843dad3a956728fe5d54/LICENSE",
    ],
    retention: {
      source: "cache-only",
      evidence: "private-content-addressed",
      public: "aggregate-provenance-only",
    },
    providerTermsPolicy: "receipt-required",
    providerTermsDigest: PROVIDER_TERMS_DIGEST,
    nativeMetric: "candidate-independent sealed Judge pointwise/pairwise calls",
    caseCensus: { families: 32, submissions: 96, judgeCalls: 672 },
    publicArtifactPolicy: "receipt-redacted",
  },
  "beam-record-core": {
    schema: "source-manifest-v1",
    trackId: "beam-record-core",
    source: {
      repository: "https://github.com/mohammadtavakoli78/BEAM",
      commit: "3e12035532eb85768f1a7cd779832b650c4b2ef9",
      license: "MIT",
      licenseDigest:
        "sha256:60c7b74ffaacaae383c3f06a48bc79d204b25bc9c1856df9711b3d290febd474",
    },
    data: {
      repository: "https://huggingface.co/datasets/Mohammadta/BEAM",
      revision: "3205395e897e7318c7b094ef4e6047b9b82dbb03",
      license: "CC BY-SA 4.0",
      licenseDigest:
        "sha256:30b9ff56f4ca52e4078754e91f5e8dd8cd73b1b1246a42a000f11ce6b940400d",
      allowlist: ["README.md", "data/100K-00000-of-00001.parquet"],
      licenseEvidencePath: "README.md",
    },
    allowlist: [
      "src/__init__.py",
      "src/evaluation/**",
      "src/prompts.py",
      "LICENSE",
      "README.md",
    ],
    excludedPaths: [
      "src/llm.py",
      "src/llms_config.json",
      ".env",
      "secrets/**",
      "results/**",
      "raw-responses/**",
    ],
    notices: [
      "https://github.com/mohammadtavakoli78/BEAM/blob/3e12035532eb85768f1a7cd779832b650c4b2ef9/LICENSE",
      "https://huggingface.co/datasets/Mohammadta/BEAM/tree/3205395e897e7318c7b094ef4e6047b9b82dbb03",
    ],
    retention: {
      source: "cache-only",
      evidence: "private-content-addressed",
      public: "aggregate-provenance-only",
    },
    providerTermsPolicy: "receipt-required",
    providerTermsDigest: PROVIDER_TERMS_DIGEST,
    nativeMetric: "upstream LLM judge category score with integer truncation",
    caseCensus: { tier100KConversations: 20, queries: 240 },
    publicArtifactPolicy: "receipt-redacted",
  },
  ifeval: {
    schema: "source-manifest-v1",
    trackId: "ifeval",
    source: {
      repository: "https://github.com/google-research/google-research",
      commit: "e6890f85757dd84e27ca6df2dd30651dafad28e0",
      license: "Apache-2.0",
      licenseDigest:
        "sha256:cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    },
    allowlist: [
      "instruction_following_eval/__init__.py",
      "instruction_following_eval/evaluation_lib.py",
      "instruction_following_eval/instructions.py",
      "instruction_following_eval/instructions_registry.py",
      "instruction_following_eval/instructions_util.py",
      "instruction_following_eval/data/input_data.jsonl",
      "LICENSE",
    ],
    excludedPaths: [
      "instruction_following_eval/data/input_response_data_gpt4_20231107_145030.jsonl",
      "raw-responses/**",
    ],
    notices: [
      "https://github.com/google-research/google-research/blob/e6890f85757dd84e27ca6df2dd30651dafad28e0/LICENSE",
    ],
    retention: {
      source: "cache-only",
      evidence: "private-content-addressed",
      public: "aggregate-provenance-only",
    },
    providerTermsPolicy: "receipt-required",
    providerTermsDigest: PROVIDER_TERMS_DIGEST,
    nativeMetric: "Google Research strict/loose prompt/instruction accuracy",
    caseCensus: { prompts: 541, checkerFamilies: 9 },
    publicArtifactPolicy: "receipt-redacted",
  },
  "agentdojo-security": {
    schema: "source-manifest-v1",
    trackId: "agentdojo-security",
    source: {
      repository: "https://github.com/ethz-spylab/agentdojo",
      commit: "a75aba7631d3ca5fb7ab938965c97ead2f9ff84b",
      license: "MIT",
      licenseDigest:
        "sha256:4285a071f2d382338e52b4fb0a186d952984a34d43a33d8872e1a1d8cb43401e",
    },
    allowlist: ["src/**", "pyproject.toml", "LICENSE"],
    excludedPaths: [".env", "secrets/**", "raw-traces/**"],
    notices: [
      "https://github.com/ethz-spylab/agentdojo/blob/a75aba7631d3ca5fb7ab938965c97ead2f9ff84b/LICENSE",
    ],
    retention: {
      source: "cache-only",
      evidence: "private-content-addressed",
      public: "aggregate-provenance-only",
    },
    providerTermsPolicy: "receipt-required",
    providerTermsDigest: PROVIDER_TERMS_DIGEST,
    nativeMetric: "utility and targeted injection security scorers",
    caseCensus: {
      userTasks: 97,
      injectionTasks: 35,
      attackedPairs: 949,
      episodes: 1081,
    },
    publicArtifactPolicy: "receipt-redacted",
  },
} as const;

export const SOURCE_MANIFESTS: Readonly<Record<EvaluationTrackId, SourceManifest>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(SOURCE_MANIFESTS_RAW).map(([trackId, raw]) => [
        trackId,
        parseSourceManifest(raw),
      ]),
    ) as Record<EvaluationTrackId, SourceManifest>,
  );

/**
 * Immutable control values.  These are intentionally literals rather than
 * being derived from SOURCE_MANIFESTS: changing a built-in pin, allowlist, or
 * rights policy must fail closed instead of changing the expected value with
 * the change.
 */
const EXPECTED_DIGESTS: Readonly<Record<EvaluationTrackId, `sha256:${string}`>> =
  Object.freeze({
    "coffee-chat-taste":
      "sha256:bc5b172721cc7ddb41ef85ea0436b7dbfd12d9feac35c8e923e7cd229bd638bb",
    "beam-record-core":
      "sha256:5c98e191e800ea7d1ab08939886c7bf142805493af4638f5b221a4ad63a8ab3f",
    ifeval: "sha256:e3343ceabe05005ebc26965be04f0b410b7574c534dab7aef8794e70ded8df3e",
    "agentdojo-security":
      "sha256:9470d6cdcc6670dde2a056c6bc82b1f935db6eed1c762002fd74b3e205fe289b",
  });

export function getSourceManifest(trackId: EvaluationTrackId): SourceManifest {
  const manifest = SOURCE_MANIFESTS[trackId];
  if (manifest === undefined)
    throw new TypeError(`source manifest is unavailable: ${trackId}`);
  return manifest;
}

export function verifySourceManifestPins(manifest: SourceManifest): `sha256:${string}` {
  const digest = stableDigest(manifest);
  if (digest !== EXPECTED_DIGESTS[manifest.trackId]) {
    throw new TypeError(
      `source manifest digest or source pin drifted for ${manifest.trackId}`,
    );
  }
  return digest;
}
