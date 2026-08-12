# PCDA Harbor baseline report

## Outcome

This campaign proves one complete Harbor-first Codex execution round trip for
the public PCDA family. It does **not** provide a Coffee Chat performance score
or evidence that Coffee Chat Bench is ready for activation.

The campaign result is `unmeasured`. Harbor completed T0, T1-A, and T1-B, and
each condition produced an inspectable artifact. The native verifier classified
all three outputs as `candidate_failure`, so judging was correctly skipped
without a provider call and no condition became measured.

The raw campaign receipt is preserved exactly as emitted, but its
`candidate_invalid` condition states must not be used. Eval collapsed every
rejected verifier verdict while constructing the Bench attestation. The
operator-audited native verdict digests and corrected interpretation are bound
in `baseline-state-correction.json`; the evaluator regression fix preserves
these states for subsequent runs.

## Fixed provenance

| Field          | Value                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Eval release   | `2026.8.12`                                                               |
| Eval commit    | `0441ef0492b0dcdd4af8ddf8fdf2773ec5bf4ade`                                |
| Bench commit   | `3bec0fe9f8f03216418fd437dfb30eb40a2e5775`                                |
| Bank digest    | `sha256:ca46f71ea977cb884395a3f35f676b157600baaeadc69ee051ca34355e5a85b4` |
| Candidate      | native Codex with `gpt-5.6-terra`                                         |
| Conditions     | T0, T1-A, T1-B                                                            |
| Repetition     | 0                                                                         |
| Execution path | Harbor `0.21.0`, Docker, Codex `0.147.0`                                  |

The candidate used an explicitly authorized OpenAI API credential supplied
only to the Harbor child process. It did not inherit a host Codex login,
Keychain material, `~/.codex`, or ambient provider credentials. No credential,
prompt, model response, or authorization header is included in the published
receipt.

## Condition results

| Condition | Execution | Candidate | Verifier   | Judge   | Measurement | Settled candidate cost |
| --------- | --------- | --------- | ---------- | ------- | ----------- | ---------------------: |
| T0        | completed | failed    | unmeasured | skipped | unmeasured  |              $0.194616 |
| T1-A      | completed | failed    | unmeasured | skipped | unmeasured  |              $0.218704 |
| T1-B      | completed | failed    | unmeasured | skipped | unmeasured  |              $0.213106 |

The campaign settled candidate cost is $0.626426. Judge cost is $0 because no
judge provider call was made. The receipt preserves $49.373574 of the $50
campaign cap. These values describe this campaign only and are not benchmark
efficiency measurements.

## What this establishes

- A clean, pinned Eval commit consumed a clean, pinned Bench commit.
- Harbor executed all three projected conditions sequentially with native
  trial identities and artifact digests.
- The native verifier distinguished a structurally valid but rejected candidate
  response from an invalid artifact; the published correction preserves that
  evidence while leaving the original receipt bytes unchanged.
- Rejected candidate outputs did not receive inferred scores or trigger judge
  spending.
- The run completed without a host or verifier exception, and Docker cleanup
  completed after every condition.

## What remains unproven

- No condition produced a valid, measured artifact.
- The live Terra/Luna cross-judge path was not exercised because deterministic
  admission failed first.
- This single family does not establish reliability, construct validity,
  generalization, utility improvement, or benchmark activation.
- Coffee Chat Product and Plugin installation were outside this run.

The next performance experiment must first produce an admitted task-only or
direct-context artifact. Only then may the sealed Terra/Luna judgment path run
and generate evidence relevant to Coffee Chat improvement.
