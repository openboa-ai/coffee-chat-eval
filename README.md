# Coffee Chat evaluator

`@openboa-ai/coffee-chat-eval` is the evaluation-orchestration and reporting
repository for Coffee Chat. This clean migration shell provides public trial
types, deterministic matrix expansion and identity, and an honest dry run.

`npm run dry-run` emits one fixture `unmeasured` entry and one real-host
`unavailable` entry. It produces no performance score. Public execution remains
explicitly `not_implemented` until a separately authorized implementation.

It does not contain Coffee Chat product internals, benchmark tasks, verifiers,
metrics, validity evidence, provider execution, artifact persistence,
isolation attestation, timing logic, or real E2E. Those are deferred; benchmark
validity belongs to `coffee-chat-bench`.

Run locally with `npm ci`, then `npm run format:check`, `npm run typecheck`,
`npm run build`, `npm test`, `npm run smoke`, `npm run dry-run`, and
`npm run ci:policy`.

## Initial contribution policy

GitHub-native squash merge is the only merge method. Candidate-executing
workflows admit only `OWNER` and `MEMBER` authors, require zero human approvals,
and retain dependency review and CodeQL. This shell has no compatibility layer;
CalVer is its only release identity.
