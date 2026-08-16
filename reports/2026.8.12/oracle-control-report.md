# Harbor Oracle control report

CalVer: `2026.8.12`

## Result

The candidate-neutral Bench projection was executed with Harbor `0.21.0` for
one case under two conditions:

- `task_only`
- `diagnostic_target_a`

Both fresh Docker trials produced a collected answer artifact, passed the
structural verifier, recorded `nativeEnvironmentDelete: true`, and parsed as
`resultState: executed` with `verifierEnvironmentMode: separate`. The
normalized receipt is in `oracle-control-1bc7160-receipt.json` and pins the
merged Bench main commit
`1bc71605964770bbd1bd96e049b8412b6ee068fc`.

## Interpretation

The Oracle reward of `1` confirms only the Bench task's structural output
contract and the Harbor execution boundary. It is not candidate quality, Taste
fidelity, utility, or benchmark measurement. Both receipts therefore retain
`measurement: not_performed`.

The run also confirms that the public receipt contains task and provenance
digests but no local projection path or provider credential.

## Boundary

Stock Harbor Codex remains unavailable for this evaluator because its native
credential path is candidate-readable. The separate `harbor-codex-proxy`
adapter now provides the manual candidate path; its four-trial execution
evidence is recorded in `codex-baseline-receipts.json`. Those receipts remain
unmeasured until the Bench-owned judge qualification and validity boundary are
complete.
