# Quality Map

## Objective: trustworthy evaluator protocol canary

| Field                 | Entry                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Prove that an exact Coffee Chat Plugin commit can traverse Harbor, real Codex installation/discovery/invocation, a separate verifier, cleanup, and Eval reporting without creating a performance claim.                                                    |
| Acceptance criteria   | Oracle=1, no-op=0, real Codex=1; malformed verifier output remains invalid; source/cache digests match; fresh Skill discovery and public entrypoint invocation are trace-visible; receipt is `unmeasured`; cleanup is verified.                            |
| Failure modes         | Host, candidate, verifier, and artifact failures collapse; Plugin source is injected as a Skill instead of installed; moving or dirty candidate bytes run; trace is absent; native reward becomes a Coffee score; live model execution enters required CI. |
| Oracle                | Sealed protocol-canary verifier, native Harbor result, Plugin installation records, Codex trajectory, digest comparison, and cleanup observation.                                                                                                          |
| Evidence tier         | Contract/behavior in PR; real host integration in manual gate.                                                                                                                                                                                             |
| Representative suites | `tests/harbor-canary.test.ts`, identity/matrix tests, smoke, and policy tests.                                                                                                                                                                             |
| Gate/cost             | Deterministic local/PR includes Oracle/no-op Harbor calibration; real Codex is manual integration.                                                                                                                                                         |
| Owner                 | `openboa-ai/coffee-chat-eval`.                                                                                                                                                                                                                             |

The canary is evaluator implementation evidence. It does not cover Coffee Chat
application fidelity, utility, efficiency, benchmark validity, Coffee Blend,
or marketplace submission readiness.

## Objective: executable external-benchmark boundary

| Field                 | Entry                                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Objective             | Prove that one immutable external benchmark case can execute in the same Harbor/Codex task that invokes an exact installed Coffee Chat Plugin boundary and produce auditable evidence without pretending that an unimplemented entrypoint consumed it.    |
| Acceptance criteria   | Source revision/file/case digests are pinned; constraint metadata is sealed; Oracle=1 and no-op=0; the real run emits `executionStatus=executed`, `benchmarkInputRead=verified`, `candidateInputDelivery=not_supported`, and `measurement=not_performed`. |
| Failure modes         | A modified prompt is mislabeled as IFEval; constraint metadata leaks; task execution is confused with a score; candidate failure becomes zero; real Codex/model benchmark execution enters required CI.                                                   |
| Oracle                | Official IFEval source manifest, candidate-visible prompt, separate constraint verifier, native Harbor result, collected candidate artifact, Codex trajectory, and execution receipt.                                                                     |
| Evidence tier         | Contract and Oracle/no-op Harbor calibration in PR; real Codex benchmark smoke in manual integration.                                                                                                                                                     |
| Representative suites | `tests/harbor-canary.test.ts` and `evals/ifeval-smoke/`.                                                                                                                                                                                                  |
| Gate/cost             | Static contracts in PR; one-case Harbor/Codex execution is manual.                                                                                                                                                                                        |
| Owner                 | `openboa-ai/coffee-chat-eval` owns the execution projection; Google Research owns the imported IFEval construct and data; `coffee-chat-bench` remains inactive.                                                                                           |
