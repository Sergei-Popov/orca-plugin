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
- Both the plugin and the hub working trees are clean; `gh auth status` is logged in.
- Pick the version (semver): breaking manifest/behaviour change → major, feature → minor, fix → patch.

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

The listing appears within about an hour at `https://orca.dev/plugins/Sergei-Popov/orca-<name>`.
An `icon` (square PNG ≥128×128, ≤256 KB), a `cover` (`images/cover.png`, 16:10, ≥800×500, ≤1 MB)
and up to 6 `screenshots` (≥1280×800, ≤1.5 MB, optional `theme: light|dark`) in the manifest make
the listing better. Take them with `orca plugin shot <key> --editor <file> --width 1440 --height 900`:
it captures only the plugin, never the user's sidebar or files. Use generated demo content (silent
clips for media), not the user's files. `--act`/`--theme` need Orca's window hidden — hide it with
`osascript -e 'tell application "System Events" to set visible of process "Orca" to false'` and show
it again afterwards. The player UI follows Orca's language: switch Settings → Appearance → Language
to English for the shots and back to System after. Keys that change saved preferences (speed,
repeat) persist between shots, and their badges fade only after ~0.7 s while acts run in
milliseconds — avoid them or reset them in a throwaway shot.
