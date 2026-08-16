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

| Field                 | Contract                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Objective             | Run Codex without placing provider secrets in candidate-readable state.                                                                          |
| Acceptance criteria   | Secret exists only in the privileged proxy boundary; candidate receives only an endpoint; proxy and temporary state are removed after the trial. |
| Failure modes         | Key in environment, `auth.json`, process memory, artifact, log, or retained filesystem; unbounded proxy lifetime or model access.                |
| Oracle                | Isolation test, retained-output scan, process cleanup evidence, explicit receipt state.                                                          |
| Evidence tier         | Integration, evaluation.                                                                                                                         |
| Representative suites | Not implemented; stock Harbor Codex is `credential_isolation_unavailable`.                                                                       |
| Gate                  | Manual before activation.                                                                                                                        |
| Owner                 | `coffee-chat-eval`.                                                                                                                              |

Method note: the Codex skill-evaluation pattern treats an eval as a prompt,
captured trace/artifacts, a small set of checks, and a comparable score. Eval
therefore records process evidence and applies deterministic checks before any
structured judge; it does not turn a free-form final answer into a product
contract or duplicate the candidate-independent Bench rubric.
