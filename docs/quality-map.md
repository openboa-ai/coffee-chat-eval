# Quality Map

## Objective: deterministic evaluator baseline

| Field                 | Entry                                                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Orchestrate declared external candidate trials without private product access or a fixture performance claim.                       |
| Acceptance criteria   | Trial tuples expand stably; receipts retain redacted evidence and cleanup; status remains explicit; dry run has no score.           |
| Failure modes         | Duplicate identity, unproven isolation, secret leakage, missing artifact treated as zero, collapsed failure owner, missing cleanup. |
| Oracle                | Deterministic identity/runner/receipt/report tests and the CLI report.                                                              |
| Evidence tier         | contract and behavior, fixture-only.                                                                                                |
| Representative suites | `tests/identity.test.ts`, `tests/matrix.test.ts`, `tests/runner.test.ts`, `tests/receipt.test.ts`, `tests/report.test.ts`.          |
| Gate/cost             | Local and PR; fast.                                                                                                                 |
| Owner                 | `openboa-ai/coffee-chat-eval`.                                                                                                      |

### Scope decision

The suite fixes public contracts and forbidden side effects, not model quality.
Real provider, model, isolated-host, or benchmark evidence is intentionally
unavailable in this baseline.
