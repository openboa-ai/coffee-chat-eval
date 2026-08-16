# Codex judge transport probe

CalVer: `2026.8.12`

## Result

The Eval-owned Responses judge transport sent the frozen pairwise
`task_utility` request for `ccbench-ra-s1-dialogue-01` to both approved account
models. The provider returned strict JSON from both calls:

- `gpt-5.6-terra`: `tie`
- `gpt-5.6-luna`: `right`

The response digests and provenance are in
[`codex-judge-probe.json`](codex-judge-probe.json). Raw model response text is
not checked in.

## Interpretation

This is a transport and cross-model disagreement probe, not a benchmark score.
The Bench qualification study has no genuine human annotation records, so no
qualified runtime judge configuration exists. The two primary votes also
disagree. The receipt therefore preserves both votes and records
`measurement: unmeasured`; it does not collapse disagreement into a pass,
fail, or numeric value.

## Next evidence

Human criterion labels and judge qualification must be completed in the Bench
repository before this transport can participate in semantic measurement.
