# Quality Map

## Objective: deterministic evaluator baseline

| Field                 | Entry                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Orchestrate declared external candidate trials without private product access or a fixture performance claim.                                                                                                       |
| Acceptance criteria   | Trial tuples bind evaluator and host configuration; receipts retain a host-supplied artifact locator, redacted inspectable evidence, and cleanup; status remains explicit; dry run has no score.                    |
| Failure modes         | Duplicate or under-specified identity, invented or unresolvable artifact locator, unproven isolation, secret leakage, malformed artifact misattribution, non-JSON metric, collapsed failure owner, missing cleanup. |
| Oracle                | Deterministic identity/runner/receipt/report tests and the CLI report.                                                                                                                                              |
| Evidence tier         | contract and behavior, fixture-only.                                                                                                                                                                                |
| Representative suites | `tests/identity.test.ts`, `tests/matrix.test.ts`, `tests/runner.test.ts`, `tests/receipt.test.ts`, `tests/report.test.ts`.                                                                                          |
| Gate/cost             | Local and PR; fast.                                                                                                                                                                                                 |
| Owner                 | `openboa-ai/coffee-chat-eval`.                                                                                                                                                                                      |

### Scope decision

The suite fixes public contracts and forbidden side effects, not model quality.
Real provider, model, isolated-host, or benchmark evidence is intentionally
unavailable in this baseline.

The migration classifications are bootstrap-only authority. Post-bootstrap
changes are evaluated against this Quality Map and the ordinary PR gates; they
do not rewrite the immutable bootstrap selection or receipt. Fork PRs are
intake evidence only until reviewed commits are promoted to a same-repository
branch capable of producing the required native coverage result.
