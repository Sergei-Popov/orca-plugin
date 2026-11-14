#!/usr/bin/env bash
# Checks that Orca projects belong to the hub's sidebar group ("orca-plugin").
#
#   scripts/orca-group.sh status [<path>...]   # default: the hub and every plugins/* folder
#   scripts/orca-group.sh id                   # prints the group's id
#
# Exit code: 0 all in the group, 1 some project is outside it or not added to Orca, 2 setup error.
#
# Orca's CLI cannot create groups or move projects between them (only the desktop UI can), so this
# script only reads. To fix a project outside the group follow .claude/skills/orca-project-group.
. "$(dirname "$0")/lib/common.sh"
require node sqlite3

orca_support_dir() {
  case "$(uname -s)" in
    Darwin) printf '%s' "$HOME/Library/Application Support/orca" ;;
    *) printf '%s' "${XDG_CONFIG_HOME:-$HOME/.config}/orca" ;;
  esac
}

# Prints the id of the group named $ORCA_GROUP_NAME, read from the active profile's state store.
group_id() {
  local support profile db
  support="$(orca_support_dir)"
  profile="$(node -e 'try{process.stdout.write(require(process.argv[1]).activeProfileId||"")}catch{}' "$support/orca-profile-index.json")"
  db="$support/profiles/${profile:-local-default}/profile-state.db"
  [[ -f "$db" ]] || { warn "Orca profile store not found at $db"; return 2; }
  sqlite3 -readonly "$db" "select payload from profile_state_documents where domain='projectGroups'" |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const g=(JSON.parse(s||"[]")).find(g=>g.name===process.argv[1]);if(g)process.stdout.write(g.id);else process.exit(3)})' "$ORCA_GROUP_NAME"
}

repo_group() {
  "$ORCA" repo show --repo "path:$1" --json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const r=JSON.parse(s);if(!r.ok)process.exit(4);const repo=r.result.repo||r.result;process.stdout.write(repo.projectGroupId||"")}catch{process.exit(4)}})'
}

cmd="${1:-status}"
shift || true

case "$cmd" in
  id)
    group_id || die "no Orca group named '$ORCA_GROUP_NAME' (create it in Orca: project ⋯ → New group from project)"
    echo
    ;;
  status)
    gid="$(group_id)" || { warn "no Orca group named '$ORCA_GROUP_NAME' yet"; gid=""; }
    paths=("$@")
    if [[ ${#paths[@]} -eq 0 ]]; then
      paths=("$HUB_ROOT")
      for dir in "$PLUGINS_DIR"/*/; do
        [[ -f "$dir/orca-plugin.json" ]] && paths+=("${dir%/}")
      done
    fi
    status=0
    for path in "${paths[@]}"; do
      abs="$(cd "$path" && pwd)"
      if ! current="$(repo_group "$abs")"; then
        printf '✗ %s — not added to Orca (run: %s repo add --path %q)\n' "$abs" "$ORCA" "$abs"
        status=1
      elif [[ -n "$gid" && "$current" == "$gid" ]]; then
        printf '✓ %s — in group %s\n' "$abs" "$ORCA_GROUP_NAME"
      else
        printf '✗ %s — outside group %s (move it: .claude/skills/orca-project-group)\n' "$abs" "$ORCA_GROUP_NAME"
        status=1
      fi
    done
    exit "$status"
    ;;
  *)
    die "unknown command '$cmd' (use: status | id)"
    ;;
esac
