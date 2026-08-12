# Coffee Chat Eval

`@openboa-ai/coffee-chat-eval` owns Coffee Chat evaluation orchestration,
receipts, and reports. Product implementation remains in `coffee-chat`;
candidate-independent benchmark constructs remain in `coffee-chat-bench`.

The first executable evaluator paths are a Harbor-first, Codex-only
`protocol-canary` and a one-case IFEval execution smoke. They run real
Harbor tasks through an exact Coffee Chat
Plugin commit, a clean Codex profile, a fresh session, and a separate verifier.
The result is always reported as `unmeasured`: it proves the evaluation plumbing
works but says nothing about Coffee Chat quality or value.

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

Task 2 stages Bench commit
`1a743f17a88a1e5b50b4b7e19c2cbeaef76922fa`, sends unsigned execution evidence
to its public `attest` CLI through `COFFEE_CHAT_EVAL_ATTESTATION_KEY`, and never
implements MAC canonicalization locally. Candidate credentials are accepted
only through a dedicated parent binding and mapped to child `OPENAI_API_KEY`
immediately before spawn; ambient Codex/provider auth is not inherited.

`pcda:codex` is manual-only. It projects and runs T0/T1-A/T1-B sequentially,
validates native evidence and cleanup, then invokes staged Bench `attest` and
`judge`. Judge receives the remaining combined cap through
`COFFEE_CHAT_EVAL_JUDGE_CAP_NANO_USD`; missing candidate cost evidence remains
unmeasured and stops before judgment.

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

Run the manual real Codex canary:

```sh
npm run canary:codex -- \
  --candidate-repo /absolute/path/to/coffee-chat \
  --candidate-commit <40-character-commit> \
  --model <codex-model>
```

The command stages only the requested Git commit, installs it using Codex's
local marketplace flow, verifies discovery/enabled state and source-cache
digest equality, executes the public `coffee-chat` entrypoint, retains native
Harbor/Codex artifacts, verifies cleanup, and emits an `unmeasured` receipt and
report under `artifacts/harbor/`.

Run the same exact candidate through the IFEval execution smoke:

```sh
npm run benchmark:smoke -- \
  --candidate-repo /absolute/path/to/coffee-chat \
  --candidate-commit <40-character-commit> \
  --model <codex-model>
```

This proves that pinned benchmark input is staged and read in the same task
that invokes the installed Plugin boundary, and that native Harbor, collected
artifact, Codex trace, separate verifier, cleanup, and an execution receipt are
produced. Because the current entrypoint accepts no benchmark input, the
receipt explicitly records `candidateInputDelivery: not_supported`. It is not
a performance evaluation.

IFEval has only this bounded execution smoke. Its full track and the other
rights-cleared portfolio tracks remain inactive; no measured Coffee Chat result exists.
`coffee-chat-bench` remains inactive.

GitHub-native squash merge is the only merge method. Candidate-executing
workflows admit only `OWNER` and `MEMBER` authors, require zero human
approvals, and retain dependency review and CodeQL. CalVer is the only release
identity and no compatibility layer is supported.
