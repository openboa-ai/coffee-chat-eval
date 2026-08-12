#!/usr/bin/env bash
set -euo pipefail

GITLEAKS_VERSION=8.30.1
GITLEAKS_SHA256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
GITLEAKS_CONFIG_SHA256=e163e53b9e7e8a8511e77271e2b323ed057759542a6d988258afe3a1fa329caf
archive="gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
install_dir="${RUNNER_TEMP:?}/gitleaks-${GITLEAKS_VERSION}"
archive_path="${RUNNER_TEMP:?}/${archive}"
config_path="${install_dir}/gitleaks.toml"

mkdir -p "$install_dir"
curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/${archive}" \
  --output "$archive_path"
printf '%s  %s\n' "$GITLEAKS_SHA256" "$archive_path" | sha256sum --check
tar -xzf "$archive_path" -C "$install_dir" gitleaks
chmod 0755 "$install_dir/gitleaks"
curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  "https://raw.githubusercontent.com/gitleaks/gitleaks/v${GITLEAKS_VERSION}/config/gitleaks.toml" \
  --output "$config_path"
printf '%s  %s\n' "$GITLEAKS_CONFIG_SHA256" "$config_path" | sha256sum --check
printf '%s\n' "$install_dir" >> "${GITHUB_PATH:?}"
printf 'GITLEAKS_TRUSTED_CONFIG=%s\n' "$config_path" >> "${GITHUB_ENV:?}"
