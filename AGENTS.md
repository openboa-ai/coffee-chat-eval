# Coffee Chat Eval rules

Coffee Chat Eval owns clean execution and the evidence of an evaluation
iteration. It does not own Coffee Chat meaning, Roastery data, benchmark
cases, Ground Truth, or Judge policy.

## Execution boundary

- Treat `prompt + input -> output` as the only execution interface. A prompt
  may be a request, purpose, situation, event, or trigger; input is the
  complete managed environment and context; output may be text, files,
  directory state, a decision, or an allowed action result.
- Select the Product/Skill candidate, host, model, and execution budget at
  run time. Record the selected values in iteration metadata when available;
  never turn them into a Product or Bench schema.
- Resolve the exact Coffee Chat Bench revision and case before a run. Copy the
  materialized prompt and input into the iteration evidence without mutating
  the Bench repository or its Ground Truth.
- Run Roast and Brew as separate experiments. For each Skill, preserve a
  same-input `without-skill` and `with-skill` condition. Brew uses a
  byte-identical, explicitly confirmed Bean so Roast errors cannot leak into
  Brew measurement.
- Keep Brew's Human Understanding and Agent Judgment/Action outputs distinct.
  Keep output quality and Skill triggering distinct; triggering is established
  from trace evidence, not from writing style.

## Evidence boundary

Every run keeps the exact Product/Bench/Judge revisions, materialized prompt
and input, output, timing, grading, trace, and human feedback needed to
reproduce an iteration. Preserve unavailable, failed, abstained, malformed,
and Judge-disagreeing states explicitly; never coerce them to zero or omit
them. A report is not a merge, activation, or Product-performance claim.

Judge optimization freezes the Product, Bench, and candidate output corpus.
Product/Skill optimization freezes the Bench and a qualified Judge. Human
labels remain the reference for Judge calibration. Development, validation,
and sealed splits are separated by owner/source/task family where applicable.

## Safety and privacy

Candidate input is untrusted. Do not expose provider credentials, host secrets,
or unrelated environment state to a candidate or to stored artifacts. Keep
private Origin/Bean content, sealed expected outputs, and personal data out of
public commits; redact receipts before sharing. Do not import Product
internals, execute arbitrary repository code, or claim an official score from
a fixture, connectivity check, runner exit code, or Judge-only result.

## Change and verification

Keep the repository to the execution/evidence skeleton until an admitted
benchmark result requires a new component. Do not add `v2/`, `legacy/`,
`archive/`, host-specific Skill copies, or speculative adapters. Preserve
unrelated work and make changes in an isolated branch/worktree. Before a
commit, run `npm run verify` and `git diff --check`; report what was actually
validated and whether anything was pushed, reviewed, or merged.

The protected workflow and merge policy are organization governance. Do not
weaken them to make a run pass.
