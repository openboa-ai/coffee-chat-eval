# PCDA remaining-budget contract

Bench commit `1a743f17a88a1e5b50b4b7e19c2cbeaef76922fa` provides the public
`attest` and remaining-budget `judge` boundary.

Eval invokes `attest <unsigned> <signed>` and then
`judge <projection-root> <artifact> <signed-attestation>`. The staged process
receives a 32-byte base64url `COFFEE_CHAT_EVAL_ATTESTATION_KEY` and a canonical
integer `COFFEE_CHAT_EVAL_JUDGE_CAP_NANO_USD` between 0 and 50000000000.

Eval computes the remaining cap only after bounded candidate cost evidence.
It uses the larger of Harbor-reported cost and the pinned Terra estimate of $2
per million input tokens plus $12 per million output tokens, rounded up to
nano-USD. Missing both cost and token evidence stops judgment as unmeasured.
Capabilities, provider keys, raw prompts, and raw responses do not enter the
receipt.

The Eval ledger is an operational stop condition, not a provider-side hard
limit for an already-started request. It reserves candidate calls and refuses
later candidate or judge calls when observed cost cannot fit, but Harbor/Codex
does not expose a per-request dollar cap. A live campaign that must never cross
USD 50 therefore also requires a verified provider/project hard spend limit;
without that external precondition the campaign remains unavailable.
