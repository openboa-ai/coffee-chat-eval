# Security policy

Report vulnerabilities privately to `security@openboa.ai`; do not include
credentials, private candidate artifacts, or sealed evaluation material in a
public issue. This repository's security scope is closed evaluator/host adapter
boundaries, evaluator-attested isolation and artifact persistence, receipt
redaction, and report validation. It is not the Coffee Chat product or a storage
location for personal Roastery content.

The baseline has no live provider or host integration. A future live adapter
must use a reviewed brokered credential, isolation, and provenance boundary
before use; a manually supplied shared key is not an acceptable substitute.
