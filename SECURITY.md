# Security policy

Report vulnerabilities privately to `security@openboa.ai`. Do not place
credentials, private candidate artifacts, or sealed benchmark material in a
public issue.

This repository's security boundary covers evaluator-controlled execution,
host isolation evidence, artifact retention, receipt redaction, and report
integrity. It stores no personal Roastery content.

The current installed-Harbor path runs credential-free Oracle controls and a
manual Codex adapter. Harbor 0.21 native Codex is rejected because it exposes
provider authentication to candidate-readable state. The manual adapter keeps
the provider key in a host-held Responses proxy and passes only a per-trial
capability token to the candidate. Candidate execution is valid only when the
receipt proves that the provider key did not enter candidate-owned artifacts,
the proxy was closed, and the Docker environment was deleted after the trial.
