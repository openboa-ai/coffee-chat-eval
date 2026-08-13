# Retired PCDA live-budget boundary

The former candidate-plus-judge live execution path is not part of the current
runtime. It was removed because Harbor candidate execution and the trusted
judge loaded the same provider credential, so candidate-controlled code could
read a key later trusted by the judge. Manual operation and network allowlists
did not create credential separation.

The repository now retains credential-free Oracle/no-op PCDA calibration only.
A future live path must use a reviewed credential broker or split execution
service that keeps provider secrets outside the candidate process and
filesystem, enforces provider-side spend limits, and scans retained outputs.
Until all three properties are verified, measured PCDA execution remains
unavailable.
