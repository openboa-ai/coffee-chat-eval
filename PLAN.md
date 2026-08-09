# Coffee Chat evaluator plan

CalVer: `2026.8.9`

This clean migration shell establishes public candidate, task, harness, model,
host, and repetition types plus deterministic Cartesian trial identity. The
only executable report is a dry run: its fixture entry is `unmeasured`; its
real-host entry is `unavailable`; neither produces a performance score.

Provider execution, artifact persistence, isolation attestation, verifier
metrics, clocks/timing, detailed receipts, and real E2E are deferred. Public
execution APIs return an explicit deferred state until a separately authorized
implementation slice exists. `coffee-chat-bench` owns benchmark constructs,
verifiers, metrics, and validity evidence.

Migration planning and bootstrap proof are workspace coordination concerns,
not evaluator runtime capabilities. Ordinary changes use format, typecheck,
build, scenario tests, dry-run, smoke, policy, dependency review, and CodeQL.
GitHub-native squash merge permits `OWNER` and `MEMBER` authors with zero
required approvals. CalVer is the only release identity; no compatibility
layer is retained.
