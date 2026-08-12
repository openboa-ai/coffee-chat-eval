#!/usr/bin/env bash
set -euo pipefail

GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
archive="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
install_dir="${RUNNER_TEMP:?}/gitleaks-${GITLEAKS_VERSION}"
archive_path="${RUNNER_TEMP:?}/${archive}"

mkdir -p "$install_dir"
curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${archive}" \
  --output "$archive_path"
printf '%s  %s\n' "$GITLEAKS_SHA256" "$archive_path" | sha256sum --check
tar -xzf "$archive_path" -C "$install_dir" gitleaks
chmod 0755 "$install_dir/gitleaks"
printf '%s\n' "$install_dir" >> "${GITHUB_PATH:?}"
