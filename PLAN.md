# Coffee Chat evaluator plan

CalVer: `2026.8.9`

This first implementation establishes a deterministic evaluator shell: public
`CandidateRef`, task, host, harness, and model references; stable Cartesian
trial identity; typed adapters; redacted immutable receipts; validation; and
fixture-only dry-run reporting. Trial identity and receipts bind the evaluator
commit/configuration and host configuration/isolation reference. Structurally
valid, inspectable host evidence is mandatory before an isolated trial can be
measured. Artifact bytes come from the candidate, while persistence and its
closed locator/trial/artifact attestation belong to evaluator-owned
infrastructure. An evaluator-owned inspector separately attests host evidence
for the declared host configuration, canonical trial identity, and artifact
digest. Both closed attestations are runtime-validated before verification.
Invalid public trial input becomes one fixed, JSON-safe, redacted receipt. The
fake candidate and fake host are plumbing fixtures, not Coffee Chat performance
evidence.

The next separately authorized vertical slice may add one real pinned
candidate, provider/model, and inspectably isolated host. It must preserve the
same external boundary, record complete provenance and cleanup, and report any
unsupported state without zero-filling it. Benchmark constructs remain owned by
`coffee-chat-bench` when it becomes active.

Migration planning and bootstrap proof are workspace coordination concerns,
not evaluator runtime or CI capabilities. Ordinary changes use the repository
Quality Map and normal PR gates. Fork pull requests are intake-only until a
maintainer promotes reviewed commits to a same-repository branch that can
satisfy the native coverage restriction.
