# Codex baseline coverage

## Status

This report is execution and isolation evidence only. It does not create a semantic score, qualify a judge, establish validity, or activate the benchmark.

## Frozen provenance

- release: `2026.8.12`
- benchmark commit: `1bc71605964770bbd1bd96e049b8412b6ee068fc`
- projection digest: `sha256:b66e45ee0d09c4afad92d974e1315c8cfa85d9ca0de1a48ac08219afabd1a9c3`
- receipt aggregate digest: `sha256:49ebdaa2dfe1adba954460b9d76a3b0c95c7483356de6961209f36fc19273a23`

## Coverage

The run covers all 12 scored case families in the public `release_a` and `release_b` slices: three policy blocks × two forms for each release. Each case was executed under `task_only` and `diagnostic_target_a` by both `gpt-5.6-luna` and `gpt-5.6-terra`, producing 48 Harbor trials.

Every receipt now carries the exact projection task identity: `caseId`,
condition, `trialId`, task digest, and task-bytes digest. The identity is
bound to the same frozen projection manifest named above; the local task path
is intentionally excluded. This makes each execution independently
addressable without treating the Harbor reward or the receipt itself as a
semantic score.

All 48 receipts report:

- `execution.resultState = executed`;
- Docker execution with container deletion evidence;
- `verifierEnvironmentMode = separate`;
- candidate network allowlist restricted to `host.docker.internal`;
- `providerKeyInCandidateArtifacts = false`; and
- `measurement = unmeasured`.

The structural Harbor reward is not a quality or utility score. Judge qualification, human criterion, reliability, contamination, and validity gates remain separate Bench-owned evidence requirements.
