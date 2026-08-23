# Coffee Chat Eval quality map

## Common execution boundary

| Field               | Contract                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective           | Execute a pinned candidate-neutral source through a sealed adapter and retain auditable evidence.                                                                                |
| Acceptance criteria | Source/license digest and allowlist are verified; RunSpec is immutable; candidate/Judge capabilities are separate; roots are absolute; cleanup and artifact hashes are recorded. |
| Failure modes       | Source/rights drift, host or isolation failure, candidate failure, adapter/Judge/verifier failure, missing artifact, cleanup failure.                                            |
| Oracle              | SourceManifest, RunSpec, content-addressed EvidenceVault, TrialReceipt, redaction snapshot.                                                                                      |
| Gate                | Offline fixture/replay in PR; provider and benchmark materialization only as an explicit manual pilot.                                                                           |
| Owner               | `coffee-chat-eval`.                                                                                                                                                              |

## Track acceptance map

| Track                | Native unit and metric                                                            | Required fixture gate                                                                                             | Claim boundary                                              |
| -------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `coffee-chat-taste`  | family; 96 submissions and 672 sealed Judge calls                                 | smoke: 1 family × 3 conditions × 21 Judge calls; candidate-visible input contains no rubric                       | smoke `calibration`; Bench `not_active`                     |
| `beam-record-core`   | conversation/category; 240 queries and six independent category metrics           | smoke: 1 conversation × six categories × one question; `int(0.5)==0` and literal `<question>` flag                | diagnostic only; `paperComparable=false`                    |
| `ifeval`             | prompt; strict/loose prompt/instruction accuracy                                  | smoke: nine pinned prompts; 541 score census; historical response exclusion                                       | native metrics only; copied-source finding is `rights_hold` |
| `agentdojo-security` | suite user-task cluster; utility, utility-under-attack, targeted ASR, solvability | smoke: 1 benign + 1 control + 1 attacked workspace episode; provider/context error cannot become security success | no leaderboard, certification, or general safety claim      |

## Forbidden side effects

- no benchmark task bytes, candidate prose, Judge content, attack payloads,
  tool traces, synthetic personal data, or secrets in public artifacts;
- no private Coffee Chat imports or product-internal credit;
- no skipped, unavailable, invalid, failed, missing, or unmeasured result
  converted to zero;
- no composite score, p-value, pass threshold, or independence claim derived
  from Judge calls/orientations rather than task sampling units.

Representative tests live under `tests/`; paid provider calls and full score
campaigns are not CI gates.
