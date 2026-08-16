# Codex judge transport probe

CalVer: `2026.8.12`

## Result

The Eval-owned Responses judge transport sent the frozen pairwise
`task_utility` request for `ccbench-ra-s1-dialogue-01` against the final
Bench commit. The configured cross-validation set was attempted:

- `gpt-5.6-sol`: unavailable because the configured project could not access
  that model;
- `gpt-5.6-terra`: succeeded with `left`;
- `gpt-5.6-luna`: failed because the provider returned no structured output.

The response digest and provenance are in
[`codex-judge-probe.json`](codex-judge-probe.json). Raw model response text is
not checked in. Provider errors are reduced to explicit failure codes and no
credential or project identifier is stored.

## Interpretation

This is a transport and cross-model disagreement probe, not a benchmark score.
The Bench qualification study has no genuine human annotation records, so no
qualified runtime judge configuration exists. The judge set is incomplete and
cannot support cross-model agreement. The receipt therefore preserves
success, unavailable, and failed states and records `measurement: unmeasured`;
it does not collapse the result into a pass, fail, or numeric value.

## Next evidence

Human criterion labels, model-access resolution, and judge qualification must
be completed in the Bench repository before this transport can participate in
semantic measurement.
