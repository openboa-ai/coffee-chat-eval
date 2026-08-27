# Coffee Chat Eval

> Clean-context evaluation runner and evidence store for Coffee Chat Product
> and Judge iterations.

## Essence

An evaluation is a reproducible comparison with evidence, not a score emitted
by a runner. Clean context, paired conditions, and preserved artifacts make it
possible to tell whether an iteration changed perspective capture or
application.

## Role

Eval is the execution and evidence layer. It owns isolation, candidate
selection, receipts, outputs, timing, traces, grading, human feedback, and
iteration history; Product owns behavior and Bench owns what counts as good.

## Goal

Turn a frozen Bench case into attributable evidence that can improve Roast,
Brew, or a Judge while keeping Product behavior, benchmark definitions, and
Judge calibration independently accountable.

## Why

A benchmark definition is not evidence that a Skill works. Each comparison
needs a clean context, the same prompt and input, an explicit Skill condition,
and preserved output, timing, grading, trace, and human feedback. Eval makes
those iterations repeatable and attributable.

## What

The runner observes the general Agent interface:

~~~text
prompt + input -> output
~~~

Prompt may be a request or situation. Input is the complete managed environment
and context. Output may be text, files, directory state, a decision, or an
action result.

Product terminology is recorded as experiment metadata only:

- Roast evaluates Origin-to-Bean perspective capture.
- Brew evaluates Bean-to-Coffee perspective application.
- Brew has two separate output surfaces: Human Understanding and Agent
  Judgment / Action.

## How

For each frozen case, Eval creates fresh execution contexts and runs paired
conditions:

~~~text
without-skill
with-skill
~~~

Roast and Brew are evaluated separately. Triggering is a separate trace-based
measurement. Candidate, host, model, and execution budget are selected by the
runner at runtime; they are not Product or Bench contracts.

For Brew output-quality pairs, both arms receive the same byte-identical,
explicitly confirmed Bean and its context. A Roast candidate, unconfirmed Bean,
or drifted Bean invalidates the Brew comparison rather than contaminating it.

The runner stores evidence without converting unavailable, failed, abstained,
or Judge-disagreeing runs into scores. It never changes Bench cases or Ground
Truth and never imports Coffee Chat internals.

Trace evidence records which Skill and tool decisions contributed to an
outcome; output prose alone cannot establish triggering or causality.

## Repository layout

~~~text
coffee-chat-eval/
├── README.md
└── iterations/
    └── README.md
~~~

An iteration may produce the following private, append-only evidence:

~~~text
iterations/<iteration-id>/
├── metadata.json
├── output-quality/
│   ├── roast/<case-id>/
│   │   ├── prompt/
│   │   ├── input/
│   │   ├── without-skill/
│   │   │   ├── output/
│   │   │   ├── timing.json
│   │   │   ├── grading.json
│   │   │   ├── transcript.jsonl
│   │   │   └── trace.jsonl
│   │   ├── with-skill/
│   │   │   └── <same evidence>
│   │   ├── comparison.json
│   │   └── feedback.md
│   └── brew/<case-id>/
│       ├── human-understanding/
│       │   └── <same paired structure>
│       └── agent-judgment-action/
│           └── <same paired structure>
├── triggering/
│   ├── roast/
│   └── brew/
└── summary.md
~~~

The actual evidence root is controlled by the executing host and is not
committed to this repository.

## Ownership boundary

- coffee-chat owns Product Skills and plugin meaning.
- coffee-chat-roastery owns Origins and explicitly confirmed Beans.
- coffee-chat-bench owns cases, criteria, Ground Truth, and graders.
- coffee-chat-eval owns execution, isolation, receipts, evidence, and
  iteration reports.

Eval does not own a benchmark score, Product threshold, Bean schema, or public
leaderboard; Bench defines the criteria and calibration a Judge must satisfy.

## Local security hook

After cloning, run `npm run hooks:install` to configure Git to use the committed
`.githooks/pre-commit` guard. This local hook supplements, but does not
replace, the trusted central checks.

## Status

This repository contains the evaluation skeleton. Product performance remains
unmeasured until the Product is executed against an admitted Bench case with
preserved evidence.

## License

Evaluation definitions and documentation are MIT licensed, Copyright © 2026
Openboa AI. Private run evidence and any input content retain their applicable
rights and must not be committed here.
