# Coffee Chat evaluator rules

This repository owns evaluation orchestration and performance reporting only.
It treats Coffee Chat as an external candidate: never import its source or
private state, and never redefine an imported benchmark's construct, metric,
or validity claim. An execution smoke may package a pinned imported case and a
separate conformance verifier, but it is not a benchmark score or a new
benchmark. Product internals remain out of scope.

The repository has credential-free Harbor Oracle/no-op calibration for the
`protocol-canary` task package and separate verifier. Candidate-controlled
Plugin code must not share a process or filesystem with provider credentials;
the former live Codex/model path remains disabled until a broker or split
execution boundary enforces that property. Keep result states explicit and do
not reinterpret native rewards as Coffee Chat performance.

The one-case IFEval contract verifies only benchmark execution structure. Keep
its source manifest immutable, judgment labels sealed, native evidence
preserved, and receipt split into execution status, candidate status, and
measurement status. Required CI runs only credential-free Harbor Oracle/no-op
calibration.

PCDA remains a credential-free Oracle/no-op calibration path. The former
candidate runner, staged Bench signer/judge adapter, and `pcda:codex` command
are removed. Do not restore provider-bearing candidate execution until a
reviewed credential broker or split execution service keeps provider secrets
outside the candidate process and filesystem.

Use the single unpadded `YYYY.M.D` CalVer in `package.json`, `PLAN.md`, dry-run
reports, and receipts. Run `npm run format:check`, `npm run typecheck`,
`npm run build`, `npm run canary:check`, `npm test`, `npm run smoke`, `npm run ci:policy`, and
`npm run dry-run`, and `npm run pcda:calibrate` before committing.

Agents develop through pull requests and must state exact fixture, manual, and
unavailable evidence. Candidate workflows admit `OWNER`, `MEMBER`, and exactly
`dependabot[bot]`; never broaden this to contributors. After required checks
pass, enable GitHub-native squash auto-merge. Organization rules apply one
human-only team approval only when a configured sensitive governance or
external-execution path changes; ordinary code and dependency maintenance
remain zero-review. Do not add custom write-token merge automation or let a
candidate workflow decide that review boundary.
