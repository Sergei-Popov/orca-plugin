#!/usr/bin/env bash
# Creates a new plugin subproject end to end.
#
#   scripts/new-plugin.sh <name> [--template <t>] [--id <plugin-id>] [--title "<Display name>"]
#                                [--description "<text>"] [--no-github] [--no-orca]
#
#   <name>      kebab-case folder name: plugins/<name>, GitHub repo <owner>/orca-<name>
#   --template  orca plugin template (default: editor): theme | terminal-theme | icon-theme | syntax |
#               language-pack | editor | panel | components | worker-panel | hook
#   --id        plugin id in orca-plugin.json (default: <name>; ids starting "orca-" are reserved)
#
# Steps: scaffold with `orca plugin create` → own git repo with git-flow branches (main, develop) →
# public GitHub repo, locked to collaborators (scripts/github-protect.sh) → git submodule of the hub
# (merged into the hub's develop through feature/plugin-<name>) → `orca repo add`.
# Moving the new Orca project into the "orca-plugin" group is a UI step the script cannot do:
# follow .claude/skills/orca-project-group, then check with scripts/orca-group.sh status.
. "$(dirname "$0")/lib/common.sh"
require git node "$ORCA"

name="" template="editor" id="" title="" description="" github=1 orca=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --template) template="$2"; shift 2 ;;
    --id) id="$2"; shift 2 ;;
    --title) title="$2"; shift 2 ;;
    --description) description="$2"; shift 2 ;;
    --no-github) github=0; shift ;;
    --no-orca) orca=0; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [[ -z "$name" ]] || die "only one <name> expected"; name="$1"; shift ;;
  esac
done
[[ "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || die "usage: $0 <kebab-case-name> [options] (see --help)"
id="${id:-$name}"
[[ "$id" != orca-* ]] || die "plugin ids starting with 'orca-' are reserved by Orca; pass --id"
title="${title:-$(node -e 'process.stdout.write(process.argv[1].split("-").map(w=>w[0].toUpperCase()+w.slice(1)).join(" "))' "$name")}"
dir="$PLUGINS_DIR/$name"
[[ ! -e "$dir" ]] || die "$dir already exists"

hub_branch="$(git -C "$HUB_ROOT" branch --show-current)"
require_clean "$HUB_ROOT"
git -C "$HUB_ROOT" rev-parse --verify -q develop >/dev/null || die "the hub has no develop branch (git-flow); create it first"

owner=""
if [[ $github -eq 1 ]]; then
  require gh
  owner="$(github_owner)"
  repo="$owner/orca-$name"
  if gh api "repos/$repo" --silent 2>/dev/null; then die "GitHub repository $repo already exists"; fi
fi
author_name="$(gh api user -q '.name // .login' 2>/dev/null || git config user.name)"

log "Scaffolding $title ($id) from the '$template' template"
mkdir -p "$PLUGINS_DIR"
"$ORCA" plugin create "$dir" --template "$template" --id "$id" --name "$title" --json >/dev/null

log "Filling in the manifest, LICENSE and .gitignore"
node - "$dir" "$author_name" "$owner" "$name" "$description" <<'JS'
const fs = require('fs'), path = require('path')
const [dir, author, owner, name, description] = process.argv.slice(2)
const file = path.join(dir, 'orca-plugin.json')
const m = JSON.parse(fs.readFileSync(file, 'utf8'))
const ordered = {
  $schema: 'https://raw.githubusercontent.com/stablyai/orca/main/docs/schemas/plugins/orca-plugin.v2.schema.json',
  ...m,
}
if (description) ordered.description = description
ordered.author = owner ? { name: author, url: `https://github.com/${owner}` } : { name: author }
if (owner) ordered.repository = `https://github.com/${owner}/orca-${name}`
ordered.license = 'MIT'
fs.writeFileSync(file, JSON.stringify(ordered, null, 2) + '\n')
JS
sed "s/__YEAR__/$(date +%Y)/; s/__AUTHOR__/$author_name/" "$HUB_ROOT/templates/LICENSE.tmpl" > "$dir/LICENSE"
cp "$HUB_ROOT/templates/CHANGELOG.md.tmpl" "$dir/CHANGELOG.md"
printf 'node_modules/\n.orca/\n.DS_Store\n' > "$dir/.gitignore"
"$ORCA" plugin validate "$dir" --json >/dev/null || die "the scaffold does not validate: run $ORCA plugin validate $dir"

log "git-flow: main with the scaffold, develop from main"
git -C "$dir" init -q -b main
git -C "$dir" add -A
git -C "$dir" commit -q -m "chore: scaffold $title from the Orca '$template' template"
git -C "$dir" branch develop
git -C "$dir" switch -q develop

if [[ $github -eq 1 ]]; then
  log "Creating public GitHub repository $repo"
  gh repo create "$repo" --public --description "${description:-$title — a plugin for Orca}" --disable-wiki >/dev/null
  git -C "$dir" remote add origin "https://github.com/$repo.git"
  git -C "$dir" push -q -u origin main develop
  gh repo edit "$repo" --default-branch main >/dev/null
  "$HUB_ROOT/scripts/github-protect.sh" "$repo"
fi

log "Hub: feature/plugin-$name → develop"
git -C "$HUB_ROOT" switch -q develop
git -C "$HUB_ROOT" switch -q -c "feature/plugin-$name"
if [[ $github -eq 1 ]]; then
  git -C "$HUB_ROOT" submodule add -q -b develop "https://github.com/$repo.git" "plugins/$name"
  # Plugin development must not dirty the hub (gitflow skill): the hub pins release commits only.
  git -C "$HUB_ROOT" config -f .gitmodules "submodule.plugins/$name.ignore" all
  git -C "$HUB_ROOT" add .gitmodules
  git -C "$HUB_ROOT" commit -q -m "feat: add $name plugin ($repo) as a submodule"
  git -C "$HUB_ROOT" switch -q develop
  git -C "$HUB_ROOT" merge -q --no-ff "feature/plugin-$name" -m "Merge feature/plugin-$name into develop"
  git -C "$HUB_ROOT" branch -q -d "feature/plugin-$name"
  if git -C "$HUB_ROOT" remote get-url origin >/dev/null 2>&1; then git -C "$HUB_ROOT" push -q origin develop; fi
else
  warn "--no-github: the plugin is not a submodule yet; add it later with"
  warn "  git submodule add -b develop <url> plugins/$name   (on a hub feature branch)"
  git -C "$HUB_ROOT" switch -q develop
  git -C "$HUB_ROOT" branch -q -D "feature/plugin-$name"
fi
[[ "$hub_branch" == "develop" || -z "$hub_branch" ]] || git -C "$HUB_ROOT" switch -q "$hub_branch"

if [[ $orca -eq 1 ]]; then
  log "Adding the project to Orca"
  "$ORCA" repo add --path "$dir" --json >/dev/null
fi

repo_url=""
[[ $github -eq 1 ]] && repo_url=", https://github.com/$repo"
cat <<MSG

Done: $dir  (branch develop${repo_url})
Next:
  1. Move the Orca project "$(basename "$dir")" into the "$ORCA_GROUP_NAME" group:
     .claude/skills/orca-project-group/SKILL.md, then: scripts/orca-group.sh status
  2. Start work on a feature branch:  git -C plugins/$name switch -c feature/<topic> develop
  3. Develop:  $ORCA plugin dev watch plugins/$name --check
MSG
