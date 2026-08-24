# Coffee Chat Eval v1

CalVer: `2026.8.12`
Implementation base: `bb32c9b21909078935a43d05a05da17d048504ec`

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

| Track     | Smoke sample                                                                                                         | Pilot sample              |
| --------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Taste     | first family; `unconditioned`, `target_a`, `target_b`; 3 submissions; 13 pointwise + 8 mirrored pairwise Judge calls | same family-level minimum |
| BEAM      | `100K/1`, first question in each six-category record-core set; 6 queries and 11 rubric Judge calls                   | 12 queries                |
| IFEval    | one prompt per top-level checker family: `1000, 1012, 1069, 1005, 1098, 1019, 1040, 1122, 1108`                      | same 9 prompts            |
| AgentDojo | workspace `user_task_0`, `injection_task_0`, and their attacked pair; 3 episodes                                     | 24 episodes               |

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
`unavailable`. Provider-terms and isolation receipts are supplied as separate
private files; neither belongs in immutable candidate identity.

### Private IFEval smoke risk acceptance

An IFEval rights-risk acceptance is private execution authority, not license
evidence. The exact-key `ifeval-rights-risk-acceptance-v1` receipt binds
`trackId=ifeval`, `profile=smoke`, `candidateType=coffee_chat_product`, the exact
candidate identity digest, the admitted IFEval source commit, the pinned NLTK
data repository/revision/path/digest, `licenseStatus=unclarified`,
`licenseCleared=false`, `scope=private-internal-smoke-only`, workspace-owner
acceptance and timestamp, and acknowledgements that it supplies no license,
redistribution, or public numeric-claim authority. It also requires an
operator-generated private 256-bit nonce. The nonce is never public; it makes
the receipt digest a hiding commitment rather than an enumerable timestamp
commitment.

When an accepted run is planned, `plan` and `run` reparse the same private
receipt and match its content digest against the RunSpec. The body is retained
as private content-addressed evidence; it and its path never become
candidate-visible or public. Public receipts expose only
`rightsRiskAcceptanceDigest`, `licenseCleared: false`, and
`rightsExecutionScope: private-internal-smoke-only`, and public IFEval reports
withhold numeric metrics. Product connectivity portfolio receipts also omit
native-evidence and TrackReport digests and state
`privateResultDigestsWithheld=true`; otherwise the small native result spaces
would allow the hidden metrics to be enumerated from those hashes. This
exception can prove sampled native-runner
execution readiness for the implementation PR, but it does not change the
benchmark lifecycle from `rights_hold`, grant pilot/score or redistribution,
activate IFEval, or create an official performance measurement.

## Coffee Chat Product connectivity candidate

The admitted Product candidate is one exact public release-package identity:

| Field          | Value                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Repository     | `https://github.com/openboa-ai/coffee-chat`                               |
| Commit         | `e1ac82de77ab12b9b2499771a194ef3db356b3a6`                                |
| Product CalVer | `2026.8.23`                                                               |
| Package digest | `sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41` |

Eval preserves its own `2026.8.12` artifact CalVer. The Product CalVer above is
candidate provenance and does not replace or advance Eval's release identity.
The immutable candidate identity is:

```json
{
  "schema": "candidate-config-v1",
  "candidateType": "coffee_chat_product",
  "harness": "eval-skills-reference-host-v1",
  "model": "gpt-5.6-luna",
  "seed": 7,
  "product": {
    "repository": "https://github.com/openboa-ai/coffee-chat",
    "commit": "e1ac82de77ab12b9b2499771a194ef3db356b3a6",
    "calver": "2026.8.23",
    "packageDigest": "sha256:e39384e00af5d8d5a71aedcde0d960bd4c6797ed227eab9f08d3134b4d712d41",
    "mode": "connectivity_only"
  }
}
```

`eval-skills-reference-host-v1` is an Eval-owned reference host, not Codex,
ChatGPT, or Product runtime evidence. Before a smoke run it fails closed unless
the operator-supplied public Product checkout has the pinned origin, exact HEAD,
clean declared package surface, deterministic package digest, consistent Plugin
identity, and exact capability contract. It discovers and validates the seven
declared Product Skills and entrypoints, including Init as `available` and the
six later capabilities as `not_implemented`; it never invokes or executes a
Product Skill or script. Benchmark-visible generation remains delegated to the
Eval-owned Responses agent stack.

The only Product-candidate RunSpec admitted here is `smoke`. Offline
fixture/replay tests use `candidateType=fixture` to prove the same runner and
receipt plumbing without claiming Product execution. Product `fixture`,
`pilot`, and `score` RunSpecs are rejected during planning; Product `pilot` and
`score` remain `not_implemented` until a real public Product Brew/Chat interface
is admitted.
Every Product receipt and TrackReport therefore carries this public-safe
boundary:

```json
{
  "candidateMode": "connectivity_only",
  "capabilitiesUsed": [],
  "productBehaviorExercised": false,
  "referenceHost": "eval-skills-reference-host-v1"
}
```

Connectivity proves only that Eval can bind an exact public package identity to
all four sampled native runner paths. It creates no Product-performance claim.
Taste remains public `not_active`, and its numeric results remain withheld from
public reports.

The absolute Product checkout path and broker capabilities are ephemeral
runtime inputs. They stay in a private runtime bundle accepted by `run`, never
in candidate identity or a public receipt:

```json
{
  "schema": "runtime-bundle-v1",
  "candidate": {
    "schema": "runtime-capability-v1",
    "scope": "candidate",
    "endpoint": "http://127.0.0.1:PORT/responses",
    "capabilityToken": "HOST_ISSUED_TOKEN",
    "model": "gpt-5.6-luna",
    "expiresAt": "2099-01-01T00:00:00.000Z",
    "maxRequests": 9
  },
  "productHost": {
    "schema": "product-host-runtime-v1",
    "host": "eval-skills-reference-host-v1",
    "packageRoot": "/absolute/path/to/exact/coffee-chat-checkout"
  }
}
```

The private portfolio config carries the same absolute checkout once as
`productPackageRoot`; each of its four track entries points to an immutable
smoke plan. `broker.providerEnvFile` points to a private ignored file and
`broker.providerKeyEnv` names the variable loaded only by the dedicated proxy
child; the key value itself is rejected from JSON and from the evaluator parent.

```json
{
  "schema": "portfolio-smoke-config-v1",
  "evidenceRoot": "/absolute/private/evidence",
  "cacheRoot": "/absolute/private/cache",
  "productPackageRoot": "/absolute/path/to/exact/coffee-chat-checkout",
  "ifevalRightsRiskAcceptanceReceipt": "/absolute/private/ifeval-rights-risk-acceptance.json",
  "broker": {
    "providerEnvFile": "/absolute/private/ignored/.env.local",
    "providerKeyEnv": "OPENAI_API_KEY",
    "ttlSeconds": 900
  },
  "tracks": [
    {
      "trackId": "coffee-chat-taste",
      "planPath": "/absolute/private/plans/taste.json"
    },
    {
      "trackId": "beam-record-core",
      "planPath": "/absolute/private/plans/beam.json"
    },
    {
      "trackId": "ifeval",
      "planPath": "/absolute/private/plans/ifeval.json"
    },
    {
      "trackId": "agentdojo-security",
      "planPath": "/absolute/private/plans/agentdojo.json"
    }
  ]
}
```

## Track adapters

- Taste uses the current public Bench bridge surface (`getBenchmarkInput`,
  `evaluateSubmission`, `evaluateCaseFamily`) and sealed pointwise/pairwise
  Judge routing. The initial Judge model is `gpt-5.6-luna`; this is a
  provisional configuration, not a qualification or public score.
- BEAM materializes the pinned MIT code and CC BY-SA 4.0 100K data in the
  cache, imports the upstream evaluator without source edits, selects the six
  record-core categories and first two stable questions per conversation, and
  preserves integer truncation and literal `<question>` behavior. Its six
  admitted scorers are Judge-only: the bridge suppresses only the upstream
  import-time `nltk.download("punkt" | "punkt_tab")` calls, constrains NLTK to
  the evaluator-owned runtime path, and rejects any present Punkt data bytes.
  Any future tokenizer use therefore fails closed instead of reading ambient
  data.
- IFEval imports the pinned Apache-2.0 checker and the official 541-prompt
  input. The historical GPT-4 response file is excluded; a copied long-form
  source finding holds the full native track rather than silently deleting a
  prompt. The fixed smoke key `1040` invokes NLTK `punkt_tab`. At pinned
  `nltk_data` revision `550b6625bcef1f2abff2ff770a5a0d272c9c6b2a`, the
  package has no `license` attribute and NLTK's package inventory classifies it
  as unclarified. Repository-level Apache-2.0 is not projected onto that data
  package. Native execution defaults to `rights_hold/rights`. The sole private
  execution exception is the exact Product-smoke receipt above. Before any
  candidate call, the executor verifies both the pinned 4,319,076-byte ZIP at
  its exact SHA-256 and the extracted `tokenizers/punkt_tab/**` tree required by
  NLTK. Materialization and risk acceptance do not authorize redistribution.
- AgentDojo imports package `0.1.35` at the pinned commit and native suite
  `v1.2.2`. Its broker-backed `BasePipelineElement` keeps the upstream
  `ToolsExecutor` loop and `max_iters=15`; evaluator-owned environments,
  injection goals, ground truth, and scorers never cross the candidate boundary.
  v1 fixes attack `important_instructions_no_model_name` and defense `None`,
  and sets `publishedTableComparable=false`.

Each adapter has fixture/replay census tests. For admitted non-Product
candidates, live pilots are manual and stay at claim status `pilot`; full score
profiles are executable but are not run in CI or automatically purchased. The
Product exception remains the connectivity-only `smoke` boundary above.

## CLI

```text
source verify --track <track-id>
source materialize --track <track-id> --cache-root <absolute-path> --source-root <pinned-checkout> [--data-root <pinned-data>] [--runtime-lock <absolute-lock>]
plan --track <track-id> --profile fixture|smoke|pilot|score --candidate-config <json-or-absolute-file> [--provider-terms-receipt <absolute-json>] [--isolation-receipt <absolute-json>] [--ifeval-rights-risk-acceptance-receipt <absolute-private-json>]
run --plan <run-spec-or-plan.json> --evidence-root <absolute-path> [--runtime-config <absolute-private-json>] [--ifeval-rights-risk-acceptance-receipt <absolute-private-json>]
portfolio smoke --config <absolute-private-json>
report --run <run-id-or-receipt-path> --visibility internal|public
```

`EVAL_CACHE_ROOT` and `EVIDENCE_ROOT` may supply omitted absolute roots. The
optional `--provider-terms-receipt <absolute-json>` contributes only its
content digest; without it, a non-fixture provider run ends in `rights_hold`.
`--isolation-receipt <absolute-json>` likewise contributes only its content
digest and cannot be combined with legacy inline isolation evidence. A modern
non-fixture `run` receives its endpoint, scoped capability token, expiry,
request cap, and optional private Product host only through `--runtime-config`.
legacy `source-verify --source-manifest`, Harbor Oracle, Codex baseline, and
`dry-run` paths remain available for migration evidence, but their structural
receipts are not benchmark scores.

`source materialize` is a no-network projection step: the operator supplies a
separately fetched exact checkout and, for BEAM, the pinned data directory.
IFEval uses the committed Eval-owned runtime lock by default; BEAM uses the
committed Eval-owned LLM-only lock (including its pinned parquet reader); other
tracks bind an upstream `uv.lock` or pinned `requirements.txt` when one is
admitted. The operator creates `<cache>/<track-id>/runtime` with pinned `uv`
in offline mode after materialization. `run` calls the runtime executable
directly and never downloads, resolves, or writes into the source checkout.
If that runtime is absent, the run is explicit host unavailability.

`portfolio smoke` may receive a private `broker` object containing an absolute
ignored `providerEnvFile`, the key name (`providerKeyEnv`), plus optional
upstream URL and short expiry. A dedicated child proxy process loads the key;
the Eval/evaluator parent rejects that key in its own environment and receives
only scoped capability metadata. It starts separate candidate and Judge proxies
per track, issues the exact smoke budgets, and closes every child before writing
the redacted portfolio receipt. A Product portfolio additionally
requires one absolute `productPackageRoot`, the same
`eval-skills-reference-host-v1` runtime identity on all four tracks, and one
immutable Product identity digest. Raw provider keys and Product checkout paths
are rejected from public receipts. Native-result and TrackReport digests are
also withheld for connectivity-only Product tracks; execution-receipt digests
remain as non-score provenance.

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

## Current native IFEval rights boundary

The exact `punkt_tab.zip` runtime asset is pinned at 4,319,076 bytes and
`sha256:e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106`.
The pinned NLTK [`index.xml`](https://raw.githubusercontent.com/nltk/nltk_data/550b6625bcef1f2abff2ff770a5a0d272c9c6b2a/index.xml)
does not declare a package license, while its
[`DATASET-LICENSES.md`](https://raw.githubusercontent.com/nltk/nltk_data/550b6625bcef1f2abff2ff770a5a0d272c9c6b2a/DATASET-LICENSES.md)
and
[`LICENSE-OVERVIEW.md`](https://raw.githubusercontent.com/nltk/nltk_data/550b6625bcef1f2abff2ff770a5a0d272c9c6b2a/LICENSE-OVERVIEW.md)
warn that Punkt licensing is unclarified and must not be inferred from the
repository license. Fixture/replay and injected-bridge structural tests may run,
but they do not clear this right. The default live path remains held. A matching
workspace-owner receipt permits only the exact Product nine-prompt smoke as
private calibration. The bridge verifies the exact ZIP and extracted tree
before any candidate call, public numeric IFEval output remains withheld, and
public provenance retains false license clearance. A successful private run may
satisfy only the sampled-runner execution-readiness check for this implementation
PR. It cannot activate the benchmark or authorize pilot/score, redistribution,
public numeric reporting, or an official Product-performance claim. This is a
conservative engineering control, not legal advice.
