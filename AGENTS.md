# Coffee Chat evaluator rules

This repository owns evaluation orchestration and performance reporting only.
It treats Coffee Chat as an external candidate: never import its source or
private state, and never own benchmark validity, tasks, verifiers, metrics, or
product internals.

This migration shell has no provider execution, persistence, isolation
attestation, verifier metrics, timing logic, or real-host E2E. Its dry run
reports only fixture `unmeasured` and real-host `unavailable` states, with no
performance score. Keep result states explicit; deferred APIs return
`not_implemented` or `unavailable`.

Use the single unpadded `YYYY.M.D` CalVer in `package.json`, `PLAN.md`, dry-run
reports, and receipts. Run `npm run format:check`, `npm run typecheck`,
`npm run build`, `npm test`, `npm run smoke`, `npm run ci:policy`, and
`npm run dry-run` before committing.
