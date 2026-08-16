# Coffee Chat Eval

`@openboa-ai/coffee-chat-eval` executes candidates and publishes evaluation
receipts. It does not own Coffee Chat product behavior or benchmark semantics.
The product lives in `coffee-chat`; the candidate-independent case bank,
Harbor projection, judgment protocol, and metrics live in `coffee-chat-bench`.

## Current executable boundary

The first path consumes a fresh Harbor projection produced by an exact Bench
commit. It selects one case with two candidate-visible conditions:

- `task_only`;
- one explicitly chosen `diagnostic_target_a` or `diagnostic_target_b`.

Each condition runs in a fresh Harbor 0.21 Docker trial. The Oracle path proves
task loading, artifact collection, verifier execution, cleanup, and receipt
parsing. The Codex candidate path uses the `harbor-codex-proxy` adapter: a
host-held OpenAI Responses proxy injects the provider key, while the candidate
receives only a per-trial capability token and a Responses-wire Codex config.
The candidate network overlay allows only `host.docker.internal`; setup hosts
are separate from the agent allowlist. Native reward `1` means only that the
structural output contract passed. It is not semantic benchmark credit, and
candidate receipts remain `measurement: unmeasured` until the qualified Bench
judge and validity boundary are available.

Stock Harbor 0.21 Codex is explicitly `credential_isolation_unavailable`.
That adapter writes provider authentication into candidate-readable process and
filesystem state. Eval does not use that path. The proxy adapter keeps the
provider key in the host boundary; its receipt records whether the key appeared
in candidate-owned artifacts and whether the container was deleted.

## Commands

Deterministic repository verification:

```sh
npm ci
npm run hooks:install
npm run format:check
npm run typecheck
npm test
npm run dry-run
npm run smoke
npm run ci:policy
npm run security:scan
```

Manual Oracle control after producing a Bench projection:

```sh
npm run bench:oracle -- \
  --projection-root /absolute/path/to/projected \
  --case-id CASE_ID \
  --diagnostic-target a \
  --bench-commit FULL_40_CHARACTER_COMMIT \
  --harbor-command /absolute/path/to/pinned/harbor \
  --jobs-root /absolute/canonical/docker-shareable/path/new-run
```

The jobs root must be new and its parent must be a canonical path visible to
Docker Desktop. On macOS, do not use the `/tmp` symlink for Harbor log mounts;
use a workspace path such as this repository's ignored `artifacts/` directory.

Manual Codex candidate baseline (live provider call; never a CI command):

```sh
OPENAI_API_KEY=... node --experimental-strip-types src/cli.ts codex-baseline -- \
  --projection-root /absolute/path/to/projected \
  --case-id CASE_ID \
  --diagnostic-target a \
  --bench-commit FULL_40_CHARACTER_COMMIT \
  --harbor-command /absolute/path/to/pinned/harbor \
  --jobs-root /absolute/canonical/docker-shareable/path/new-run \
  --model gpt-5.6-luna
```

The key is read by the host process and is never placed in the candidate
command line or candidate task files. The checked-in four-trial baseline
receipts are in
[`reports/2026.8.12/codex-baseline-receipts.json`](reports/2026.8.12/codex-baseline-receipts.json).
They are execution evidence only: no native reward is promoted to a semantic
score, and no judge result is treated as qualified measurement.

The first live judge transport probe is retained separately in
[`reports/2026.8.12/codex-judge-probe.json`](reports/2026.8.12/codex-judge-probe.json).
It is intentionally unqualified and unmeasured because the Bench study has no
genuine human qualification records and the primary model votes disagreed.

A fresh two-condition Harbor Oracle control was rerun against the merged Bench
main commit `0598d6d10319b69e0b34da86c40b9a48d8365c03` and is retained in
[`reports/2026.8.12/oracle-control-0598d6d-receipt.json`](reports/2026.8.12/oracle-control-0598d6d-receipt.json).
It confirms current-head task/projection provenance, Docker execution, and
cleanup; its structural reward remains `measurement: not_performed`.

The evaluation shape follows OpenAI's skill-evaluation pattern: define a small
set of observable outcome, process, style, and efficiency checks; capture the
run trace and artifacts; apply deterministic checks first; then add a
structured rubric judge only where rules cannot establish the criterion. The
article's 10–20 prompt suggestion is a fast regression lane, not a replacement
for the public Bench case bank or its validity evidence.

Required CI is deterministic and makes no provider or judge call. Live model
execution and semantic measurement remain manual. CalVer is the only release
identity; no compatibility layer is provided.
