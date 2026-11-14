---
name: orca-plugin-authoring
description: >-
  Build, debug, test and ship Orca plugins in this hub: manifest (orca-plugin.json), custom editors,
  panels, components, commands, workers, hooks, themes, syntaxes, the plugin host API and the
  `orca plugin` CLI. Use for any code change inside plugins/<name>, any question about what an Orca
  plugin can do, or when a folder has an orca-plugin.json. Loads Orca's own version-matched guide.
---

# Orca plugin authoring (hub wrapper)

Orca ships the authoritative guide for its plugin API with the app, matched to the installed
version. Load it before writing plugin code, and the references it points to before using an API:

```sh
orca skills get orca-plugin-authoring                       # the guide (≈130 lines)
orca skills get orca-plugin-authoring --references          # cli components events host-api manifest recipes testing workflow
orca skills get orca-plugin-authoring --reference references/manifest.md
```

Use `ORCA_CLI_COMMAND` instead of `orca` when it is set (Orca-managed WSL). If `skills get` is
unknown, Orca is too old: say so and read https://github.com/stablyai/orca/tree/main/docs/reference.

## Hub conventions on top of Orca's guide

- Work happens in `plugins/<name>` (its own git repository) on a `feature/*` branch from `develop`
  — see the `gitflow` skill. Never commit to `main`.
- New plugins come from `scripts/new-plugin.sh` (skill `orca-plugin-new`), releases from
  `scripts/release-plugin.sh` (skill `orca-plugin-release`).
- TypeScript without a build step: sources in `src/`, entries in the manifest point at `.ts` files,
  `tsconfig.json` extends `./.orca/types/tsconfig.json` (run `orca plugin types .` first).
- Pure logic goes in DOM-free modules with `*.test.ts` next to them (`orca/testing`'s `test` and
  `assert`); `orca plugin test .` runs them in Node.
- Before you say a change works: `orca plugin test . --json`, `npx -y -p typescript@5.9.3 tsc -p .`,
  `orca plugin check . --json`, `orca plugin validate . --json`, and look at a real render:
  `orca plugin shot local.<id> --editor <file>` or `--panel <id>`, then Read the PNG.
- `--act` shots need Orca's window hidden; when it is visible use `orca plugin open … --editor`
  and `orca computer` screenshots instead.
- **Never start playback with sound** while testing media (the user's household sleeps): load and
  look, do not press play on files with audio; test playback on silent files only.
- Plugin UI follows Orca's theme: style from `--orca-*` variables with `:root.dark` overrides,
  strings in English and Russian (`orca.locale`).
- Dev loads need approval: show the user what `orca plugin dev load . --json` lists in
  `error.data.grants` and pass `--approve <fingerprint>` only for the plugin and access they asked for.

## Orca facts that shaped existing plugins

- Custom editors receive at most 64 MiB and never the file path; Orca shows its own "too large"
  notice above that.
- Orca plays `.mp4 .m4v .mov .webm .mp3 .wav .m4a .aac .ogg .oga .flac .opus` itself, in a tab,
  without a size limit. Don't take those over with `priority: "default"`; use `"option"`.
- Files opened from an agent chat link open in a tab through the same path as the file tree.
- Ids starting `orca-` are reserved. The catalog id is `sergei-popov.<id>`.
