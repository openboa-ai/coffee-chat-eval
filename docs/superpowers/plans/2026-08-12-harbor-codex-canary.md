# Harbor-first Codex protocol canary implementation plan

## Objective

Prove one complete evaluator-owned execution loop without claiming Coffee Chat
performance:

```text
protocol_canary task
  -> Harbor environment and agent lifecycle
  -> candidate artifact
  -> separate Harbor verifier
  -> native Harbor result
  -> Coffee Chat receipt and report (unmeasured)
```

The same task package must run with Harbor's `oracle`, `nop`, and real
`codex` agents. Oracle must pass, no-op must fail, and malformed verifier
output must remain a verifier failure. These are implementation checks for the
evaluator, not benchmark scores.

## Boundaries

- `coffee-chat-eval` owns the task canary, Harbor job projection, Codex Plugin
  installation adapter, result crosswalk, receipt, and report.
- `coffee-chat` is an external candidate pinned by repository commit and
  installed through Codex's Plugin interface. Eval never imports Product
  internals.
- `coffee-chat-bench` remains `not_active`. The protocol canary tests the
  evaluator pipeline and creates no Taste benchmark claim.
- Coffee Blend, full benchmark measurement, performance scoring, and CI model
  calls are excluded. One bounded IFEval adapter smoke is included solely
  to prove that an external benchmark case executes end to end.
- Harbor is pinned once at `0.21.0`. Coffee Chat keeps its existing CalVer;
  no compatibility layer or additional version axis is introduced.

## Evidence lanes

### Required CI: deterministic implementation evidence

1. Validate the immutable protocol-canary task package and its sealed verifier.
2. Project stable Harbor job configurations for Oracle, no-op, and Codex.
3. Parse representative native Harbor results.
4. Preserve candidate, host, and verifier failures as distinct states.
5. Reject missing or malformed verifier artifacts.
6. Emit schema-validated receipts and reports that remain `unmeasured`.

CI performs no model call and publishes no performance result.

### Manual integration: real execution evidence

1. Run the same protocol-canary package with Harbor Oracle and no-op controls.
2. Build the exact Coffee Chat candidate commit.
3. Install it through a local Codex Plugin marketplace into a clean Codex
   profile inside the Harbor trial.
4. Verify installed-cache digest, fresh-session Skill discovery, explicit
   public Coffee Chat invocation, native Codex trajectory, verifier result, and
   environment cleanup.
5. Convert the native Harbor result into a validated Coffee Chat receipt and
   report with `resultState: unmeasured`.
6. Run one pinned official IFEval case through the same exact installed
   candidate and emit a separate execution receipt. Preserve
   `executionStatus=executed`, `resultState=not_implemented`, and
   `measurement=not_performed` as separate facts.

## Task package

`evals/protocol-canary/` is deliberately tiny:

- `instruction.md` asks the agent to use the Coffee Chat Plugin's public
  entrypoint and write one canonical JSON artifact.
- `solution/solve.sh` writes the exact valid artifact for Harbor Oracle.
- `tests/test.sh` validates only the public artifact; it cannot inspect Plugin
  source or evaluator state.
- `task.toml` uses a separate verifier environment and bounded timeouts.

The artifact records protocol conformance only. Its Harbor reward is retained
as native evidence but never mapped to a measured Coffee Chat score.

`evals/ifeval-smoke/` is a distinct external-benchmark execution smoke. It
pins official source and dataset provenance, removes judgment labels from the
candidate-visible case, and keeps the reference in the separate verifier. Its
native reward is plumbing evidence only; the full IFEval metric is not
implemented or claimed.

## Implementation sequence

1. Add failing tests for job projection, native-result parsing, state
   crosswalk, receipt/report invariants, and the task package contract.
2. Implement the smallest explicit TypeScript modules that satisfy those
   contracts.
3. Add the protocol-canary package and deterministic Harbor runner command.
4. Run Harbor Oracle/no-op/malformed-verifier calibration.
5. Add the Codex installation adapter only after calibration is green.
6. Run one real Codex trial, validate evidence, then run the complete repository
   checks.
7. Run the IFEval Oracle and the exact Coffee Chat candidate through the
   one-case smoke, validate cleanup and native artifacts, and emit the benchmark
   execution receipt.

## Acceptance criteria

- One command executes the canary through Harbor.
- Oracle produces native reward 1 and no-op produces native reward 0.
- A malformed verifier artifact is not interpreted as candidate failure or
  reward 0.
- The Codex trial uses an exact candidate commit and a clean Codex profile.
- Plugin installation and discovery evidence is inspectable.
- The final receipt records Harbor/Codex/candidate/task identities and cleanup.
- The final result remains `unmeasured`; no performance score or benchmark
  activation is asserted.
- The pinned IFEval task executes with Oracle and real Codex; the current
  Product's deferred status remains `not_implemented`, and no semantic
  measurement is fabricated.
