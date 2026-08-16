# Coffee Chat Eval plan

CalVer: `2026.8.12`

## Implemented now

The current evidence pins the merged `coffee-chat-bench` main commit
`1bc71605964770bbd1bd96e049b8412b6ee068fc`.

```text
exact Bench commit
  -> candidate-neutral Harbor projection
  -> one case: task_only + one diagnostic condition
  -> two fresh Harbor/Docker Oracle controls
  -> four Codex candidate trials: Luna/Terra x task_only/diagnostic_target_a
  -> host-held Responses proxy with per-trial capability token
  -> structural verifier, trace/artifact collection, and cleanup evidence
  -> evaluator receipts marked measurement=unmeasured
```

Eval validates the projection manifest and its digest, keeps the selected task
identities in the receipt, invokes only an absolute pinned Harbor executable,
and preserves host, candidate, verifier, and artifact failures as invalid
evidence. The two Oracle controls establish executable plumbing, not system
quality or benchmark validity. The four Codex receipts establish that the first
credential-isolated Harbor candidate path can execute the same public task
projection for both allowed account models. They do not establish semantic
quality, utility, target transfer, or benchmark activation.

## Judge handoff boundary

The Eval-owned `JudgeTransport` boundary is implemented as a host-held
Responses proxy. It calls only the approved judge models, sends a
schema-constrained verdict request, and preserves unavailable, failed,
invalid, and disagreeing votes. The recorded probe is deliberately
`qualificationState: unqualified` and `measurement: unmeasured`: the Bench
qualification study currently has no genuine human annotation records, and
the current three-model probe has an unavailable Sol model. No response is
promoted to benchmark measurement.

The probe is retained as transport evidence in
[`reports/2026.8.12/codex-judge-probe.json`](reports/2026.8.12/codex-judge-probe.json)
and its interpretation is recorded in
[`reports/2026.8.12/codex-judge-probe-report.md`](reports/2026.8.12/codex-judge-probe-report.md).

The merged Bench main commit was independently exercised through two fresh
Harbor 0.21 Oracle controls and retained in
[`reports/2026.8.12/oracle-control-1bc7160-receipt.json`](reports/2026.8.12/oracle-control-1bc7160-receipt.json).
Both receipts record `verifierEnvironmentMode: separate`, Docker cleanup, and
the current projection digest. This refreshes execution/provenance evidence
only; it does not create a semantic score or replace the missing human
qualification evidence.

After human qualification evidence exists, Eval transports candidate-visible
inputs and outputs to the Bench-owned qualified judge and records provenance;
it does not reproduce Bench rubrics, qualification logic, or metric
calculations. Until then, the next executable unit is Bench qualification and
validity evidence, not a score-producing runtime. Required CI remains
deterministic and free of paid performance evaluation.

## Eval method reference

The first Codex adapter will use the small, inspectable loop described in
[Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills):
define success before implementation, capture a structured trace and artifacts,
run cheap deterministic checks, and use a schema-constrained judge only for
criteria that are not mechanically observable. This informs the Eval runner's
receipt and adapter boundary; it does not make the adapter the owner of Bench
semantics. A small 10–20 case regression subset may be used for fast iteration,
while the public Bench bank remains the source of candidate-independent
measurement.
