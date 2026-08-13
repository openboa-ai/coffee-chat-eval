# Quality Map

## Objective: trustworthy evaluator protocol canary

| Field                 | Entry                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Prove the Harbor task and separate verifier calibrate deterministically without exposing provider credentials to candidate-controlled code or creating a performance claim.              |
| Acceptance criteria   | Oracle=1 and no-op=0; malformed verifier output remains invalid; tasks default to no network; live candidate commands are absent; calibration remains `unmeasured`.                      |
| Failure modes         | Provider credentials share a process or filesystem with candidate code; public networking returns; host, verifier, and artifact failures collapse; native reward becomes a Coffee score. |
| Oracle                | Pinned task definition, sealed protocol-canary verifier, native Harbor result, and explicit Oracle/no-op reward calibration.                                                             |
| Evidence tier         | Credential-free contract/behavior and Harbor calibration in PR; live candidate integration deferred behind a safe credential broker.                                                     |
| Representative suites | `tests/harbor-canary.test.ts`, identity/matrix tests, smoke, and policy tests.                                                                                                           |
| Gate/cost             | Deterministic local/PR includes Oracle/no-op Harbor calibration; credential-bearing candidate execution is disabled.                                                                     |
| Owner                 | `openboa-ai/coffee-chat-eval`.                                                                                                                                                           |

The canary is evaluator implementation evidence. It does not cover Coffee Chat
application fidelity, utility, efficiency, benchmark validity, Coffee Blend,
or marketplace submission readiness.

## Objective: executable external-benchmark boundary

| Field                 | Entry                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Preserve one immutable external benchmark task and its separate verifier as a credential-free calibration contract without claiming that a Coffee Chat candidate consumed the case.            |
| Acceptance criteria   | Source revision/file/case digests are pinned; constraint metadata is sealed; Oracle=1 and no-op=0; the task defaults to no network; the live candidate path remains disabled.                  |
| Failure modes         | A modified prompt is mislabeled as IFEval; constraint metadata leaks; task execution is confused with a score; candidate failure becomes zero; credential-bearing candidate execution returns. |
| Oracle                | Official IFEval source manifest, candidate-visible prompt, separate constraint verifier, native Harbor result, and explicit Oracle/no-op reward calibration.                                   |
| Evidence tier         | Contract and credential-free Oracle/no-op Harbor calibration in PR; live candidate smoke deferred behind safe credential isolation.                                                            |
| Representative suites | `tests/harbor-canary.test.ts` and `evals/ifeval-smoke/`.                                                                                                                                       |
| Gate/cost             | Static contracts and Oracle/no-op calibration in PR; live Harbor/Codex candidate execution is disabled.                                                                                        |
| Owner                 | `openboa-ai/coffee-chat-eval` owns the execution projection; Google Research owns the imported IFEval construct and data; `coffee-chat-bench` remains inactive.                                |

## Objective: auditable PCDA execution boundary

| Field                 | Entry                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Execute one exact Bench family through Harbor while keeping execution, candidate, verifier, judge, and measurement states independent.                                                                                                                                                                                                   |
| Acceptance criteria   | T0/T1-A/T1-B only; Oracle=1/no-op=0; explicit spawn-local credential; exact phase-network evidence; cleanup has zero matching containers; one candidate-plus-judge ledger with the current operator-authorized cap; no raw prompt, response, or credential in receipts. The cap cannot alter benchmark measurement or validity criteria. |
| Failure modes         | Ambient auth is inherited; missing output becomes zero; verifier failure becomes candidate failure; cleanup failure issues a receipt; Eval implements Bench MAC logic; a judge-only cap is presented as a combined cap.                                                                                                                  |
| Oracle                | Native Harbor evidence, artifact digest, cleanup observation, Eval budget ledger, and staged Bench public signer output.                                                                                                                                                                                                                 |
| Evidence tier         | Deterministic contract/behavior in PR; real provider execution manual-only.                                                                                                                                                                                                                                                              |
| Representative suites | `tests/pcda-baseline.test.ts` and `npm run pcda:calibrate`.                                                                                                                                                                                                                                                                              |
| Gate/cost             | Required CI is provider-free. Bench commit `347ce5187c697a316aafe47409f428f59babbdc4` is pinned. Manual judgment receives the bounded candidate-settled remainder.                                                                                                                                                                       |
| Owner                 | Eval owns execution and receipts; Bench owns attestation and judgment authority.                                                                                                                                                                                                                                                         |
