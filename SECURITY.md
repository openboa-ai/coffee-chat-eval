# Security policy

Report vulnerabilities privately to `security@openboa.ai`. Do not place
credentials, private candidate artifacts, or sealed benchmark material in a
public issue.

This repository's security boundary covers evaluator-controlled execution,
host isolation evidence, artifact retention, receipt redaction, and report
integrity. It stores no personal Roastery content.

The current installed-Harbor path runs credential-free Oracle controls only.
Harbor 0.21 native Codex is rejected because it exposes provider authentication
to candidate-readable state. Candidate execution may be enabled only after a
credential-isolated boundary proves that the secret never enters candidate
environment variables, files, memory, artifacts, or logs and that all proxy and
temporary state is removed after each trial.
