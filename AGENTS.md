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
The checked-in PCDA calibration pair is trust-bearing evidence: keep its exact
Oracle and `nop` agent names, versions, trial IDs, and trial names bound in the
receipt validator, and route fixture changes through `coffee-security`.

Use the single unpadded `YYYY.M.D` CalVer in `package.json`, `PLAN.md`, dry-run
reports, and receipts. Run `npm run format:check`, `npm run typecheck`,
`npm run build`, `npm run canary:check`, `npm test`, `npm run smoke`, `npm run ci:policy`, and
`npm run dry-run`, and `npm run pcda:calibrate` before committing.
The pinned target wrapper delegates to the reusable workflow in
`openboa-ai/.github`, which is the authorization boundary. It executes this
base commit's checker and parser against the pull request as inert data.
Candidate and local package scripts are post-trust quality checks only. On an
author-controlled checkout, explicitly run `node
.github/policy-bootstrap.mjs && npm ci --ignore-scripts --prefix
.github/policy-parser` before `npm test` or `npm run ci:policy`; never use that
candidate command to decide whether an untrusted branch is safe. Root `.npmrc`,
parser `.npmrc`, and `npm-shrinkwrap.json` are unsupported competing install
authorities and must be absent. Harbor calibration likewise uses only the complete hash-locked graph in
`.github/harbor-requirements.txt`; invoke the resulting executable through the
absolute `HARBOR_COMMAND` path and never restore online `uvx` resolution.

Agents develop through pull requests and must state exact fixture, manual, and
unavailable evidence. The target repository exposes one inert
`pull_request_target` wrapper pinned to the central reusable gate. That trusted
gate admits `OWNER`, `MEMBER`, and exactly in-repository `dependabot[bot]`,
with matching actor, pull-request author, and head repository. Never add another
target workflow or broaden this set. Merge queue is disabled. Routine changes
use native squash auto-merge; sensitive governance or external-execution
changes wait for the protected `coffee-security` Environment.

The central gate authenticates the exact base parser manifest and lock, audits
that parser independently, and treats the pull request as inert data before any
candidate dependency or script runs. Candidate-local checks are deterministic
quality evidence only, never authorization. Treat the bootstrap, manifest,
lockfile, checker, wrapper, and central gate revision as one sensitive boundary.
Root package files are sensitive executable authority for maintainer or agent
changes. Only exact in-repository `dependabot[bot]` package-only updates stay on
the GitHub-native path, and only when package names, exact versions, npm
registry tarball identities, and sha512 lockfile integrities pass the protected
base policy and central dependency review.
