# Coffee Chat Eval quality map

## Objective: reproducible candidate-neutral execution

| Field                 | Contract                                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Execute exact Bench-projected conditions without importing product or benchmark internals.                                                   |
| Acceptance criteria   | Exact Bench commit and digests are recorded; one case selects `task_only` and one diagnostic condition; each receives a fresh Harbor job.    |
| Failure modes         | Projection tampering, duplicate task identity, reused output directory, host failure, candidate failure, verifier failure, invalid artifact. |
| Oracle                | Bench projection digest, Harbor native result, collected artifact, evaluator receipt.                                                        |
| Evidence tier         | Contract, integration.                                                                                                                       |
| Representative suites | `tests/bench-harbor.test.ts`; manual `bench:oracle` run.                                                                                     |
| Gate                  | Deterministic contracts in PR; installed Harbor execution manual.                                                                            |
| Owner                 | `coffee-chat-eval`.                                                                                                                          |

## Objective: credential-isolated Codex execution

| Field                 | Contract                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Run Codex without placing provider secrets in candidate-readable state.                                                                                                                                    |
| Acceptance criteria   | Provider secret exists only in the privileged proxy boundary; candidate receives a capability token and endpoint config but never the provider key; proxy and temporary state are removed after the trial. |
| Failure modes         | Key in environment, `auth.json`, process memory, artifact, log, or retained filesystem; unbounded proxy lifetime or model access.                                                                          |
| Oracle                | Isolation test, retained-output scan, process cleanup evidence, explicit receipt state.                                                                                                                    |
| Evidence tier         | Integration, evaluation.                                                                                                                                                                                   |
| Representative suites | `tests/codex-isolation.test.ts`; four-trial Harbor/Codex baseline receipt.                                                                                                                                 |
| Gate                  | Manual before activation.                                                                                                                                                                                  |
| Owner                 | `coffee-chat-eval`.                                                                                                                                                                                        |

## Objective: qualified semantic judgment handoff

| Field                 | Contract                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Deliver candidate artifacts to the Bench-owned judge protocol without redefining its construct, rubric, qualification, or metrics.                                            |
| Acceptance criteria   | Frozen prompt and model identities are provenance-bound; every vote is measured, unavailable, failed, invalid, or disagreement explicitly; unqualified evidence cannot score. |
| Failure modes         | Missing qualification, prompt injection in quoted task data, malformed judge JSON, model disagreement, provider failure, accidental score promotion.                          |
| Oracle                | Bench qualification digest, judge response digest, explicit vote state, and no numeric report for unqualified evidence.                                                       |
| Evidence tier         | Evaluation.                                                                                                                                                                   |
| Representative suites | Bench judge contract tests plus Eval transport contract tests; no live judge call in CI.                                                                                      |
| Gate                  | Manual after Bench qualification evidence.                                                                                                                                    |
| Owner                 | `coffee-chat-eval` transport / `coffee-chat-bench` protocol.                                                                                                                  |

Method note: the Codex skill-evaluation pattern treats an eval as a prompt,
captured trace/artifacts, a small set of checks, and a comparable score. Eval
therefore records process evidence and applies deterministic checks before any
structured judge; it does not turn a free-form final answer into a product
contract or duplicate the candidate-independent Bench rubric.
