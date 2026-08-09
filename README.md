# Coffee Chat evaluator

`@openboa/coffee-chat-eval` is the evaluation-orchestration repository for
Coffee Chat. This initial baseline provides deterministic, candidate-independent
trial identity, typed public adapter boundaries, fixture-host receipts, and
dry-run reporting.

The candidate produces artifact bytes; the host is responsible for persistence
and supplies the locator retained by the receipt. The evaluator never invents a
locator from a digest. An isolated run cannot become measured unless both the
artifact locator and isolation evidence are immutable and mutually bound.

It does not contain Coffee Chat product internals, benchmark cases or metrics,
a real provider/model/host E2E, or a Coffee Chat performance result. Fixture
receipts are explicitly unmeasured and cannot become a score.

Run locally with `npm ci`, then `npm test`, `npm run typecheck`, and
`npm run dry-run`.

## Bootstrap migration authority

The migration objective, projection, equality inputs, and execution receipt in
`docs/migration/` authorize only the clean repository bootstrap. They are an
immutable trust base after that bootstrap lands. An ordinary post-bootstrap
pull request does not create or refresh a legacy migration classification;
instead it declares one product or system objective, its observable acceptance
criteria, and the relevant Quality Map and CI evidence.

The bootstrap checker validates the closed JSON schemas, reviewed authority
digests, changed-surface classification, and exact byte and Git-blob equality
for the selected `.gitignore` migration. The empty `rewrite` and `exclude`
evidence arrays are intentional: no rows with those actions were selected for
this bootstrap.

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
