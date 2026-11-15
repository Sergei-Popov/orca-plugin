#!/usr/bin/env bash
# Mandatory gate before a release that goes to the orca.dev directory: will the directory list it?
#
#   scripts/directory-check.sh <name|dir> [--update] [--ref <ref>] [--no-validator]
#
# 1. The directory's own validator (stablyai/orca `pnpm validate:plugin`, set up on the home PC in
#    ~/orca-directory-validator) on the committed tree, through `ssh pc`. --update first pulls Orca's
#    latest main into it (the directory follows main; do it before every release).
# 2. scripts/lib/directory_scan.py: the rules the private indexer applies and the validator does not
#    (binary files, base64 blobs and escape runs held for "code", .wasm held for "content", size,
#    brand-led names, pricing words). See the docstring there for the evidence.
# Only committed content counts, exactly as a vX.Y.Z tag would ship it. Exit 0 = both passed.
. "$(dirname "$0")/lib/common.sh"
require git python3

target="" ref="HEAD" update=0 validator=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update) update=1; shift ;;
    --ref) ref="$2"; shift 2 ;;
    --no-validator) validator=0; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) target="$1"; shift ;;
  esac
done
[[ -n "$target" ]] || die "usage: $0 <name|dir> [--update] [--ref <ref>] [--no-validator]"
if [[ -d "$target" ]]; then dir="$(cd "$target" && pwd)"; else dir="$PLUGINS_DIR/$target"; fi
[[ -f "$dir/orca-plugin.json" ]] || die "$dir has no orca-plugin.json"

if [[ -n "$(git -C "$dir" status --porcelain)" ]]; then
  warn "$dir has uncommitted changes: they are NOT checked (only $ref is)"
fi

status=0
if [[ $validator -eq 1 ]]; then
  if [[ $update -eq 1 ]]; then
    log "Updating the directory validator on the PC to Orca's latest main"
    ssh pc '~/orca-directory-validator/bin/update' || die "validator update failed"
  fi
  log "Directory validator (stablyai/orca validate:plugin) on $(git -C "$dir" rev-parse --short "$ref")"
  prefix="$(git -C "$dir" rev-parse --show-prefix)"
  origin="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
  if [[ "$ref" == "HEAD" ]]; then
    # A bundle carries the real commit, so the printed release entry matches what a tag would pin.
    git -C "$dir" bundle create -q "$tmp/plugin" HEAD || die "cannot bundle $dir (shallow clone?)"
  else
    # Another ref (a tag): the helper accepts a tar and makes a stand-in commit; contentHash is still exact.
    git -C "$dir" archive "$ref" > "$tmp/plugin" || die "cannot archive $ref of $dir"
    prefix=""
  fi
  ssh pc "~/orca-directory-validator/bin/validate-bundle '$prefix' '$origin'" < "$tmp/plugin" || status=1
fi

log "Directory self-scan (holds and rejections the validator does not catch)"
python3 "$HUB_ROOT/scripts/lib/directory_scan.py" "$dir" --ref "$ref" || status=1

if [[ $status -eq 0 ]]; then log "directory-check: PASSED"; else printf '\033[1;31mdirectory-check: FAILED\033[0m\n' >&2; fi
exit $status
