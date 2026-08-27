# Security policy

Report vulnerabilities privately to `security@openboa.ai`. Do not put
credentials, private run artifacts, sealed benchmark material, or personal
data in a public issue.

Coffee Chat Eval is an execution and evidence boundary. Candidate-readable
state must not contain provider credentials, host secrets, unrelated files, or
unredacted environment dumps. Receipts and traces must be reviewed for secret
and personal-data leakage before they leave the private execution area.

Run inputs and outputs can contain private Origin/Bean material even when the
benchmark definition is public. Keep generated iteration evidence private and
append-only unless its owner has explicitly approved publication. Do not treat
an evaluator, Judge, connectivity check, or successful process exit as
permission to disclose data or as proof of Product performance.
