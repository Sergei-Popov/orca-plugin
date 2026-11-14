#!/usr/bin/env bash
# Releases a plugin with git-flow and lists the release in the hub's catalog.
#
#   scripts/release-plugin.sh <name> <x.y.z> [--categories a,b] [--no-push]
#
# In plugins/<name> (its own repository):
#   develop → release/<x.y.z>: bump orca-plugin.json, date CHANGELOG.md's [Unreleased] section,
#   run validate / test / tsc / check → merge into main (tag v<x.y.z>) and back into develop.
# In the hub:
#   develop → release/<name>-<x.y.z>: pin the submodule to the tagged commit and add the release
#   (`orca plugin release-entry`) to orca-catalog.json → merge into main (tag <name>/v<x.y.z>)
#   and back into develop.
# Both repositories are pushed unless --no-push. Nothing is published to the orca.dev directory:
# that needs the `orca-plugin` topic on the plugin repository (see the orca-plugin-release skill).
. "$(dirname "$0")/lib/common.sh"
require git node "$ORCA"

name="" version="" categories="" push=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --categories) categories="$2"; shift 2 ;;
    --no-push) push=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) if [[ -z "$name" ]]; then name="$1"; elif [[ -z "$version" ]]; then version="$1"; else die "unexpected $1"; fi; shift ;;
  esac
done
[[ -n "$name" && -n "$version" ]] || die "usage: $0 <name> <x.y.z> [--categories a,b] [--no-push]"
require_semver "$version"
dir="$PLUGINS_DIR/$name"
[[ -f "$dir/orca-plugin.json" ]] || die "$dir is not a plugin folder"
tag="v$version"

require_clean "$dir"
require_clean "$HUB_ROOT"
has_remote() { git -C "$1" remote get-url origin >/dev/null 2>&1; }
git -C "$dir" rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "$name already has tag $tag"

# ---- plugin repository -----------------------------------------------------------------------
log "$name: release/$version from develop"
git -C "$dir" switch -q develop
if has_remote "$dir"; then
  git -C "$dir" fetch -q origin
  git -C "$dir" merge -q --ff-only origin/develop
  git -C "$dir" rev-parse -q --verify origin/main >/dev/null && git -C "$dir" branch -q -f main origin/main 2>/dev/null || true
fi
git -C "$dir" switch -q -c "release/$version"

node - "$dir" "$version" <<'JS'
const fs = require('fs'), path = require('path')
const [dir, version] = process.argv.slice(2)
const file = path.join(dir, 'orca-plugin.json')
const text = fs.readFileSync(file, 'utf8')
fs.writeFileSync(file, text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`))
const changelog = path.join(dir, 'CHANGELOG.md')
if (fs.existsSync(changelog)) {
  const today = new Date().toISOString().slice(0, 10)
  const body = fs.readFileSync(changelog, 'utf8')
  if (!body.includes('## [Unreleased]')) {
    console.error('CHANGELOG.md has no "## [Unreleased]" section')
    process.exit(1)
  }
  fs.writeFileSync(changelog, body.replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${today}`))
}
JS

log "$name: checks"
"$ORCA" plugin validate "$dir" --json >/dev/null || die "orca plugin validate failed: run it in $dir"
if compgen -G "$dir/src/*.test.*" >/dev/null || compgen -G "$dir/**/*.test.*" >/dev/null; then
  "$ORCA" plugin test "$dir" --json >/dev/null || die "orca plugin test failed"
fi
if [[ -f "$dir/tsconfig.json" ]]; then
  "$ORCA" plugin types "$dir" --json >/dev/null
  (cd "$dir" && npx -y -p typescript@5.9.3 tsc -p .) || die "type check failed"
fi
"$ORCA" plugin check "$dir" --json >/dev/null || die "orca plugin check failed"

git -C "$dir" add -A
git -C "$dir" commit -q -m "chore(release): $tag"
git -C "$dir" switch -q main
git -C "$dir" merge -q --no-ff "release/$version" -m "Release $tag"
git -C "$dir" tag -a "$tag" -m "$tag"
release_sha="$(git -C "$dir" rev-parse HEAD)"
entry_json="$("$ORCA" plugin release-entry "$dir" --json)"
git -C "$dir" switch -q develop
git -C "$dir" merge -q --no-ff "release/$version" -m "Merge release/$version into develop"
git -C "$dir" branch -q -d "release/$version"
if [[ $push -eq 1 ]] && has_remote "$dir"; then
  log "$name: pushing main, develop and $tag"
  git -C "$dir" push -q origin main develop "$tag"
fi

# ---- hub ---------------------------------------------------------------------------------------
owner="$(git -C "$dir" remote get-url origin 2>/dev/null | sed -E 's#.*github.com[:/]([^/]+)/.*#\1#' || true)"
[[ -n "$owner" ]] || owner="$(github_owner)"
plugin_id="$(manifest_field "$dir" id)"
catalog_id="$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]').$plugin_id"
source_url="$(git -C "$dir" remote get-url origin 2>/dev/null || echo "https://github.com/$owner/orca-$name.git")"
hub_branch="$(git -C "$HUB_ROOT" branch --show-current)"

log "hub: release/$name-$version from develop"
git -C "$HUB_ROOT" switch -q develop
if has_remote "$HUB_ROOT"; then
  git -C "$HUB_ROOT" fetch -q origin
  git -C "$HUB_ROOT" merge -q --ff-only origin/develop
fi
git -C "$HUB_ROOT" switch -q -c "release/$name-$version"
git -C "$HUB_ROOT" update-index --cacheinfo "160000,$release_sha,plugins/$name"

request="$(mktemp)"
trap 'rm -f "$request"' EXIT
ENTRY_JSON="$entry_json" node "$HUB_ROOT/scripts/lib/release-request.mjs" \
  "$request" "$catalog_id" "$source_url" "$dir" "$version" "$categories"
node "$HUB_ROOT/scripts/lib/catalog.mjs" "$HUB_ROOT/orca-catalog.json" "$request"
"$ORCA" plugin validate "$HUB_ROOT/orca-catalog.json" --json >/dev/null || die "the catalog does not validate: $ORCA plugin validate orca-catalog.json"

git -C "$HUB_ROOT" add -- orca-catalog.json
if [[ -d "$HUB_ROOT/assets" || -n "$(git -C "$HUB_ROOT" ls-files -- assets)" ]]; then
  git -C "$HUB_ROOT" add -A -- assets
fi
git -C "$HUB_ROOT" commit -q -m "chore(catalog): $catalog_id $tag"
git -C "$HUB_ROOT" switch -q main
git -C "$HUB_ROOT" merge -q --no-ff "release/$name-$version" -m "Release $name $tag"
git -C "$HUB_ROOT" tag -a "$name/$tag" -m "$name $tag"
git -C "$HUB_ROOT" switch -q develop
git -C "$HUB_ROOT" merge -q --no-ff "release/$name-$version" -m "Merge release/$name-$version into develop"
git -C "$HUB_ROOT" branch -q -d "release/$name-$version"
if [[ $push -eq 1 ]] && has_remote "$HUB_ROOT"; then
  log "hub: pushing main, develop and $name/$tag"
  git -C "$HUB_ROOT" push -q origin main develop "$name/$tag"
fi
[[ -z "$hub_branch" || "$hub_branch" == "develop" ]] || git -C "$HUB_ROOT" switch -q "$hub_branch"

cat <<MSG

Released $catalog_id $tag (commit $release_sha).
  Plugin:  tag $tag on main; develop holds the merge-back.
  Catalog: orca-catalog.json on the hub's main lists it; Orca users with the hub as a catalog source
           see the update.
MSG
