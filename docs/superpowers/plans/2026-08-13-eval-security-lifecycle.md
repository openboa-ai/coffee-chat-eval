# Eval Security Lifecycle Implementation Plan

> **Execution:** Follow strict TDD and `AGENTS.md`. Real Codex/model execution
> remains manual-only and must never enter required CI.

**Goal:** Remove redundant CI authority, structurally enforce evaluator workflow
policy, and support automatic merge with human review only for governance and
external execution boundaries.

**Architecture:** Three workflows remain: advanced CodeQL, one deterministic
quality/policy workflow, and the trusted secret boundary. A parsed YAML contract
rejects workflow-policy bypasses. The live repository ruleset later adds
human-only path review outside candidate control.

**Stack:** Node.js 24, TypeScript, Python, `yaml`, Node test runner, GitHub
Actions, GitHub Rulesets, Gitleaks, CodeQL, npm.

---

## Task 0: Close repository-scan findings before lifecycle automation

The Standard Codex Security scan at the exact pre-change revision found five
candidate-controlled trust paths. Close them before enabling broader automatic
merge:

- remove the live Harbor Plugin adapter and commands that shared readable Codex
  authentication with unsandboxed candidate code; keep only credential-free,
  no-network Oracle/no-op calibration until a broker or split execution process
  exists;
- independently recompute the collected PCDA artifact digest before attestation
  or judgment;
- replace substring-only trajectory claims with exact structured command and
  observation validation;
- bound untrusted PCDA files, directory enumeration, signed attestations, and
  structured evidence before traversal or model invocation.

Add focused regressions for every boundary and run the complete evaluator suite
before continuing with workflow-policy changes.

Commit: `fix: isolate evaluator candidate evidence`

---

## Task 1: Consolidate and structurally test workflow policy

**Files:**

- Add: `tests/workflow-policy.test.mjs`
- Replace: `.github/ci-policy.mjs`
- Delete: `.github/workflows/policy.yml`
- Modify: `tests/governance-policy.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

Add exact `yaml@2.9.0`. Encode RED fixtures for duplicate/escaped YAML keys,
aliases and flow-style unpinned actions, future or job-level write permissions,
extra `pull_request_target`, missing owner/member gate, moved/removed policy
step, live `pcda:codex` execution in CI, wrong merge-group head SHA, and weakened
package command. The old checker must demonstrably accept representative
bypasses.

The structural checker enforces the exact three-workflow set, triggers,
workflow/job permissions, full-SHA allowlist, checkouts, author gates, timeouts,
deterministic commands, manual-only live execution, dependency inputs, trusted
secret boundary, merge-policy contexts, and package command. CodeQL alone may
write `security-events`.

Set:

```json
"ci:policy": "node --test tests/workflow-policy.test.mjs && node .github/ci-policy.mjs"
```

**Checks:**

```bash
npm run ci:policy
npm test
git diff --check
```

Commit: `test: enforce structural evaluator workflow policy`

## Task 2: Harden deterministic CI and supply-chain inputs

**Files:**

- Modify: `.github/workflows/codeql.yml`
- Modify: `.github/workflows/quality.yml`
- Modify: `.github/workflows/secret-boundary.yml`
- Modify: `.github/dependabot.yml`
- Modify: `.github/merge-policy.json`
- Add or modify a trusted installer artifact only if required to hash-pin
  `uv==0.8.3`

Use Task 1 RED assertions, then:

- bound every job with an appropriate timeout;
- keep candidate execution after the `OWNER|MEMBER` gate with read-only tokens;
- install npm dependencies with `--ignore-scripts` and run a moderate audit
  before repository npm scripts;
- configure dependency review for moderate severity, all three dependency
  scopes, patched-version reporting, no comments, and exact merge-group SHAs;
- remove the unnecessary dependency-review checkout;
- replace the unhashed runtime `uv` installation with an immutable,
  checksum-verified `0.8.3` artifact while preserving offline calibration and
  excluding any real model run;
- preserve the exact hashed `.gitleaksignore` trusted boundary;
- declare the CodeQL job as required and group compatible/security Dependabot
  updates while suppressing routine major version-update churn.

**Checks:**

```bash
npm run format:check
npm run typecheck
npm run build
npm run canary:check
npm test
npm run smoke
npm run ci:policy
npm run dry-run
npm run pcda:calibrate
npm audit --audit-level=moderate
actionlint .github/workflows/*.yml
git diff --check
```

Commit: `ci: harden evaluator security gates`

## Task 3: Encode the selective-review agent lifecycle

**Files:**

- Modify: `AGENTS.md`
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`

Agents open PRs, provide exact fixture/manual/unavailable evidence, and enable
GitHub-native squash auto-merge. The external ruleset decides whether changed
governance or external-runner paths need the human-only team approval. Required
CI remains deterministic and credential-free; no custom merge controller or
live model execution is introduced.

**Checks:**

```bash
npm run ci:policy
npm run format:check
npm test
git diff --check
```

Commit: `docs: define selective-review evaluator lifecycle`

## Task 4: Verify security closure

Run the complete clean-install suite, a focused post-change Codex Security
review, and independent whole-branch review. Prove normal paths remain
zero-approval and each configured external execution path matches the future
human reviewer. Final closure requires the live ruleset and two confirming
reads.
