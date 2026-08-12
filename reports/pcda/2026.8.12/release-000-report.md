# PCDA release/000 Harbor report

## Outcome

This campaign proves that one pinned public PCDA case can run through the
Harbor-first Codex path and reach sealed Terra/Luna judgment after deterministic
admission. It does **not** provide a Coffee Chat performance score or evidence
that Coffee Chat Bench is ready for activation.

The campaign result is `unmeasured` because a campaign is measured only when
all three conditions are measured. T0 was classified as `candidate_failure`.
T1-A and T1-B were accepted by the deterministic verifier and each completed
the live two-judge path.

## Fixed provenance

| Field        | Value                                                                     |
| ------------ | ------------------------------------------------------------------------- |
| Eval release | `2026.8.12`                                                               |
| Eval commit  | `c200d6e3f1f431529ef0c52e2ab7f12064602dee`                                |
| Bench commit | `347ce5187c697a316aafe47409f428f59babbdc4`                                |
| Bank digest  | `sha256:ca46f71ea977cb884395a3f35f676b157600baaeadc69ee051ca34355e5a85b4` |
| Case         | `bank/campaign/release/000.json`                                          |
| Candidate    | native Codex with `gpt-5.6-terra`                                         |
| Judge panel  | `gpt-5.6-terra`, `gpt-5.6-luna`                                           |
| Conditions   | T0, T1-A, T1-B                                                            |
| Repetition   | 0                                                                         |

The candidate and judge calls used the explicitly authorized OpenAI API
credential. The candidate received it only through its dedicated Harbor child
binding; no host Codex login, Keychain material, `~/.codex`, or ambient provider
credential was inherited. No credential, prompt, response, or authorization
header is included in the published receipt.

## Condition results

| Condition | Candidate | Verifier   | Judge    | Measurement | Candidate cost | Judge cost |
| --------- | --------- | ---------- | -------- | ----------- | -------------: | ---------: |
| T0        | failed    | unmeasured | skipped  | unmeasured  |      $0.216442 | $0.0000000 |
| T1-A      | completed | accepted   | measured | measured    |      $0.219630 | $0.0061836 |
| T1-B      | completed | accepted   | measured | measured    |      $0.189948 | $0.0062428 |

The campaign settled $0.626020 of candidate cost and $0.0124264 of judge cost,
for $0.6384464 total. The receipt preserves $49.3615536 of the $50 campaign
cap. These values describe this run only and are not benchmark efficiency
measurements.

## What this establishes

- Eval and Bench were both clean and pinned to exact commits.
- Harbor executed T0, T1-A, and T1-B sequentially with native trial identities.
- T0 rejection remained `candidate_failure`; it was not collapsed into an
  invalid artifact or converted to a zero score.
- T1-A and T1-B passed deterministic admission and exercised the sealed
  Terra/Luna judgment path.
- Candidate, verifier, and judge state remained distinct in the receipt.
- All campaign-created Harbor containers were absent after completion.

## What remains unproven

- One of three conditions was unmeasured, so this is not a complete family
  measurement.
- One case and one repetition cannot establish reliability, validity,
  generalization, utility improvement, or benchmark activation.
- The receipt intentionally exposes judge state and result digests, not hidden
  vote content or an inferred aggregate performance score.
- Coffee Chat Product and Plugin installation were outside this run.

The next experiment should diagnose the T0 task-only failure as candidate
behavior, then run prespecified additional cases and repetitions. Benchmark
activation remains gated by the existing reliability and validity protocol.
