#!/usr/bin/env bash
# Builds a plugin's listing images (cover + screenshots, 1600x1000 PNG) in the hub's house style
# from the real editor UI, rendered by a local stage in headless Google Chrome (never Orca's window).
#
#   scripts/listing-image.sh <name|dir> [--only cover|N] [--check] [--sheet] [--write-manifest]
#                            [--plain] [--palette] [--spec <listing.json>] [--out-dir <dir>] [--dry-run]
#   scripts/listing-image.sh <name|dir> --parity <file>      # needs your OK: opens a tab in Orca
#   scripts/listing-image.sh shared-samples                 # stub: prints what it would build
#
#   --spec <file>       listing spec (default <plugin>/tools/listing.json)
#   --out-dir <dir>     generated files: raw/, out/, sheet.png, report.json (default <plugin>/.orca/listing)
#   --dry-run           final PNGs go to <out-dir>/out/ instead of images/; the manifest is never written
#   --only cover|N      build only the cover or screenshot N (1-based)
#   --check             validate images, icons, texts, budget and stage logs after the build
#   --sheet             write <out-dir>/sheet.png: card sizes, safe zones, icons, slides, family row
#   --write-manifest    rewrite orca-plugin.json cover/screenshots as {path, alt} in spec order, only
#                       if the build (and --check) passed and every listed image exists and is valid
#   --plain             screenshots as bare stage captures (no headline or backdrop)
#   --palette           palette PNG (only after looking at the glow crop on the sheet)
#   --parity <file>     `orca plugin shot` of <file> next to the stage render at scale 1 (asks first)
#
# macOS only (Google Chrome in /Applications; fonts differ elsewhere). Runs `npm ci` in
# scripts/lib/listing on first use. An image whose build failed never replaces the one in images/
# (it goes to <out-dir>/out/). Exit 0: every image built and, with --check, passed.
# House style, spec schema and acts: scripts/lib/listing/README.md.
. "$(dirname "$0")/lib/common.sh"

LISTING="$HUB_ROOT/scripts/lib/listing"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

shared_samples() {
  # TODO(shared-samples): build these for real once Class File Viewer has tools/make-listing-jar/
  # and Image Viewer's feature/image-viewer is merged. Building the jar needs the PC (no JDK on the Mac).
  local dest="$HUB_ROOT/.orca/listing/shared"
  cat <<EOF
shared-samples is a stub: nothing is built yet. It would put into $dest (git-ignored):

1. observatory-2.0.0.jar: the demo.observatory jar (about 80 classes, records, enums, sealed
   interfaces, generics, lambdas, inner and anonymous classes, module-info; Main-Class
   demo.observatory.Main, Multi-Release: true, util/Units at --release 8 with a --release 17
   version, the rest at --release 21), from plugins/class-viewer/tools/make-listing-jar/:

     rsync -a --delete "$PLUGINS_DIR/class-viewer/tools/make-listing-jar/" pc:~/tmp/observatory/
     ssh pc 'docker run --rm -v ~/tmp/observatory:/w -w /w eclipse-temurin:21-jdk sh build.sh'
     mkdir -p "$dest" && scp pc:~/tmp/observatory/observatory-2.0.0.jar "$dest/"

2. sunset.png: Image Viewer's CC0 demo render, from plugins/image-viewer/tools/demo (its
   generator writes .samples/demo/); copy it to $dest/sunset.png.

Archive Viewer's tools/make-listing-samples.py and Class File Viewer's listing spec read both.
EOF
}

target="" only="" spec="" outdir="" parity=""
flags=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --only) only="${2:-}"; shift 2 ;;
    --spec) spec="${2:-}"; shift 2 ;;
    --out-dir) outdir="${2:-}"; shift 2 ;;
    --parity) parity="${2:-}"; shift 2 ;;
    --check|--sheet|--write-manifest|--plain|--palette|--dry-run) flags+=("$1"); shift ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    -*) die "unknown option $1" ;;
    *) [[ -z "$target" ]] || die "one plugin at a time ($target, $1)"; target="$1"; shift ;;
  esac
done
[[ -n "$target" ]] || die "usage: $0 <name|dir> [--only cover|N] [--check] [--sheet] [--write-manifest] [--plain] [--spec <file>] [--out-dir <dir>] [--dry-run] | shared-samples"

if [[ "$target" == "shared-samples" ]]; then shared_samples; exit 0; fi

[[ "$(uname -s)" == "Darwin" ]] || die "macOS only: the images are rendered with the Mac's Google Chrome and fonts"
[[ -x "$CHROME" ]] || die "Google Chrome not found at $CHROME"
require node npm

if [[ -d "$target" ]]; then dir="$(cd "$target" && pwd)"; else dir="$PLUGINS_DIR/$target"; fi
[[ -f "$dir/orca-plugin.json" ]] || die "$dir has no orca-plugin.json"
[[ -z "$only" || "$only" == "cover" || "$only" =~ ^[1-9]$ ]] || die "--only takes cover or a screenshot number"

# Dependencies (exact pins, package-lock.json) on first use or when the lock file changed.
if [[ ! -f "$LISTING/node_modules/.package-lock.json" || "$LISTING/package-lock.json" -nt "$LISTING/node_modules/.package-lock.json" ]]; then
  log "Installing the listing tool's dependencies (npm ci in scripts/lib/listing)"
  (cd "$LISTING" && npm ci --no-audit --no-fund --loglevel=error) || die "npm ci failed in $LISTING"
fi

node_args=(--plugin "$dir")
[[ -n "$spec" ]] && node_args+=(--spec "$(cd "$(dirname "$spec")" && pwd)/$(basename "$spec")")
[[ -n "$outdir" ]] && { mkdir -p "$outdir"; node_args+=(--work "$(cd "$outdir" && pwd)"); }
[[ -n "$only" ]] && node_args+=(--only "$only")
node_args+=("${flags[@]+"${flags[@]}"}")

if [[ -n "$parity" ]]; then
  # `orca plugin shot` opens the file in a tab in Orca and may switch workspaces, so it needs the
  # user's OK every time. No --theme and no --act, so Orca's window can stay where it is.
  # One absolute path for both tools: `orca plugin shot` resolves a relative path against the cwd,
  # the stage against the plugin folder. Plugin-relative first, then cwd-relative.
  if [[ "$parity" == /* ]]; then parity_file="$parity"
  elif [[ -f "$dir/$parity" ]]; then parity_file="$dir/$parity"
  else parity_file="$PWD/$parity"; fi
  [[ -f "$parity_file" ]] || die "--parity: $parity not found (neither in $dir nor in $PWD)"
  parity_file="$(cd "$(dirname "$parity_file")" && pwd)/$(basename "$parity_file")"
  work="${outdir:-$dir/.orca/listing}"; mkdir -p "$work"; work="$(cd "$work" && pwd)"
  if [[ "${LISTING_PARITY_OK:-}" != "1" ]]; then
    [[ -t 0 ]] || die "--parity opens a tab in Orca: run it in a terminal and confirm, or set LISTING_PARITY_OK=1 after the user agreed"
    read -r -p "This opens $parity_file in a tab in Orca (orca plugin shot). Continue? [y/N] " answer
    [[ "$answer" == [yY]* ]] || die "parity cancelled"
  fi
  log "orca plugin shot $parity_file (960x536, Orca's current theme)"
  shot_args=(plugin shot "$dir" --editor "$parity_file" --width 960 --height 536 --out "$work/parity-orca.png" --json)
  "$ORCA" "${shot_args[@]}" || die "orca plugin shot failed"
  exec node "$LISTING/compose.mjs" --plugin "$dir" --work "$work" --parity "$parity_file" --parity-orca "$work/parity-orca.png"
fi

log "Listing images of $(basename "$dir")"
exec node "$LISTING/compose.mjs" "${node_args[@]}"
