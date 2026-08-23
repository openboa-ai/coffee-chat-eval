# Coffee Chat Eval

`@openboa-ai/coffee-chat-eval` executes declared candidates and publishes
provenance-safe evaluation receipts. It owns orchestration, adapters,
isolation, evidence, native metrics, and reports—not Coffee Chat product
behavior, benchmark source bytes, rubrics, or private product state.

## v1 tracks

- `coffee-chat-taste`: 32 families × three conditions = 96 submissions and
  672 sealed Judge calls. It remains `provisional_internal`; the Bench is
  `not_active`.
- `beam-record-core`: six long-memory categories, 20 pinned 100K
  conversations, and 240 upstream-order queries. Category metrics stay
  independent and reproduce the upstream integer-truncation diagnostic.
- `ifeval`: all 541 official prompts with strict/loose prompt-level and
  instruction-level accuracy. Historical GPT-4 responses are excluded.
- `agentdojo-security`: workspace, travel, banking, and slack at native
  `v1.2.2`, with 1,081 episodes. Benign utility, utility under attack,
  targeted ASR, and injection-task solvability are reported separately.

τ²-bench and Terminal-Bench are not v1 tracks. There is no aggregate score,
leaderboard, security certification, or downstream product-performance claim.

The runner profiles are `fixture` (offline fake/replay), `smoke` (minimal live
execution used to prove the native evaluator path), `pilot` (formal retained
sample), and `score` (complete census). The pre-merge portfolio smoke uses only
the following fixed samples: Taste first family with native conditions
`unconditioned`/`target_a`/`target_b` (3 candidate submissions and 21 Judge
calls), BEAM `100K/1` first question in each of six categories (6 queries and
11 Judge calls), nine pinned IFEval prompts (one per checker family), and
AgentDojo workspace `user_task_0`, `injection_task_0`, plus their attacked pair
(3 episodes). Smoke remains calibration evidence and never becomes a score or
security certification.

## Rights and retention

The pinned source manifests in [`src/source-manifests.ts`](src/source-manifests.ts)
record the exact commits/releases, license digests, allowlists, exclusions,
notices, retention, and public-artifact policy. Source verification is
fail-closed. “Evaluation only” does not remove commercial-use or attribution
obligations, so raw upstream bytes are materialized only in `EVAL_CACHE_ROOT`
when the manifest permits it. `EVIDENCE_ROOT` is private, content-addressed,
append-only storage. Public reports contain hashes, provenance, denominators,
and native metric names—not task text, candidate prose, Judge responses,
attack payloads, tool traces, synthetic personal data, or secrets.

## CLI

```sh
source verify --track <track-id>
source materialize --track <track-id> --cache-root <absolute-path> --source-root <pinned-checkout> [--data-root <pinned-data>] [--runtime-lock <absolute-lock>]
plan --track <track-id> --profile fixture|smoke|pilot|score --candidate-config <json-or-absolute-file>
run --plan <run-spec-or-plan.json> --evidence-root <absolute-path>
portfolio smoke --config <absolute-private-json>
report --run <run-id-or-receipt-path> --visibility internal|public
```

Set `EVAL_CACHE_ROOT` and `EVIDENCE_ROOT` to absolute operator-owned paths, or
pass them to `plan`/`run`. The plan and fixture paths are deterministic and
offline. Candidate and Judge provider credentials belong only to a host-held
broker; the AgentDojo bridge uses its native tool loop with a scoped broker
capability. For a non-fixture provider run, pass
`--provider-terms-receipt <absolute-json>`; otherwise the run is explicitly
`rights_hold`.

For a materialized source, keep the checkout below
`EVAL_CACHE_ROOT/<track-id>/source` (and data below `data` when the manifest
declares a data layer) and write the exact file digest census to
`source-receipt.json`. `source verify --track <track-id> --cache-root
<absolute-path>` verifies that receipt before execution.

Materialization never downloads. The operator fetches and verifies the exact
upstream revision first, then supplies the checkout with `--source-root` (and
BEAM's parquet checkout with `--data-root`). IFEval defaults to the committed
Eval-owned lock at `runtime-locks/ifeval-requirements.txt`; BEAM's six
LLM-only scorers use the committed Eval-owned lock at
`runtime-locks/beam-eval-requirements.txt` (including the parquet reader), and
other tracks bind an upstream `uv.lock` or pinned `requirements.txt` when
present. After materialization, create `<cache>/<track-id>/runtime` with the
pinned `uv` lock in offline mode. `run` invokes that runtime directly and never
downloads or mutates the source checkout; a missing runtime is unavailable
host evidence, not an automatic installation opportunity.

For a host-held provider smoke, the private portfolio config points to
already-issued local capability bundles. The provider key itself is never
accepted in JSON, never passed to a candidate/Judge, and never written to
evidence. An operator that wants the portfolio command to create separate
per-track proxies may instead provide a private `broker` object with only
`providerKeyEnv` (and optional `upstreamUrl`/`ttlSeconds`); the command reads
the key from that host environment variable and closes every proxy after the
sequential run.

## Local verification

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

Live provider campaigns are manual. A fixture, calibration, transport receipt,
or `measurement=unmeasured` artifact is plumbing evidence, not candidate
performance.
