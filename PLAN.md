# Coffee Chat Eval v1

CalVer: `2026.8.12`
Implementation base: `eae568583b70af955771b51abab5eb326f028d23`

`coffee-chat-eval` owns candidate execution, imported benchmark adapters,
isolation evidence, receipts, native metric collection, and redacted reports.
It does not own benchmark cases, benchmark rubrics, or Coffee Chat private
state. The four tracks remain separate; v1 deliberately emits no composite
score.

| Track                | Construct                                                |                                           Full profile | Native report boundary                                  |
| -------------------- | -------------------------------------------------------- | -----------------------------------------------------: | ------------------------------------------------------- |
| `coffee-chat-taste`  | infer and apply selected Taste                           |         32 families / 96 submissions / 672 Judge calls | `provisional_internal`; Bench `not_active`              |
| `beam-record-core`   | preserve, update, retrieve, and reason over long records |                         20 conversations / 240 queries | code-exact diagnostic; `paperComparable=false`          |
| `ifeval`             | follow explicit instructions and format constraints      |                                            541 prompts | strict/loose × prompt/instruction accuracy              |
| `agentdojo-security` | preserve utility under indirect tool-result injection    | 97 user + 35 injection + 949 attacked = 1,081 episodes | utility and ASR are separate; no security certification |

τ²-bench and Terminal-Bench are outside v1. No claim is made for a missing,
skipped, unavailable, invalid, failed, or unmeasured result; none is converted
to zero.

The executable profiles are `fixture` (offline fake/replay), `smoke` (minimal
live sampled execution), `pilot` (the retained formal sample), and `score`
(complete census). Smoke is calibration evidence only: it creates no quality
threshold, official benchmark score, product-performance claim, leaderboard,
or security certification.

| Track | Smoke sample | Pilot sample |
| --- | --- | --- |
| Taste | first family; `unconditioned`, `target_a`, `target_b`; 3 submissions; 13 pointwise + 8 mirrored pairwise Judge calls | same family-level minimum |
| BEAM | `100K/1`, first question in each six-category record-core set; 6 queries and 11 rubric Judge calls | 12 queries |
| IFEval | one prompt per top-level checker family: `1000, 1012, 1069, 1005, 1098, 1019, 1040, 1122, 1108` | same 9 prompts |
| AgentDojo | workspace `user_task_0`, `injection_task_0`, and their attacked pair; 3 episodes | 24 episodes |

## Execution contract

Every run follows:

```text
source verify → immutable RunSpec → sealed staging → isolated candidate
→ native evaluator → private content-addressed evidence → redacted report
```

`src/eval-core.ts` defines `SourceManifest`, `RunSpec`, `TrackAdapter`,
`CandidateTransport`, `InteractiveAgentTransport`, `JudgeTransport`,
`TrialReceipt`, and `TrackReport`. `src/source-manifests.ts` fixes source/data
revisions, license digests, allowlists, exclusions, notices, retention, native
metrics, census, and provider-terms recheck policy. Raw upstream bytes stay in
the operator-controlled `EVAL_CACHE_ROOT`; traces and judge responses stay in
the append-only `EVIDENCE_ROOT` vault and never enter public reports.

An admitted materialization is laid out as
`EVAL_CACHE_ROOT/<track-id>/{source,data}/` plus a
`source-receipt.json`. `src/source-cache.ts` checks that receipt against the
manifest digest, exact file hashes, allowlist/exclusions, and license digests;
an absent or drifting receipt fails closed before a source-backed run.

The candidate receives a scoped, expiring broker capability rather than a
provider key. Judge capability and candidate capability are separate. A
provider-terms receipt is required before a live run; missing isolation is
`unavailable`. `coffee_chat_product` remains `not_implemented` until its public
interactive interface exists; Eval never imports Product private internals.

## Track adapters

- Taste uses the current public Bench bridge surface (`getBenchmarkInput`,
  `evaluateSubmission`, `evaluateCaseFamily`) and sealed pointwise/pairwise
  Judge routing. The initial Judge model is `gpt-5.6-luna`; this is a
  provisional configuration, not a qualification or public score.
- BEAM materializes the pinned MIT code and CC BY-SA 4.0 100K data in the
  cache, imports the upstream evaluator without source edits, selects the six
  record-core categories and first two stable questions per conversation, and
  preserves integer truncation and literal `<question>` behavior.
- IFEval imports the pinned Apache-2.0 checker and the official 541-prompt
  input. The historical GPT-4 response file is excluded; a copied long-form
  source finding holds the full native track rather than silently deleting a
  prompt.
- AgentDojo imports package `0.1.35` at the pinned commit and native suite
  `v1.2.2`. Its broker-backed `BasePipelineElement` keeps the upstream
  `ToolsExecutor` loop and `max_iters=15`; evaluator-owned environments,
  injection goals, ground truth, and scorers never cross the candidate boundary.
  v1 fixes attack `important_instructions_no_model_name` and defense `None`,
  and sets `publishedTableComparable=false`.

Each adapter has fixture/replay census tests. Live pilots are manual and stay
at claim status `pilot`; full score profiles are executable but are not run in
CI or automatically purchased.

## CLI

```text
source verify --track <track-id>
source materialize --track <track-id> --cache-root <absolute-path>
plan --track <track-id> --profile fixture|smoke|pilot|score --candidate-config <json-or-absolute-file>
run --plan <run-spec-or-plan.json> --evidence-root <absolute-path>
portfolio smoke --config <absolute-private-json>
report --run <run-id-or-receipt-path> --visibility internal|public
```

`EVAL_CACHE_ROOT` and `EVIDENCE_ROOT` may supply omitted absolute roots. The
optional `--provider-terms-receipt <absolute-json>` contributes only its
content digest; without it, a non-fixture provider run ends in `rights_hold`.
legacy `source-verify --source-manifest`, Harbor Oracle, Codex baseline, and
`dry-run` paths remain available for migration evidence, but their structural
receipts are not benchmark scores.

## Verification

```sh
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npm run smoke
npm run dry-run
npm run ci:policy
npm run security:scan
```

The default suite is offline: no upstream download, provider call, model call,
or raw benchmark materialization occurs in CI.
