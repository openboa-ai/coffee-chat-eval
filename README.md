# Coffee Chat evaluator

`@openboa/coffee-chat-eval` is the evaluation-orchestration repository for
Coffee Chat. This initial baseline provides deterministic, candidate-independent
trial identity, typed public adapter boundaries, fixture-host receipts, and
dry-run reporting.

The candidate produces artifact bytes; evaluator-owned infrastructure persists
them and returns a closed attestation over its locator, the canonical trial ID,
and the artifact digest. A host supplies only an evidence claim. An isolated
run cannot become measured unless an evaluator-owned inspector attests that
claim for the declared host configuration and the same trial and artifact.
Both attestations are runtime-validated before verification.

It does not contain Coffee Chat product internals, benchmark cases or metrics,
a real provider/model/host E2E, or a Coffee Chat performance result. Fixture
receipts are explicitly unmeasured and cannot become a score.

Run locally with `npm ci`, then `npm test`, `npm run typecheck`, and
`npm run dry-run`.

## Initial contribution policy

Same-repository branches use the normal protected pull-request path. Pull
requests from forks are intake-only during this initial setup: untrusted fork
workflows do not receive `code-quality: write`, so they cannot upload the
native coverage result required for merge. A maintainer must first review the
fork commits and promote the accepted commits to a same-repository branch;
that branch then runs the complete required gates and coverage upload before it
can merge.

This boundary is deliberate. Coverage upload errors and the repository's
native coverage restriction remain fail-closed; neither is weakened to make a
fork pull request directly mergeable.
