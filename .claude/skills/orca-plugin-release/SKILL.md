---
name: orca-plugin-release
description: >-
  Release a version of a plugin from this hub with git-flow and list it in the hub's Orca catalog
  (orca-catalog.json); optionally publish it to the public orca.dev directory. Use when the user
  asks to release, ship, publish, tag or version a plugin, or to update the catalog.
---

# Releasing a plugin

## Before

- The plugin's `develop` holds everything for the release (features merged `--no-ff`).
- `CHANGELOG.md` has the changes under `## [Unreleased]`.
- The manifest's icon, cover and screenshots show the current UI (see "Listing images" below):
  the release copies them into the catalog, and orca.dev shows them.
- Both the plugin and the hub working trees are clean; `gh auth status` is logged in.
- Pick the version (semver): breaking manifest/behaviour change → major, feature → minor, fix → patch.
- **For anything that goes to orca.dev:** `scripts/directory-check.sh <name> --update` passes on the
  plugin's `develop`. It runs the directory's own validator (Orca main, on the PC) and a self-scan for
  what the private indexer rejects or holds: binary files, base64 binary blobs (tests included),
  escape runs, `.wasm`, size, brand-led names, pricing words. See CLAUDE.md "Что задерживает плагин в
  orca.dev". An update that adds file types, capabilities, commands, panels or events, or changes the
  licence, is held as "update": batch such changes.

## Release

```sh
scripts/release-plugin.sh <name> <x.y.z> [--categories media,viewers] [--no-push]
```

What it does:

1. Plugin repo: `release/<x.y.z>` from `develop`; bumps `orca-plugin.json`; dates the changelog;
   runs `orca plugin validate`, `orca plugin test`, `tsc`, `orca plugin check`; merges into `main`
   with tag `v<x.y.z>`, back into `develop`; pushes `main`, `develop` and the tag.
2. Hub: `release/<name>-<x.y.z>` from `develop`; pins `plugins/<name>` to the tagged commit;
   adds the `orca plugin release-entry` output (commit + content hash) with the changelog to
   `orca-catalog.json`; copies the release's icon, cover and screenshots from the tagged commit to
   `assets/<catalog-id>/` (catalog images must live in the catalog repository; only the newest
   release keeps `images`); validates the catalog; merges into `main` (tag `<name>/v<x.y.z>`) and back
   into `develop`; pushes.

If a check fails the script stops on the `release/<x.y.z>` branch: fix there (commit), then finish
by hand with the commands in the `gitflow` skill, or delete the branch and start over.

After it: in Orca, Settings → Plugins → catalog `orca-plugin` shows the new version once Orca
refreshes the catalog (main branch of the hub).

## Publish to the orca.dev directory (only when the user asks)

The community directory lists a repository that has the `orca-plugin` topic and a `vX.Y.Z` tag,
passes the validator and has a license. It is public and permanent (each version is locked by
commit and hash), so ask first. Then:

```sh
gh repo edit Sergei-Popov/orca-<name> --add-topic orca-plugin
```

The listing appears within about an hour at `https://orca.dev/plugins/Sergei-Popov/orca-<name>`
(the indexer runs every 30 minutes; until then the page says "Waiting for the indexer"). A version
can be held "Under review" first; the status is in `status.json` of
`stablyai/orca-community-plugins`:

```sh
gh api repos/stablyai/orca-community-plugins/contents/status.json -H "Accept: application/vnd.github.raw" \
  | jq '.repos["sergei-popov/orca-<name>"]'
```

Check 30–60 minutes after adding the topic. `listed` is done. If it is `rejected` with a fixable reason
(validation, binary-files, licence…), fix it and release a patch. If it is `under-review`, don't re-tag the
same content: that only replaces the pending review. Holds after 2026-11-07 that were approved at all were
approved within about a day. Past that, release a patch that removes the likely trigger (see CLAUDE.md).

## Listing images

An `icon` (square PNG ≥128×128, ≤256 KB), a `cover` (`images/cover.png`, 16:10, take it at
1600×1000, ≤1 MB) and up to 6 `screenshots` (1440×900, ≤1.5 MB, `theme: light|dark`, a `caption`)
in the manifest make the listing better. Every `alt` is at most 160 characters (`orca plugin
validate` enforces it). Use generated demo content (silent clips for media, OFL fonts), never the
user's files.

Take them with `orca plugin shot <key> --editor <file> --width 1440 --height 900 --out <png>`: it
captures only the plugin, never the user's sidebar or files. The UI follows Orca's language. Check
that a shot is in English. If it is not, ask the user to switch Settings → Appearance → Language
rather than changing it yourself.

- **Without `--act` and `--theme`** a shot works with the window on screen, in Orca's current
  theme. Take those (e.g. the cover in the dark theme) first.
- **`--act` and `--theme` need Orca's window hidden or minimized.** A full-screen window counts as
  on screen, and `set visible of process "Orca" to false` does nothing to it. Use
  `scripts/orca-window.sh hide` (leaves full screen, minimizes, remembers it) and
  `scripts/orca-window.sh show` (un-minimizes, back to full screen) — always `show` afterwards,
  also when a shot fails.
- The chat with the user usually runs inside Orca, so hiding the window hides the chat. Say so in
  the chat, prepare every act first, hide once for a short batch (under a minute), then show. If
  `--act` suddenly fails with "needs Orca's window hidden", the user has opened the window: don't
  hide it again without saying so.
- In zsh `${x:+--act "$x"}` stays one word and the CLI rejects it as an unknown flag. Build the
  arguments in a bash array.
- Editor acts are clicks and keys in the editor's CSS pixels, each waiting one paint. After an act
  that loads something asynchronously (opening a nested file), add a few clicks on an inert spot as
  waits. A click on an empty part of a details pane also drops a list's focus ring before the
  capture.
- Keys that change saved preferences (speed, repeat) persist between shots, and their badges fade
  only after ~0.7 s while acts run in milliseconds — avoid them or reset them in a throwaway shot.
