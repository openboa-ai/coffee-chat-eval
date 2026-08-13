# Coffee Chat evaluator plan

CalVer: `2026.8.12`

## Current executable boundary

`coffee-chat-eval` currently exposes only credential-free evaluator calibration.
Its first executable path is the evaluator-owned `protocol-canary` task package:

```text
Harbor task
  -> clean Docker host
  -> bundled Oracle or no-op calibration solution
  -> separate verifier
  -> native Harbor result
  -> evaluator calibration receipt/report marked unmeasured
```

Oracle=1 and no-op=0 calibrate the same task/verifier package. Both rewards are
pipeline evidence, never Coffee Chat execution or performance. No Coffee Chat
commit, Plugin, Skill, Codex session, model call, or provider credential enters
this path. The launcher rejects credential-shaped ambient variables and passes
only an allowlisted process environment to pinned Harbor. Malformed verifier
output, host failure, calibration failure, and invalid artifacts remain
distinct.

Required CI validates deterministic job projection, result parsing, receipt and
report contracts, task/verifier separation, Plugin evidence parsing, and status
crosswalks. It performs no model call or performance evaluation. Credential-bearing
candidate execution is fail-closed until a broker or split-process boundary
keeps provider credentials unreadable to candidate code.

One official IFEval case is projected into a separate Harbor task to calibrate
the external task/verifier boundary without running a product candidate:

```text
pinned source manifest + task input without judgment labels
  -> bundled Oracle or no-op calibration solution
  -> separate verifier with sealed reference
  -> native Harbor calibration evidence
  -> benchmark calibration receipt with measurement=not_performed
```

Required CI executes only deterministic, credential-free Oracle/no-op Harbor
calibration. The former live Codex/model smoke is disabled for the same
credential-isolation reason.

Harbor is pinned at `0.21.0`. Eval retains the public evidence parsers without
staging or executing candidate Plugin bytes in the calibration path.

## Performance boundary

No current Product `coffee-chat` entrypoint is installed or executed. The
Oracle/no-op pair verifies only evaluator plumbing and fail-closed result
parsing; it cannot establish candidate discoverability, application fidelity,
utility, efficiency, or benchmark value. Any future candidate path must remain
explicitly `not_implemented` until credential isolation and candidate-input
delivery are implemented and reviewed.

IFEval's single-case smoke is executable, source-pinned, and execution only.
Full IFEval measurement and the remaining rights-cleared portfolio tracks stay
inactive pending native metric reproduction, bounded cost, and a justified
Coffee Chat projection.
Coffee Blend is excluded from this initial evaluation scope.

## PCDA calibration boundary

PCDA retains deterministic Oracle/no-op calibration and exact native-result
state parsing only. The credential-bearing candidate runner, staged Bench
signer/judge adapter, and manual live command are removed. A future measured
path requires a credential broker or split service that keeps provider secrets
outside candidate-controlled execution; manually sharing a key is prohibited.

`coffee-chat-bench` remains `not_active`. A later candidate-independent Taste
benchmark requires separate construct-validity evidence and must not be
inferred from this evaluator-owned canary.

CalVer is the only release identity and no compatibility layer is provided.
