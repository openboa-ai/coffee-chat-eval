# Coffee Chat evaluator

`@openboa-ai/coffee-chat-eval` is the evaluation-orchestration and reporting
repository for Coffee Chat. This clean migration shell provides public trial
types, deterministic matrix expansion and identity, and an honest dry run.

`npm run dry-run` emits one fixture `unmeasured` entry and one real-host
`unavailable` entry. It produces no performance score. Public execution remains
explicitly `not_implemented` until a separately authorized implementation.

The external benchmark portfolio and activation requirements are documented in
[`docs/external-benchmark-portfolio.md`](docs/external-benchmark-portfolio.md).
Coffee Chat and Coffee Blend share one objective: determine whether explicitly
selected Taste is applied correctly and improves an output-level utility proxy.
Application fidelity, utility proxy, reliability, and efficiency are reported
separately; realized downstream utility remains unmeasured.

The selected queue is PersonaMem as a deterministic fidelity diagnostic,
BESPOKE as the primary conversational output-proxy track, and PDR-Bench as a
calibrated agentic application/actionability and Q/R guardrail pilot. No adapter
or Coffee result exists yet, and no selected source natively measures the
multi-person `CN` condition.

This repository does not contain Coffee Chat product internals or own a new
benchmark construct. Native external tasks and scores remain source-faithful;
Coffee-derived projections are separately labeled and may use only public
candidate interfaces. Native `source_condition` and derived Coffee
`C0/C1/CN` condition identity must remain separate. A later missing
`C0/C1/CN` construct belongs to `coffee-chat-bench` after validity work.

Run locally with `npm ci`, then `npm run format:check`, `npm run typecheck`,
`npm run build`, `npm test`, `npm run smoke`, `npm run dry-run`, and
`npm run ci:policy`.

## Initial contribution policy

GitHub-native squash merge is the only merge method. Candidate-executing
workflows admit only `OWNER` and `MEMBER` authors, require zero human approvals,
and retain dependency review and CodeQL. This shell has no compatibility layer;
CalVer is its only release identity.
