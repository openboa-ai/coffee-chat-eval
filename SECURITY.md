# Security policy

Report vulnerabilities privately to `security@openboa.ai`; do not include
credentials, private candidate artifacts, or sealed evaluation material in a
public issue. This repository's security scope is closed evaluator/host adapter
boundaries, evaluator-attested isolation and artifact persistence, receipt
redaction, and report validation. It is not the Coffee Chat product or a storage
location for personal Roastery content.

The baseline includes live local Harbor/Docker hosting only for deterministic
Oracle/no-op calibration. It rejects credential-bearing ambient environments and
passes an allowlisted child environment; it has no provider or untrusted
candidate integration. A future live candidate adapter must use a reviewed
brokered credential, isolation, and provenance boundary before use; a manually
supplied shared key is not an acceptable substitute.
