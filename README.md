# Coffee Chat Eval

`@openboa-ai/coffee-chat-eval` owns Coffee Chat evaluation orchestration,
receipts, and reports. Product implementation remains in `coffee-chat`;
candidate-independent benchmark constructs remain in `coffee-chat-bench`.

The first executable evaluator paths are credential-free Harbor Oracle/no-op
calibrations for `protocol-canary` and a one-case IFEval execution contract.
They prove the task/verifier plumbing without loading untrusted Plugin bytes
into a credential-bearing Codex process. Results remain `unmeasured` and say
nothing about Coffee Chat quality or value.

The IFEval smoke uses one pinned official Apache-2.0 case, keeps its constraint
metadata in the separate
verifier, and records `executed` independently from semantic measurement. With
the current deferred Product entrypoint its receipt is `not_implemented` and
`measurement: not_performed`; no benchmark score is claimed.

The task is calibrated with Harbor Oracle and no-op agents. Oracle must produce
native reward 1, no-op must produce native reward 0, and malformed verifier
output must remain invalid rather than becoming reward 0. Required CI checks
these implementation contracts without model calls.

Run the Harbor Oracle/no-op calibration:

```sh
npm run canary:calibrate
```

Run deterministic PCDA contract calibration:

```sh
npm run pcda:calibrate
```

PCDA currently exposes only deterministic Oracle/no-op calibration. The former
`pcda:codex` candidate runner and staged Bench signer/judge adapter were
removed because a manually supplied shared key remained readable to
candidate-controlled execution. Live PCDA stays unavailable until a credential
broker or split service keeps provider secrets outside the candidate process
and filesystem.

Run deterministic verification:

```sh
npm ci
npm run hooks:install
npm run format:check
npm run typecheck
npm run canary:check
npm test
npm run dry-run
npm run smoke
npm run pcda:calibrate
npm run ci:policy
npm run security:scan
```

Gitleaks must be installed before enabling the hook. The local hook checks
staged changes and required CI independently scans the complete Git history.

All former live candidate commands are removed. Harbor
0.21.0 places Codex authentication in the same filesystem as candidate-controlled
execution, so network filtering alone cannot make that boundary safe. Re-enable
live candidate execution only behind a credential broker or split process that
keeps provider credentials unreadable to candidate code and scans all retained
outputs before publication.

IFEval has only this bounded execution smoke. Its full track and the other
rights-cleared portfolio tracks remain inactive; no measured Coffee Chat result exists.
`coffee-chat-bench` remains inactive.

GitHub-native squash merge is the only merge method. Candidate-executing
workflows admit only `OWNER` and `MEMBER` authors, require zero human
approvals, and retain dependency review and CodeQL. CalVer is the only release
identity and no compatibility layer is supported.
