# Coffee Chat evaluator plan

CalVer: `2026.8.9`

This first implementation establishes a deterministic evaluator shell: public
`CandidateRef`, task, host, harness, and model references; stable Cartesian
trial identity; typed adapters; redacted immutable receipts; validation; and
fixture-only dry-run reporting. The fake candidate and fake host are plumbing
fixtures, not Coffee Chat performance evidence.

The next separately authorized vertical slice may add one real pinned
candidate, provider/model, and inspectably isolated host. It must preserve the
same external boundary, record complete provenance and cleanup, and report any
unsupported state without zero-filling it. Benchmark constructs remain owned by
`coffee-chat-bench` when it becomes active.
