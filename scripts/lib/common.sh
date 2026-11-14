#!/usr/bin/env bash
# Shared helpers for the hub scripts. Source it: `. "$(dirname "$0")/lib/common.sh"`.
set -euo pipefail

HUB_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLUGINS_DIR="$HUB_ROOT/plugins"
# The Orca sidebar group every project of this hub belongs to.
ORCA_GROUP_NAME="${ORCA_GROUP_NAME:-orca-plugin}"
# Orca's executable: ORCA_CLI_COMMAND inside Orca-managed WSL sessions, `orca` otherwise.
ORCA="${ORCA_CLI_COMMAND:-orca}"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

require() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is required but not installed"
  done
}

# The GitHub login that owns new repositories (override with GITHUB_OWNER).
github_owner() {
  if [[ -n "${GITHUB_OWNER:-}" ]]; then
    printf '%s' "$GITHUB_OWNER"
  else
    gh api user -q .login
  fi
}

# Fails unless the working tree of $1 is clean.
require_clean() {
  local dir="$1"
  [[ -z "$(git -C "$dir" status --porcelain)" ]] || die "$dir has uncommitted changes; commit or stash them first"
}

# Reads a top-level string field from a plugin manifest: manifest_field <dir> <field>.
manifest_field() {
  node -e 'const m=require(require("path").resolve(process.argv[1],"orca-plugin.json"));const v=m[process.argv[2]];if(v===undefined)process.exit(1);process.stdout.write(String(v))' "$1" "$2"
}

# Validates a semantic version (x.y.z, optional -prerelease).
require_semver() {
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || die "'$1' is not a semantic version (x.y.z)"
}
