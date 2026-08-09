# Coffee Chat evaluator rules

This repository owns public candidate adapters, deterministic orchestration,
host-isolation evidence, result validation, receipts, and evaluation reports.
It treats Coffee Chat as an external candidate: never import its source or
private state, and award no credit that cannot be observed through a declared
public adapter and artifact.

The baseline is fixture-only. It has no real provider, model, candidate, or
isolated-host E2E, no benchmark construct ownership, and no performance claim.
Keep `measured`, `unmeasured`, `skipped`, `unavailable`, `invalid`, and each
failure owner distinct. Receipts retain only minimum redacted evidence.

Use the single unpadded `YYYY.M.D` CalVer in `package.json`, `PLAN.md`, dry-run
reports, and receipts. Run `npm run format:check`, `npm run typecheck`,
`npm test`, `npm run ci:policy`, and `npm run dry-run` before committing.
