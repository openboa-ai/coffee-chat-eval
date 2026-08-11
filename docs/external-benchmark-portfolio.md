# External benchmark portfolio projection

- **Workspace decision:** 2026-08-11
- **Repository role:** native benchmark execution, Coffee candidate evaluation,
  receipts, and performance reporting
- **Canonical rationale:** workspace
  `docs/engineering/external-benchmark-portfolio.md`
- **Runtime state:** one IFEval case has an execution-only adapter smoke; no
  measured Coffee Chat result exists

## Current execution smoke

`evals/ifeval-smoke/` pins official IFEval case `1001`, its source commit,
source-file digest, exact-line digest, Apache-2.0 attribution, and excluded
historical response assets. The candidate sees only the prompt and source
identity; the deterministic `punctuation:no_comma` constraint remains in the
separate verifier.

This smoke proves only that benchmark input is staged and read in the same task
that invokes an exact installed Coffee Chat Plugin boundary, and that Harbor
artifact collection, verifier execution, Codex trace evidence, cleanup, and
receipt generation work. The current entrypoint cannot accept that input, so
`candidateInputDelivery=not_supported` remains separate from
`executionStatus=executed`, `resultState=not_implemented`, and
`measurement=not_performed`. Native reward is raw pipeline evidence and is not
a Coffee Chat score.

## Shared evaluation target

`coffee-chat` and `coffee-blend` are two application forms of one AI objective:

> Does explicitly selected Taste manifest correctly in an output and increase
> task-level usefulness, and does that eventually improve downstream work or
> decisions?

The selected external sources measure application and output-level utility
proxies. They do not measure realized downstream utility such as decision
quality, project success, follow-up behavior, or long-term benefit.

The evaluator uses one result model and, when the source task and oracle permit,
the same task under three conditions:

| Condition | Selected context                       | Product surface         |
| --------- | -------------------------------------- | ----------------------- |
| `C0`      | none                                   | ordinary agent baseline |
| `C1`      | one selected person's context          | Coffee Chat             |
| `CN`      | one complete selected multi-person set | Coffee Blend            |

No selected external benchmark natively implements all three conditions. `CN`
therefore remains `unmeasured`; it is not inferred from repeated `C1` runs.
For an uplift claim, task, candidate, harness, model, host, tool access,
external-information snapshot, output budget, and verifier remain fixed. Extra
agent calls or search/critique stages are separate treatments; additional
context tokens are recorded as efficiency cost.

## Evidence dimensions

The evaluator never substitutes one dimension for another:

- **application fidelity:** selected, relevant judgments are manifested without
  stale use, invention, omission, or owner conflation;
- **output utility-proxy uplift:** human-aligned need fit, actionability, depth,
  or presentation under a selected condition compared with the same output
  oracle without it;
- **reliability guardrails:** task-specific factual or evidential correctness;
  and
- **efficiency:** latency, tokens, cost, tool calls, and successful
  utility-proxy gain per unit cost.

Application fidelity without a proxy gain does not prove output value. A proxy
gain without application evidence does not attribute the improvement to
selected Taste. Neither proves realized downstream utility. Reliability and
efficiency remain independent evidence rather than score ingredients. There is
no cross-benchmark composite.

BESPOKE gold-information recall is required-information coverage, not
response-wide reliability. PDR-Bench `R` is the portfolio's only selected
factual/citation guardrail, and it remains limited by judge validity. Full
support for every additional claim is unmeasured.

## Adopted evaluator queue

| Order | Source                            | Evaluator role                                                    | State                       |
| ----: | --------------------------------- | ----------------------------------------------------------------- | --------------------------- |
|     1 | PersonaMem v1, official 32k track | deterministic harness and application-fidelity diagnostic         | `selected_diagnostic`       |
|     2 | BESPOKE                           | primary conversational application and output utility-proxy track | `selected_primary`          |
|     3 | PDR-Bench                         | agentic application/actionability plus Q/R guardrail pilot        | `selected_calibrated_pilot` |

The execution order starts with PersonaMem only because its deterministic
scorer is the cheapest way to validate the evaluator boundary. BESPOKE remains
the first primary output-proxy measurement. PDR-Bench remains a pilot until its
judge is calibrated and repeated.

## Research identities observed during selection

These are inputs to source preflight, not permanent runtime pins. A receipt must
record the exact revisions and digests actually used.

```text
BESPOKE code:
  46294be6816db1ae2c89286e6d725f6a6d75bb20
BESPOKE dataset:
  f2597c9ca05ad84e2a5664faba9b4eb2be928500

PDR-Bench code and included data:
  5b43f9f188c747d154fc7666812ab93b7ca6a3c2

PersonaMem code:
  caaae44b3f236b8751d499a770e94e5aecffcff1
PersonaMem-v1 dataset:
  73dfd752d477d0c466cd441f1669397f5726d7ab
```

Verified rights at those observations:

- BESPOKE official code and dataset: MIT;
- PDR-Bench repository and included data: Apache-2.0; and
- PersonaMem official code and dataset: MIT.

Paper-document licenses are recorded separately and do not override code/data
terms. Source preflight must still inspect transitive assets and provider terms.

## Native versus Coffee-derived execution

A native benchmark run preserves upstream candidate-visible inputs, sealed
labels, task identity, and metric. A Coffee-derived run may only repackage exact
visible bytes in trial-local state and must be labeled `derived`.

Condition identity uses separate fields:

```text
source_condition
  exact upstream label and configuration

coffee_condition
  C0 | C1 | CN | not_applicable

coffee_condition_analogy
  optional C0_like | C1_like | CN_like | none metadata
```

Native execution treats `source_condition` as authoritative,
`coffee_condition` as `not_applicable`, and any Coffee analogy as non-scoring
interpretation metadata. Only derived Coffee execution assigns an actual
`C0/C1/CN` Product treatment.

Derived execution must:

- use only a public candidate interface;
- preserve source order and exact candidate-visible meaning;
- keep answer keys, rubrics, and evaluator-only metadata sealed;
- write nothing to an owner's Roastery;
- remove trial-local state after evidence capture;
- compare the same candidate in native and projected forms; and
- report projection disagreement rather than silently accepting semantic drift.

Converting raw history into stronger summaries, treating five independent
single-user cases as one group, or changing the verifier creates a new
experiment and cannot carry the upstream benchmark score.

## Track-specific requirements

### PersonaMem diagnostic

- start with the official 32k discriminative track;
- preserve four-choice accuracy, chance floor, and per-query-family results;
- parse and receipt the exact case inventory rather than copying an approximate
  count from documentation;
- include malformed output, no-op, wrong/stale-context, and scorer-repeat
  controls; and
- label every result `application_fidelity_diagnostic`, never value or utility.

PersonaMem has no native `C0` or `CN`, uses synthetic history, and cannot answer
whether an open output is useful. Its human check used three paper authors and
90 samples from one simulated person; best-response agreement was only moderate
(`AC1=0.560`). Treat it as synthetic-data quality evidence, not population or
utility validation.

### BESPOKE primary track

- reproduce native data and evaluator behavior before Coffee projection;
- retain need alignment, content depth, tone, explanation style, and
  gold-information recall as separate dimensions; call recall
  required-information coverage, not full factual reliability;
- preserve native history-usage, query-awareness, history-selection, and
  raw/profile labels;
- run any derived `C0/C1` task under fixed generation, search, model, host, and
  evaluator policy;
- repeat the LLM judge and report paired output-proxy deltas and uncertainty;
- receipt candidate generation/search cost separately from the approximately
  `$0.10` evaluator cost reported per response; and
- avoid interpreting raw history or an inferred profile as owner-approved
  Coffee Beans without a declared derived projection.

BESPOKE provides no `CN` result.

### PDR-Bench calibrated pilot

- use a prespecified bounded sample from the released 150-query path;
- retain Personalization, Quality, and Reliability dimensions rather than
  optimizing only the upstream overall score;
- preserve native Task Only / Task with Context / Task with explicit profile
  labels;
- interpret the published condition contrast only for Personalization `P`; any
  P/Q/R paired comparison is a separately labeled derived analysis;
- calibrate and repeat the judge before a Coffee performance claim;
- disclose that the paper's 15-query human-consistency sample reports best
  judge agreement of PCA `0.43` and MARD `1.40`, with judge cost of about
  `$0.68` per query; and
- pin or replace unsafe/under-specified research orchestration without changing
  task or metric semantics.

Each profile-task pair is a single-person case. Combining profiles is not a
native Blend condition. The profiles and contexts are Chinese-centered; the
English release is a semantically aligned parallel version, so broad-language
or population claims are prohibited.

## Receipt and result-state contract

Every result must identify:

```text
candidate commit/package
benchmark source and task
native or derived mode
source_condition
coffee_condition = C0 | C1 | CN | not_applicable
coffee_condition_analogy, if declared
agent/harness
model
host/provider
repetition
candidate artifact
verifier and judge identity
dimension scores
tokens, latency, tool calls, and cost
cleanup and no-owner-write evidence
```

Result states remain explicit:

- measured;
- `not_implemented` candidate capability;
- `unavailable` source, host, provider, or dependency;
- `unmeasured` dry run or unsupported condition;
- invalid candidate artifact;
- candidate failure;
- host failure;
- adapter failure; and
- verifier or judge failure.

No state is converted to zero or silently omitted.

Before a measured run, the evaluator must persist a dependence-aware analysis
plan. It predeclares primary dimensions, paired estimator, interval method,
multiplicity policy, and pilot viability thresholds. BESPOKE queries are nested
within users, PDR profiles repeat within tasks, and PersonaMem questions cluster
within simulated person/history. Task-sampling uncertainty and repeated-judge
variance are estimated separately. Judge stability, invalid rate,
reproducibility, runtime, and cost gates are set before candidate scores are
seen.

## Execution shape

```text
candidate
  x benchmark/task source
  x exact source condition
  x Coffee condition or not_applicable
  x agent/harness
  x model
  x host/provider
  x repetition
  -> isolated candidate artifact
  -> separate verifier or judge
  -> dimensional result plus efficiency receipt
  -> performance report
```

Harbor and Terminal-Bench are design references for task/environment/verifier
separation and agent adapters. They are not Coffee Chat performance tracks and
are not required dependencies.

## Explicit exclusions

- Product lifecycle and deterministic commands are not external AI scores.
- Mechanical citation formatting remains a Product contract.
- ALCE is not selected: it tests factual citation grounding, not whether
  selected Taste improves an output.
- PrefEval, LaMP, and PersonaLens remain research references because their
  noncommercial licenses conflict with automatic marketplace-oriented adoption.
- Generic memory, terminal, browser, software-engineering, and customer-service
  benchmarks measure neighboring agent capabilities, not the Coffee objective.
- No `coffee-chat-bench` task, metric, verifier, or score is created in this
  decision.

## Completion boundary for the next Goal

The next Goal completes source preflight and one honest native evidence path,
then implements a separately labeled BESPOKE derived `C0/C1` output-proxy path
and a calibrated PDR application/actionability pilot. It does not implement
Coffee Chat, Coffee Blend, or the missing `CN` benchmark.

An adapter passing its own tests proves evaluator mechanics only. Coffee
performance remains `not_implemented` or `unmeasured` until a pinned public
candidate implements the target behavior.

## Primary sources

- [BetterBench](https://proceedings.neurips.cc/paper_files/paper/2024/file/26889e8359e7ef8a7f5d77457364ca55-Paper-Datasets_and_Benchmarks_Track.pdf)
- [BESPOKE paper](https://arxiv.org/html/2509.21106v2),
  [code](https://github.com/augustinLib/BESPOKE), and
  [dataset](https://huggingface.co/datasets/yonsei-dli/BESPOKE)
- [PDR-Bench paper](https://arxiv.org/html/2509.25106) and
  [repository](https://github.com/OPPO-PersonalAI/PersonalizedDeepResearchBench)
- [PersonaMem paper](https://arxiv.org/html/2504.14225),
  [repository](https://github.com/bowen-upenn/PersonaMem), and
  [dataset](https://huggingface.co/datasets/bowen-upenn/PersonaMem-v1)
