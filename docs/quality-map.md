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

## Objective: auditable PCDA calibration boundary

| Field                 | Entry                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Validate the PCDA Harbor package deterministically without loading candidate code or provider credentials.                                                                                        |
| Acceptance criteria   | Oracle=1 and no-op=0; native verifier failures remain explicit; calibration inputs are bounded regular files; no candidate, signer, judge, or provider execution command exists.                  |
| Failure modes         | A credential-bearing candidate command returns; calibration becomes a performance result; malformed or oversized native evidence is accepted; provider credentials enter the calibration process. |
| Oracle                | Checked-in bounded native Oracle/no-op result fixtures and the separate Harbor verifier contract.                                                                                                 |
| Evidence tier         | Credential-free deterministic contract and behavior in PR.                                                                                                                                        |
| Representative suites | `tests/pcda-baseline.test.ts` and `npm run pcda:calibrate`.                                                                                                                                       |
| Gate/cost             | Required CI is provider-free. Live execution remains unavailable until a reviewed credential broker or split service exists.                                                                      |
| Owner                 | Eval owns the credential-free calibration boundary.                                                                                                                                               |

Routine documentation-only pull requests use the approval-free lane;
`coffee-security` remains reserved for policy evolution and protected paths.
