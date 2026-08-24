# Coffee Chat Eval quality map

## Common execution boundary

| Field               | Contract                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective           | Execute a pinned candidate-neutral source through a sealed adapter and retain auditable evidence.                                                                                |
| Acceptance criteria | Source/license digest and allowlist are verified; RunSpec is immutable; candidate/Judge capabilities are separate; roots are absolute; cleanup and artifact hashes are recorded. |
| Failure modes       | Source/rights drift, host or isolation failure, candidate failure, adapter/Judge/verifier failure, missing artifact, cleanup failure.                                            |
| Oracle              | SourceManifest, RunSpec, content-addressed EvidenceVault, TrialReceipt, redaction snapshot.                                                                                      |
| Gate                | Offline fixture/replay in PR; exact-source and provider execution only as an explicit manual sampled smoke. Product `pilot` and `score` remain `not_implemented`.                |
| Owner               | `coffee-chat-eval`; Product package identity and behavior remain owned by `openboa-ai/coffee-chat`.                                                                              |

## Coffee Chat Product candidate boundary

| Field               | Contract                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective           | Bind all four sampled runner paths to the exact public Product package at `e1ac82de77ab12b9b2499771a194ef3db356b3a6` / `2026.8.23` / `sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41`.            |
| Acceptance criteria | `eval-skills-reference-host-v1` verifies origin, HEAD, clean package surface, deterministic digest, manifest identity, and exact capability/Skill entrypoints; Product Skills are never executed.                          |
| Observable evidence | Every TrialReceipt, TrackReport, public receipt, and portfolio receipt carries `connectivity_only`, empty `capabilitiesUsed`, `productBehaviorExercised=false`, the reference host, and immutable public Product identity. |
| Failure modes       | Wrong origin/commit/digest, dirty or symlinked package surface, capability drift, absent private `productPackageRoot`, Product/non-Product runtime mismatch, or public path/token leakage.                                 |
| Gate                | Offline package/preflight, transport, receipt, report, redaction, and four-track replay tests; manual four-track Product smoke. Product `pilot` and `score` are `not_implemented`.                                         |
| Claim boundary      | Connectivity only; no Product Skill, Brew/Chat behavior, Codex/ChatGPT host support, Product performance, benchmark activation, or security certification is proven. Taste remains public `not_active`.                    |

## Track acceptance map

| Track                | Native unit and metric                                                            | Required fixture gate                                                                                                            | Claim boundary                                           |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `coffee-chat-taste`  | family; 96 submissions and 672 sealed Judge calls                                 | smoke: 1 family × 3 conditions × 21 Judge calls; candidate-visible input contains no rubric                                      | smoke `calibration`; Bench `not_active`                  |
| `beam-record-core`   | conversation/category; 240 queries and six independent category metrics           | smoke: 1 conversation × six categories × one question; `int(0.5)==0` and literal `<question>` flag                               | diagnostic only; `paperComparable=false`                 |
| `ifeval`             | prompt; strict/loose prompt/instruction accuracy                                  | fixture: nine-key structural replay; production native run fails before candidate calls while `punkt_tab` rights are unclarified | native metrics only; current live state is `rights_hold` |
| `agentdojo-security` | suite user-task cluster; utility, utility-under-attack, targeted ASR, solvability | smoke: 1 benign + 1 control + 1 attacked workspace episode; provider/context error cannot become security success                | no leaderboard, certification, or general safety claim   |

## Forbidden side effects

- no benchmark task bytes, candidate prose, Judge content, attack payloads,
  tool traces, synthetic personal data, or secrets in public artifacts;
- no private Coffee Chat imports or product-internal credit;
- no Product Skill execution or non-empty `capabilitiesUsed` in the
  connectivity-only candidate;
- no Product `pilot` or `score` execution until a real public Product Brew/Chat
  interface is admitted;
- no skipped, unavailable, invalid, failed, missing, or unmeasured result
  converted to zero;
- no composite score, p-value, pass threshold, or independence claim derived
  from Judge calls/orientations rather than task sampling units.

Representative Product-boundary tests live in `tests/product-host.test.ts`,
`tests/run-engine.test.ts`, `tests/receipts.test.ts`, `tests/report.test.ts`, and
`tests/portfolio.test.ts`. Paid provider calls, Product pilots, and full score
campaigns are not CI gates.

The all-four manual merge gate is currently closed: NLTK's pinned metadata does
not provide explicit commercial-use permission for the native IFEval
`punkt_tab` package. No three-track partial run, fixture replay, or injected
bridge may be reported as the required four-track measured smoke.
