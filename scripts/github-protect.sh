#!/usr/bin/env bash
# Locks a public repository down to its owner and protects the git-flow branches.
#
#   scripts/github-protect.sh <owner/repo>
#
# - Pull requests can be opened by collaborators only (outsiders can still read, fork and clone).
# - No wiki or projects; merged branches are deleted.
# - Ruleset "gitflow": `main` and `develop` cannot be deleted or force-pushed.
# Idempotent: re-running updates the settings and the ruleset in place.
. "$(dirname "$0")/lib/common.sh"
require gh node

repo="${1:-}"
[[ "$repo" == */* ]] || die "usage: $0 <owner/repo>"

log "Repository settings for $repo"
gh api -X PATCH "repos/$repo" \
  -F has_wiki=false -F has_projects=false -F has_discussions=false \
  -F delete_branch_on_merge=true -F allow_merge_commit=true -F allow_squash_merge=true \
  -F allow_rebase_merge=false --silent

# Pull requests from collaborators only (GitHub setting since 2026-02).
if gh api -X PATCH "repos/$repo" -f pull_request_creation_policy=collaborators_only --silent 2>/dev/null; then
  policy="$(gh api "repos/$repo" -q .pull_request_creation_policy)"
  log "Pull request creation policy: $policy"
else
  warn "could not set 'Pull requests: Collaborators only' through the API;"
  warn "set it by hand: https://github.com/$repo/settings → Pull requests → Collaborators only"
fi

ruleset='{
  "name": "gitflow",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": { "ref_name": { "include": ["refs/heads/main", "refs/heads/develop"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ]
}'
existing="$(gh api "repos/$repo/rulesets" -q '.[] | select(.name=="gitflow") | .id' 2>/dev/null || true)"
if [[ -n "$existing" ]]; then
  printf '%s' "$ruleset" | gh api -X PUT "repos/$repo/rulesets/$existing" --input - --silent
  log "Ruleset 'gitflow' updated"
else
  printf '%s' "$ruleset" | gh api -X POST "repos/$repo/rulesets" --input - --silent
  log "Ruleset 'gitflow' created"
fi
