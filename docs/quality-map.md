# Quality Map

## Objective: clean evaluator migration shell

| Field                 | Entry                                                                                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Preserve evaluator-owned orchestration/reporting boundaries without private product access, benchmark validity ownership, or a performance claim.                                                                      |
| Acceptance criteria   | Public candidate/task/harness/model/host/repetition types form stable unique matrix identities; dry run exposes fixture `unmeasured` and real-host `unavailable`; no score is emitted; deferred execution is explicit. |
| Failure modes         | Duplicate identity, empty matrix axis, collapsed result state, a fixture/dry run score, private Coffee Chat dependency, or workflow authority outside `OWNER` and `MEMBER`.                                            |
| Oracle                | Scenario tests, dry-run CLI report, and policy check.                                                                                                                                                                  |
| Evidence tier         | contract and behavior, migration shell only.                                                                                                                                                                           |
| Representative suites | `tests/identity.test.ts`, `tests/matrix.test.ts`, `tests/smoke.test.ts`, `tests/governance-policy.test.ts`.                                                                                                            |
| Gate/cost             | Local and PR; fast.                                                                                                                                                                                                    |
| Owner                 | `openboa-ai/coffee-chat-eval`.                                                                                                                                                                                         |

### Scope decision

The suite fixes the migration-shell boundary, not evaluator performance,
benchmark validity, or E2E behavior. Provider execution, artifact persistence,
isolation attestation, verifier metrics, timing, detailed receipts, and real
E2E are deferred.

Migration and bootstrap evidence is not an evaluator capability. CalVer is the
only release identity and no compatibility layer is tested or supported.
