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

Build them with the hub's tool, never with screenshots of Orca's window:

```sh
scripts/listing-image.sh <name> --dry-run --check --sheet   # PNGs to .orca/listing/out/, sheet.png
scripts/listing-image.sh <name> --check --write-manifest    # images/*.png + orca-plugin.json
```

House style, the `tools/listing.json` schema, the acts and the checks are in
`scripts/lib/listing/README.md`.

**What the tool does**
- It renders the plugin's real editor on a local stage in headless Google Chrome, with audio muted.
- The stage reproduces Orca 1.4.258's guest frame: its default tokens, its CSP and `window.orca`.
- It composes the house style:
  - a 1600×1000 dark cover with the title, tagline and chips;
  - 4–5 slides of 1600×1000 with a headline;
  - at most one light slide, and it comes last.
- It checks sizes, alpha, bytes (≤ 400 KB each, ≤ 1.6 MB in total), alts, headlines, icons, stage
  errors, and access to unknown `orca.*` members or events. Nothing on the stage reaches past
  127.0.0.1: other origins, navigation and popups fail the build.
- A failed image never replaces the one in `images/`, and `--write-manifest` writes only when every
  listed image exists and is valid.

**Workflow**
1. Make the demo files in the plugin's `.orca/listing/samples/`, with the generator in its
   `tools/` or from its committed test files. Never use the user's files. Use only fictional
   names, silent media and OFL fonts.
2. Write the spec, then run the `--dry-run` command above.
3. Open every PNG in `.orca/listing/out/` and `sheet.png` with the Read tool. Fix the acts and
   `origin`. Copy the values the capture shows into the alts. Repeat until `check: passed`.
4. Run the `--check --write-manifest` command above. The manifest gets `{path, alt}` only, with no
   `caption` or `theme`. Then run `orca plugin validate . --json`.
5. Delete the obsolete images the run lists, unless the README uses them.

**Rules**
- Alts must be 1–140 characters; aim for 125 or fewer. `orca plugin validate` refuses anything
  over 160.
- `orca plugin shot` remains only for `scripts/listing-image.sh <name> --parity <file>`. That
  compares the stage with Orca's own render once per plugin. It opens a tab in Orca, so it needs
  the user's OK every time.
- Do not hide Orca's window or change Orca's language for listing images.
