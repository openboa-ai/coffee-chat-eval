# PCDA Harbor Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume one exact Coffee Chat Bench commit and prove one Harbor-first Codex baseline family across T0, T1-A, and T1-B with auditable execution, isolation, judgment, and cleanup receipts.

**Architecture:** A PCDA-specific runner stages Bench by exact Git archive, invokes only its public projection and judgment CLIs, and runs each projected task through Harbor's native Codex agent in Docker. The staged Bench snapshot and resolved `uvx` executable are frozen module-issued capabilities backed by private inspection evidence, not structurally forgeable data. Eval owns host execution and receipts but never imports or reproduces Bench projection, verifier, judge, or metric logic. Task 1 is entirely secret-free: it accepts only fixed credential availability/source authorization metadata and returns a child-environment template plus an `OPENAI_API_KEY` binding name with no value. Task 2 alone may combine the actual explicitly authorized key with that template in a local variable immediately before spawn, then discard it without returning or serializing it. Required CI exercises deterministic fake/native fixtures only; real Codex and provider calls remain manual.

**Tech Stack:** Node.js 24, TypeScript, Harbor `0.21.0`, Codex `0.147.0`, Docker, Bench CalVer `2026.8.12`.

## Global Constraints

- The evaluated candidate is the native Codex baseline, not Coffee Chat Product; Product source and Plugin installation remain out of scope.
- First baseline is exactly one public Bench family and conditions `T0`, `T1-A`, and `T1-B`, repetition `0`. The candidate model is restricted to `gpt-5.6-terra`. Its credential must be supplied explicitly; the user has authorized the same saved key for the candidate phase and the later Terra/Luna judge phase.
- T0 receives no perspective; T1-A receives only perspective A; T1-B receives only perspective B.
- Eval pins an exact 40-character Bench commit and computed bank digest and never copies Bench source logic.
- Harbor is first and authoritative for task/environment/verifier execution; Bench remains authoritative for deterministic verdict, judge votes, QPCFR state, and cost receipts.
- Host, candidate, verifier, artifact, judge disagreement, judge unavailable, skipped, unavailable, and unmeasured states remain distinct.
- Candidate-visible inputs contain no judgment material and only `/app/output.json` crosses to the separate verifier. The task network baseline remains `no-network`; Harbor promotes the setup environment only to the fixed Alpine/Codex install hosts `dl-cdn.alpinelinux.org` and `registry.npmjs.org`. The task's explicit agent no-network policy then receives only `api.openai.com`, while the separate verifier remains no-network. This is not described as effective candidate network disabled.
- Required CI makes no Codex/model/provider call. Live execution is manual, sequential, and outside CI.
- Live judge roster is exactly `gpt-5.6-terra` and `gpt-5.6-luna`. Task 2 must enforce one combined candidate-plus-judge cap of USD 50 rather than separate or judge-only budgets.
- The parent `.env.local`/process environment is never inherited by Harbor, even when it contains the same authorized key. Every Task 1 exported or serializable object contains zero credential bytes. Task 1 records only `saved-openai-api-key` availability and `candidate-and-judge` authorization metadata plus the child variable name `OPENAI_API_KEY`; the key may equal the later judge credential but enters only Task 2's spawn-local environment and never argv, mounts, receipts, reports, or logs.
- Harbor must not inherit host Codex login state, Keychain material, `~/.codex`, provider environment variables, or ambient agent credentials. A live candidate run remains unavailable until the explicitly authorized candidate credential is supplied.
- Task 1 permits exactly two fixed setup hosts through repeated `--allow-environment-host`: `dl-cdn.alpinelinux.org` for Alpine system packages and `registry.npmjs.org` for the musl-path Codex npm install verified in Harbor 0.21 source. They are not caller-configurable. The first agent-phase provider allowlist is exactly `api.openai.com` through one `--allow-agent-host`; public network and additional hosts are forbidden. The separate verifier inherits neither setup nor agent hosts.
- The current Bench attestation field `candidateNetwork=disabled` is incompatible with a live remote model. It must be replaced by honest phase-level network evidence before Task 2 can issue a live receipt.
- Receipts contain digests and paths, never raw prompts, raw model responses, credentials, or authorization headers.
- CalVer remains exactly `2026.8.12`; no compatibility layer or secondary version axis.

---

### Task 1: Exact Bench staging and deterministic PCDA job projection

**Files:**

- Create: `src/pcda-bench.ts`
- Create: `src/pcda-harbor.ts`
- Create: `tests/pcda-baseline.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces `stageBenchSnapshot({repo, commit})`, `projectPcdaFamily(...)`, and `buildPcdaHarborArgs(...)`.
- A staged snapshot records an Eval-owned digest over every sorted staged directory, regular file, and dependency symlink entry after lifecycle-disabled install and Bench validation. Before any staged CLI invocation, Eval rechecks the module-issued snapshot identity, canonical source/root, exact commit/archive provenance, and whole staged tree.
- A projected condition records exact Bench commit, Bench-provided candidate/projection/verifier digests, case source digest, trial ID, canonical projection paths, and an Eval-owned execution-tree digest over every sorted directory and regular-file entry type, root-independent relative path, mode, and file byte sequence in the complete projection root.

- [ ] Write failing tests for exact-commit rejection, dirty/missing commit rejection, stable archive digest, valid bank digest, exact T0/T1-A/T1-B mapping, canonical realpaths from caller aliases, no judgment in candidate trees, lifecycle-script suppression, full projection-tree mutation rejection, secret-free serialized launch evidence, branded immutable `uvx` resolution/recheck, native Harbor arguments using only `codex`, explicit candidate model/provider authorization metadata, Docker, one concurrent trial, a fresh job directory, phase-level network allowlists, plus rejection of ambient host credentials and parent-key propagation.
- [ ] Run `node --experimental-strip-types --test tests/pcda-baseline.test.ts` and record RED for missing modules.
- [ ] Implement staging with `git rev-parse` plus `git archive`; reject symlinks, install exact lockfile dependencies with scripts disabled and a malicious preinstall canary, run Bench `validate`, and invoke Bench `project` for one selected case and three conditions.
- [ ] Verify literal condition projections: `none → T0`, `a → T1-A`, `b → T1-B`; inspect generated candidate files and reject any verifier/judgment/Oracle path or extra perspective.
- [ ] Bind Harbor construction to the projected object and exact `<projectionRoot>/harbor/task.toml`; recompute the execution-tree digest and reject any added, removed, changed, mode-modified, symlinked, or non-regular entry; validate exactly one `/app/output.json`, no-network task/environment baselines, separate verifier, and no-network verifier environment.
- [ ] Resolve `uvx` before any secret exists against an explicit frozen trust policy obtained independently from a trusted installation receipt or operator-pinned toolchain preflight: require a canonical absolute no-symlink executable owned by the current user, reject group/world write, require the observed SHA-256 bytes and exact bounded `uvx --version` to equal the policy, and return a frozen module-branded capability carrying separate observed/policy digest/version evidence. Recheck brand, path, digest, mode, ownership, and policy binding in the builder. Do not hardcode a developer-machine digest in source.
- [ ] Build Harbor args with the resolved `uvx`, `--from harbor==0.21.0 harbor run --path <trusted-task> --agent codex --model gpt-5.6-terra --env docker`, exactly two fixed `--allow-environment-host` values for Alpine/Codex setup, exactly one `--allow-agent-host api.openai.com`, `--n-concurrent 1 --yes --quiet`, and condition-specific job names. Return only a secret-free environment template and credential binding metadata; no Task 1 input or output accepts or contains a credential value.
- [ ] Run focused tests, typecheck, format, and commit `feat(eval): stage PCDA benchmark baseline`.

### Task 2: Explicit PCDA execution and receipt contract

**Files:**

- Create: `src/pcda-receipt.ts`
- Create: `src/pcda-cli.ts`
- Modify: `src/pcda-harbor.ts`
- Modify: `tests/pcda-baseline.test.ts`
- Modify: `AGENTS.md`
- Modify: `PLAN.md`
- Modify: `README.md`
- Modify: `docs/quality-map.md`

**Interfaces:**

- Produces CLI `pcda:calibrate` and `pcda:codex` and one campaign receipt containing exactly three condition receipts.
- Each condition receipt separates `executionState`, `candidateState`, `verifierState`, `judgeState`, and `measurementState` and binds native Harbor/Bench evidence.

- [ ] Write failing tests for Oracle=accepted/no-op=rejected calibration through the staged Bench verifier, exact result-state crosswalk, malformed native result, missing output, verifier failure, judge tie/unavailable, cleanup failure, dirty evaluator tree, and receipt secret/raw-text exclusion.
- [ ] Record focused RED, then implement deterministic calibration without model calls.
- [ ] Implement sequential live runner only after replacing the incompatible `candidateNetwork=disabled` attestation. Require fresh job roots and the explicitly authorized key input; permit the same value to be reused later for judging but never inherit ambient values. Before any secret exists, obtain and record an immutable `uvx` trust policy from a trusted installation receipt or explicit operator-pinned preflight; resolve the tool against it. Immediately before the secret-bearing spawn, recheck the branded tool and the same policy binding, combine the key with the Task 1 environment template only in a local spawn variable as child `OPENAI_API_KEY`, then discard it after execution and never return it. Run Harbor from the exact fixed setup/agent/verifier network contract with no host Codex home/login/keychain mounts; locate exactly one native trial; validate native identities and the execution-tree digest; collect safe lock/image/task/projection/verifier/artifact/trajectory digests; prove no matching Docker containers remain.
- [ ] Invoke the staged Bench `judge` CLI only after Harbor returns an artifact. Restrict judges to `gpt-5.6-terra` and `gpt-5.6-luna`, enforce a combined candidate-plus-judge USD 50 cap before every provider call, preserve the exact JSON state and receipts, and do not reinterpret native reward as QPCFR or Coffee Chat performance.
- [ ] Require a clean evaluator commit before issuing receipts. Bind evaluator commit, Bench commit/bank digest/CalVer, condition, repetition, model, Harbor/Codex versions, native trial identity, artifact paths/digests, isolation evidence, cleanup, Bench judgment result, wall time, and token/cost fields.
- [ ] Add `npm run pcda:calibrate` to deterministic local/PR verification. Add `npm run pcda:codex -- --bench-repo PATH --bench-commit COMMIT --case PATH --candidate-model MODEL --candidate-credential-env NAME` as manual only; policy tests must reject it from required CI and must reject `OPENAI_API_KEY` as the candidate credential name.
- [ ] Update repository docs to make PCDA the first performance-capable external benchmark path while retaining protocol-canary and IFEval as implementation/execution evidence.
- [ ] Run format, typecheck, build, all tests, canary checks, deterministic PCDA calibration, smoke, CI policy, dry-run, Gitleaks hook, and commit `feat(eval): run PCDA Harbor baseline`.

### Task 3: Merge exact implementation and run one live baseline family

**Files:**

- Create after live execution: `reports/pcda/2026.8.12/baseline-receipt.json`
- Create after live execution: `reports/pcda/2026.8.12/baseline-report.md`
- Modify: workspace `docs/engineering/workflow-handoff.md` only after repository receipts are verified.

**Interfaces:**

- Consumes clean merged Eval and Bench commits and one explicitly authorized OpenAI API key for candidate and judge phases. It must not obtain that key through ambient inheritance or use existing host Codex authentication.
- Produces three native T0/T1-A/T1-B condition receipts and one campaign receipt/report.

- [ ] Merge Tasks 1-2 through required CI and native squash auto-merge; use the resulting exact Eval commit.
- [ ] Run deterministic PCDA calibration from clean `main` and verify no provider/model call.
- [ ] Run one sequential native Codex family with candidate `gpt-5.6-terra` only after the authorized key is explicitly supplied; remove it from the child context after candidate execution, then invoke Bench `gpt-5.6-terra`/`gpt-5.6-luna` judging only after candidate shutdown, cleanup evidence, and each deterministic verifier pass, under one combined USD 50 cap.
- [ ] Verify every receipt digest against current files, confirm explicit state separation, inspect Docker cleanup, and run a secret scan before publication.
- [ ] Publish receipt/report through a second PR. Label the run as one-family baseline E2E evidence, not benchmark-wide performance, utility, generalization, or activation proof.
