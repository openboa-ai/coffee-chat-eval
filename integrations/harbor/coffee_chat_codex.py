from pathlib import Path, PurePosixPath
import shlex

from harbor.agents.installed.codex import Codex
from harbor.environments.base import BaseEnvironment
from harbor.models.trial.paths import EnvironmentPaths


class CoffeeChatCodex(Codex):
    """Codex agent that installs one exact Coffee Chat Plugin candidate."""

    _REMOTE_CANDIDATE = PurePosixPath("/tmp/coffee-chat-candidate")
    _PLUGIN_ID = "coffee-chat@openboa-ai"

    def __init__(
        self,
        *args,
        candidate_path: str,
        candidate_commit: str,
        **kwargs,
    ) -> None:
        self._candidate_path = Path(candidate_path).resolve()
        self._candidate_commit = candidate_commit
        manifest = self._candidate_path / "candidate-commit.txt"
        plugin = self._candidate_path / "plugin"

        if not plugin.is_dir() or not manifest.is_file():
            raise ValueError(
                "candidate_path must contain plugin/ and candidate-commit.txt"
            )
        if manifest.read_text().strip() != candidate_commit:
            raise ValueError("candidate staging commit does not match candidate_commit")
        super().__init__(*args, **kwargs)

    async def setup(self, environment: BaseEnvironment) -> None:
        await super().setup(environment)
        await environment.upload_dir(
            source_dir=self._candidate_path,
            target_dir=self._REMOTE_CANDIDATE.as_posix(),
        )

        codex_home = self._REMOTE_CODEX_HOME.as_posix()
        marketplace = (self._REMOTE_CANDIDATE / "plugin").as_posix()
        agent_logs = EnvironmentPaths.agent_dir.as_posix()
        plugin_cache = f"{codex_home}/plugins/cache/openboa-ai/coffee-chat"
        quoted_home = shlex.quote(codex_home)
        quoted_marketplace = shlex.quote(marketplace)
        quoted_logs = shlex.quote(agent_logs)
        quoted_cache = shlex.quote(plugin_cache)
        quoted_commit = shlex.quote(self._candidate_commit)

        await self.exec_as_agent(
            environment,
            command=f"""
set -euo pipefail
if [ -s ~/.nvm/nvm.sh ]; then . ~/.nvm/nvm.sh; fi
mkdir -p {quoted_home} {quoted_logs}
export CODEX_HOME={quoted_home}

codex plugin marketplace add {quoted_marketplace} --json \
  > {quoted_logs}/plugin-marketplace.json
codex plugin list --available --json \
  > {quoted_logs}/plugin-available.json
codex plugin add {self._PLUGIN_ID} --json \
  > {quoted_logs}/plugin-install.json
codex plugin list --json \
  > {quoted_logs}/plugin-installed.json

installed_path="$(find {quoted_cache} -mindepth 1 -maxdepth 1 -type d -print -quit)"
test -n "$installed_path"
test -z "$(find {quoted_marketplace} -type l -print -quit)"
test -z "$(find "$installed_path" -type l -print -quit)"

digest_tree() {{
  root="$1"
  find "$root" -type f -printf '%P\n' |
    LC_ALL=C sort |
    while IFS= read -r relative; do
      printf '%s\n' "$relative"
      sha256sum "$root/$relative" | cut -d' ' -f1
    done |
    sha256sum |
    cut -d' ' -f1
}}

source_digest="$(digest_tree {quoted_marketplace})"
installed_digest="$(digest_tree "$installed_path")"
printf 'sha256:%s\n' "$source_digest" > {quoted_logs}/plugin-source-digest.txt
printf 'sha256:%s\n' "$installed_digest" > {quoted_logs}/plugin-installed-digest.txt
printf '%s\n' {quoted_commit} > {quoted_logs}/candidate-commit.txt
test "$source_digest" = "$installed_digest"
""",
        )
