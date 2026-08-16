# Codex judge transport probe

CalVer: `2026.8.12`

## Result

The Eval-owned Responses judge transport sent the current frozen pairwise
`task_utility` request for `ccbench-ra-s1-dialogue-01` against the final
Bench commit and current judge protocol. The configured cross-validation set
was executed:

- `gpt-5.6-sol`: succeeded with `left`;
- `gpt-5.6-terra`: succeeded with `left`;
- `gpt-5.6-luna`: succeeded with `right`.

The transport probe therefore confirms access and structured responses for
all three configured models, but the models disagree on this request (`left`,
`left`, `right`).

The response digest and provenance are in
[`codex-judge-probe.json`](codex-judge-probe.json). Raw model response text is
not checked in. Provider errors are reduced to explicit failure codes and no
credential or project identifier is stored.

## Interpretation

This is a transport and cross-model probe, not a benchmark score.
The current Bench qualification study digest and judge protocol are recorded
in the receipt. The study still has no genuine human annotation records, so no
qualified runtime judge configuration exists. The transport set is complete,
but its disagreement is preserved as evidence rather than resolved by a
majority vote. The receipt therefore records `measurement: unmeasured`; it
does not collapse the result into a pass, fail, or numeric value.

## Next evidence

Human criterion labels and judge qualification must be completed in the Bench
repository before this transport can participate in semantic measurement. The
`left`/`right` disagreement must remain visible in that qualification and
reliability work.
