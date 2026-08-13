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
The organization-required workflow in `openboa-ai/.github` is the authorization
boundary. It executes this base commit's checker and parser against the pull
request as inert data. Candidate and local package scripts are post-trust
quality checks only. On an author-controlled checkout, explicitly run `node
.github/policy-bootstrap.mjs && npm ci --ignore-scripts --prefix
.github/policy-parser` before `npm test` or `npm run ci:policy`; never use that
candidate command to decide whether an untrusted branch is safe. Root `.npmrc`,
parser `.npmrc`, and `npm-shrinkwrap.json` are unsupported competing install
authorities and must be absent. Harbor calibration likewise uses only the complete hash-locked graph in
`.github/harbor-requirements.txt`; invoke the resulting executable through the
absolute `HARBOR_COMMAND` path and never restore online `uvx` resolution.

Agents develop through pull requests and must state exact fixture, manual, and
unavailable evidence. Candidate workflows admit `OWNER`, `MEMBER`, and exactly
the in-repository `dependabot[bot]` actor and pull-request author; never broaden
this to contributors or another head repository. Merge queue is disabled. After
required checks pass, enable GitHub-native squash auto-merge. Organization rules
apply one human-only team approval only when a configured sensitive governance
or external-execution path changes; ordinary code and dependency maintenance
remain zero-review. Do not add custom write-token merge automation or let a
candidate workflow decide that review boundary.

Required CI authenticates the exact parser manifest and lock with built-in
Node.js code, installs that integrity-pinned parser under
`.github/policy-parser`, audits that dependency tree independently, and only
then loads it to enforce structural policy before installing root dependencies
in every candidate-executing job. Treat the bootstrap, manifest, lockfile,
checker, and workflow ordering as one sensitive boundary. Root
dependency updates stay on the GitHub-native path only when package names,
exact versions, npm registry tarball identities, and sha512 lockfile
integrities pass that protected policy.
