# Trusted repository baseline caller

Product planning remains pending. This change connects repository hygiene checks
to the delivered common baseline without introducing product behavior or changing
existing merge and review policy.

## Requirements and boundaries

R1. Add the separate inert `.github/workflows/trusted-baseline.yml` wrapper. Run
it for `pull_request_target` against main (opened, synchronize, reopened, edited)
and main pushes. Its only job is `trusted-baseline`, calling
`openboa-ai/.github/.github/workflows/repository-baseline.yml` at immutable SHA
`83967987ca23cc8b8eda60975eda320e434fb7bd`. Use read-only contents permission,
bounded concurrency and no inputs, inherited secrets or executable steps.

R2. Keep `.github/workflows/ci.yml` byte-for-byte unchanged, including the required
`Repository baseline` job and its manual-dispatch behavior. Preserve ownership,
required checks, branch protection and code-owner review. Add no credentials,
unsafe checkout opt-ins, deployment, automatic merge or scheduled development.

R3. The shared check admits same-repository PR branches only, validates repository
IDs/names, retrieves the base repository PR ref and verifies exact event head/base.
It checks workflow text, whitespace and secrets as data with fixed trusted tools.
It executes no product code and does not validate local action metadata or product
quality. Fork PRs are unsupported. Failure, cancellation or missing evidence is
not success; changed head/base or pin requires fresh affected evidence and review.

## Verification and delivery

For R1 and R2, inspect the exact wrapper against the delivered common contract,
lint both workflow files and check whitespace and secrets. Verify the original
CI bytes remain unchanged. Accept this scoped specification before dependent
implementation and independently review the final source patch. Complete actual
current-head existing CI, Code Review and Security Review; inspect and address
findings before requesting native code-owner approval and protected merge.

For R3, this bootstrap PR cannot prove a base-owned target run because the wrapper
is absent from main. After normal merge, observe the main-push run and the next
substantive PR's target run. Check server workflow identity/path/event, target
commits, referenced common revision and successful job; candidate-produced claims
or check names alone are insufficient. No disposable PR is required by this change.
Enrollment as an additional required check is a separate operation after real
producer qualification and applicable Actions event-policy verification. Keep the
old required check throughout. Do not alter event policies in this change.

Existing main remains the recovery state until normal delivery. If verification
fails, correct this same infrastructure PR and rerun affected checks. Do not
reinterpret source review as native approval, a bootstrap run as target evidence,
or infrastructure checks as product implementation or automatic operation.
