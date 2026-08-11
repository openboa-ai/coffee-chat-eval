# Coffee Chat evaluator rules

This repository owns evaluation orchestration and performance reporting only.
It treats Coffee Chat as an external candidate: never import its source or
private state, and never redefine an imported benchmark's construct, metric,
or validity claim. An execution smoke may package a pinned imported case and a
separate conformance verifier, but it is not a benchmark score or a new
benchmark. Product internals remain out of scope.

The repository has one Harbor-first, Codex-only `protocol-canary` integration.
It proves Plugin installation, discovery, public entrypoint invocation,
artifact verification, receipt generation, and cleanup without producing a
performance score. Required CI runs deterministic implementation checks only;
real Codex/model execution remains manual. Keep result states explicit and do
not reinterpret the canary's native reward as Coffee Chat performance.

The one-case IFEval smoke verifies only benchmark execution. Keep its
source manifest immutable, judgment labels sealed, native evidence preserved,
and receipt split into execution status, candidate status, and measurement
status. Required CI runs only its deterministic Harbor Oracle/no-op calibration;
the real Codex/model benchmark smoke remains manual.

Use the single unpadded `YYYY.M.D` CalVer in `package.json`, `PLAN.md`, dry-run
reports, and receipts. Run `npm run format:check`, `npm run typecheck`,
`npm run build`, `npm run canary:check`, `npm test`, `npm run smoke`, `npm run ci:policy`, and
`npm run dry-run` before committing.
