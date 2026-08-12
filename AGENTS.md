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

PCDA is the first performance-capable path. Eval may use only staged Bench
public CLIs and must not import or reproduce Bench MAC, verifier, judgment, or
metric logic. Bench commit `3bec0fe9f8f03216418fd437dfb30eb40a2e5775`
owns public `attest <unsigned> <signed>` and `judge` boundaries. Eval passes
the candidate-settled remainder through
`COFFEE_CHAT_EVAL_JUDGE_CAP_NANO_USD` and stops unmeasured when cost evidence
is unavailable.

Use the single unpadded `YYYY.M.D` CalVer in `package.json`, `PLAN.md`, dry-run
reports, and receipts. Run `npm run format:check`, `npm run typecheck`,
`npm run build`, `npm run canary:check`, `npm test`, `npm run smoke`, `npm run ci:policy`, and
`npm run dry-run`, and `npm run pcda:calibrate` before committing. Real
`npm run pcda:codex` remains manual-only and fail-closed.
