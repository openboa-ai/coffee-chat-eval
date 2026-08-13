# Coffee Chat evaluator plan

CalVer: `2026.8.12`

## Current executable boundary

`coffee-chat-eval` is Harbor-first and Codex-only. Its first executable path
is the evaluator-owned `protocol-canary`:

```text
Harbor task
  -> clean Docker host
  -> exact Coffee Chat commit installed through a local Codex marketplace
  -> fresh Codex session and public coffee-chat Skill invocation
  -> separate verifier
  -> native Harbor result
  -> Coffee Chat receipt/report marked unmeasured
```

Oracle=1 and no-op=0 calibrate the same task/verifier package. Both rewards are
pipeline evidence, never Coffee Chat performance. Malformed verifier output,
host failure, candidate failure, and invalid artifacts remain distinct.

Required CI validates deterministic job projection, result parsing, receipt and
report contracts, task/verifier separation, Plugin evidence parsing, and status
crosswalks. It performs no model call or performance evaluation. Credential-bearing
candidate execution is fail-closed until a broker or split-process boundary
keeps provider credentials unreadable to candidate code.

One official IFEval case is also projected into a separate Harbor task to
prove the external-benchmark execution boundary:

```text
pinned source manifest + candidate-visible case without judgment labels
  -> task reads input and invokes the exact installed Coffee Chat Plugin boundary
  -> separate verifier with sealed reference
  -> native Harbor/Codex evidence
  -> benchmark execution receipt
     executionStatus=executed
     resultState=not_implemented
     measurement=not_performed
     candidateInputDelivery=not_supported
```

Required CI executes only deterministic, credential-free Oracle/no-op Harbor
calibration. The former live Codex/model smoke is disabled for the same
credential-isolation reason.

Harbor is pinned at `0.21.0`. Eval retains the public evidence parsers without
staging or executing candidate Plugin bytes in the calibration path.

## Performance boundary

The current Product `coffee-chat` entrypoint is discoverable but reports
`not_implemented`. The canary verifies that this honest status survives the
actual host path. It does not establish application fidelity, utility,
efficiency, or benchmark value.

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
