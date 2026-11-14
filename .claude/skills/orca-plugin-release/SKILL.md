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
   `orca-catalog.json`; validates the catalog; merges into `main` (tag `<name>/v<x.y.z>`) and back
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
A cover (`images/cover.png`, 16:10, ≥800×500, ≤1 MB) and screenshots (≥1280×800) in the manifest
make the listing better; take them with `orca plugin shot`.
