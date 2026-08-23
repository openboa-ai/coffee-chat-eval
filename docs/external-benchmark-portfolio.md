# v1 external benchmark portfolio

This document is the Eval repository's admission snapshot. It is a rights and
engineering preflight, not legal advice. “Evaluation only” does not erase
commercial-use, attribution, ShareAlike, provider-terms, or retention duties.

| Track                | Pinned source                                                                                         | Rights boundary                                                           |                                 Native campaign census | Claim boundary                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -----------------------------------------------------: | -------------------------------------------------------- |
| `coffee-chat-taste`  | Coffee Chat Bench `43d3350be9e7aa2498b7843dad3a956728fe5d54`                                          | MIT; raw task/rubric/Judge content stays cache/private                    |         32 families / 96 submissions / 672 Judge calls | `provisional_internal`; Bench remains `not_active`       |
| `beam-record-core`   | BEAM code `3e12035532eb85768f1a7cd779832b650c4b2ef9`; data `3205395e897e7318c7b094ef4e6047b9b82dbb03` | MIT code + CC BY-SA 4.0 data; attribution and ShareAlike remain required  |                         20 conversations / 240 queries | upstream-code-exact diagnostic; `paperComparable=false`  |
| `ifeval`             | Google Research `e6890f85757dd84e27ca6df2dd30651dafad28e0`                                            | Apache-2.0; historical GPT-4 response file excluded                       |                                            541 prompts | four native strict/loose metrics only                    |
| `agentdojo-security` | package `0.1.35`, source `a75aba7631d3ca5fb7ab938965c97ead2f9ff84b`                                   | MIT synthetic suites only; no live accounts or third-party workspace data | 97 user + 35 injection + 949 attacked = 1,081 episodes | utility/ASR diagnostics; no certification or leaderboard |

τ²-bench and Terminal-Bench are intentionally outside v1. The four tracks are
not collapsed into a composite score: Taste application, long-record
reasoning, explicit instruction compliance, and untrusted-context security are
different constructs with different sampling units.

## Materialization and publication

The source manifests in [`src/source-manifests.ts`](../src/source-manifests.ts)
fix the source/data revisions, license digests, allowlists, exclusions, notices,
retention, and provider-terms digest. The operator materializes an admitted
checkout only below `EVAL_CACHE_ROOT/<track-id>/`; `source-receipt.json` records
the exact file census and is checked by `src/source-cache.ts`. Raw upstream
bytes, prompt text, candidate prose, Judge responses, attack payloads, tool
traces, synthetic personal data, and secrets are never public artifacts.

Provider keys remain in a host-held broker. Candidate and Judge capabilities
are separate, scoped, expiring descriptors. A missing terms receipt is
`rights_hold`; missing isolation is `unavailable`; provider/context failures
are not security successes. Full score profiles are implemented as explicit
manual campaigns, not CI or automatic paid runs. The operator provisions each
track runtime under the cache with pinned `uv` in offline mode; the runner does
not auto-install dependencies. BEAM's runtime uses the Eval-owned minimal
LLM-only lock and reads the admitted 100K parquet to pass conversation context
and the selected question to the candidate while keeping rubrics evaluator-side.
