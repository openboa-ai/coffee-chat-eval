# Coffee Chat Eval plan

CalVer: `2026.8.12`

## Implemented now

```text
exact Bench commit
  -> candidate-neutral Harbor projection
  -> one case: task_only + one diagnostic condition
  -> two fresh Harbor/Docker Oracle controls
  -> structural verifier and collected answer artifact
  -> evaluator receipts marked measurement=not_performed
```

Eval validates the projection manifest and its digest, keeps the selected task
identities in the receipt, invokes only an absolute pinned Harbor executable,
and preserves host, candidate, verifier, and artifact failures as invalid
evidence. The two Oracle controls establish executable plumbing, not system
quality or benchmark validity.

## Next executable boundary

The next implementation unit is one Codex candidate adapter with provider
credentials outside candidate-readable state. The minimum acceptable design is
an exact-version OpenAI Responses proxy started by a privileged boundary and a
non-root Codex process that receives only the loopback provider endpoint. The
adapter must also bound run duration and retained outputs and must terminate the
proxy after each trial. Until those properties are demonstrated, native Harbor
Codex remains `credential_isolation_unavailable`.

After candidate artifacts exist, Bench-owned qualified judges may measure them.
Eval transports candidate-visible inputs and outputs and records provenance; it
does not reproduce Bench rubrics, qualification logic, or metric calculations.
Required CI remains deterministic and free of paid performance evaluation.

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
