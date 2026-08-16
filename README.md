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

Each condition runs in a fresh Harbor 0.21 Docker trial. The current executable
agent is Harbor Oracle, used only to prove task loading, artifact collection,
verifier execution, cleanup, and receipt parsing. Native reward `1` means the
output met the structural UTF-8, size, and citation contract. It is not semantic
benchmark credit and every Oracle receipt says `measurement: not_performed`.

Stock Harbor 0.21 Codex is explicitly `credential_isolation_unavailable`.
That adapter writes provider authentication into candidate-readable process and
filesystem state. Eval will not pass the saved API key through that path. A
future Codex run must use a credential-isolated adapter whose provider secret
never enters the candidate process, filesystem, artifacts, or logs.

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

The evaluation shape follows OpenAI's skill-evaluation pattern: define a small
set of observable outcome, process, style, and efficiency checks; capture the
run trace and artifacts; apply deterministic checks first; then add a
structured rubric judge only where rules cannot establish the criterion. The
article's 10–20 prompt suggestion is a fast regression lane, not a replacement
for the public Bench case bank or its validity evidence.

Required CI is deterministic and makes no provider or judge call. Live model
execution and semantic measurement remain manual. CalVer is the only release
identity; no compatibility layer is provided.
