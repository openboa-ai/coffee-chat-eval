# Coffee Chat Eval rules

This repository owns candidate execution, host orchestration, normalized
receipts, and performance reports. Treat Coffee Chat as an external candidate.
Never import product internals and never redefine a benchmark's construct,
case bank, rubric, judge qualification, or metric.

The active input is the candidate-neutral Harbor projection from an exact
`coffee-chat-bench` commit. The smallest baseline is one case with `task_only`
and one diagnostic condition. Harbor Oracle is control evidence only; its
native reward cannot become semantic measurement or a Coffee Chat score.

Provider credentials must not enter candidate environment variables,
filesystems, process memory, artifacts, or logs. Harbor 0.21 native Codex is
therefore unavailable. Do not restore it by passing `OPENAI_API_KEY`, writing
`auth.json`, or weakening the boundary. A future adapter must prove credential
isolation before its first paid run.

Keep status explicit: host failure, candidate failure, verifier failure,
invalid artifact, unavailable execution, and unmeasured output are distinct.
Do not convert them to zero or silently omit them. Required CI validates only
deterministic contracts; live model and judge calls are manual.

Use the single `YYYY.M.D` CalVer. Before committing, run `npm run
format:check`, `npm run typecheck`, `npm run build`, `npm test`, `npm run
smoke`, `npm run dry-run`, and `npm run ci:policy`. Harbor itself remains pinned
by the complete hash lock in `.github/harbor-requirements.txt`; invoke its
absolute executable and never restore online resolution.

The target repository exposes one immutable `pull_request_target` wrapper that
delegates authorization and deterministic quality to `openboa-ai/.github`.
Routine changes use GitHub-native squash auto-merge; protected execution,
security, dependency, and workflow paths follow `.github/merge-policy.json`.
