# External source notices

This repository does not vendor external benchmark task bytes. An operator may
materialize the exact sources listed below into `EVAL_CACHE_ROOT` only after
the corresponding `SourceManifest` and current provider terms pass verification.

- Coffee Chat Bench, commit `43d3350be9e7aa2498b7843dad3a956728fe5d54`, MIT.
- BEAM code, commit `3e12035532eb85768f1a7cd779832b650c4b2ef9`, MIT; BEAM
  100K data, revision `3205395e897e7318c7b094ef4e6047b9b82dbb03`, CC BY-SA
  4.0. Attribution and ShareAlike obligations remain with any permitted
  materialization; raw data is not redistributed by Eval.
- Google Research IFEval, commit `e6890f85757dd84e27ca6df2dd30651dafad28e0`,
  Apache-2.0. The historical GPT-4 response file is excluded.
- AgentDojo, package `0.1.35`, commit
  `a75aba7631d3ca5fb7ab938965c97ead2f9ff84b`, MIT. Only synthetic native
  environments and tasks are in scope; no live account or third-party
  workspace data is used.

See [`src/source-manifests.ts`](src/source-manifests.ts) for the exact
allowlist, excluded paths, license digests, retention policy, census, and
notice URLs. This notice is an engineering preflight, not legal advice.
