---
name: gitflow
description: >-
  Git-flow branching used by every repository of this hub (the hub and each plugins/<name>):
  main/develop, feature, release and hotfix branches, merges and tags. Use before any commit,
  branch, merge, release or hotfix in these repositories, or when the user mentions gitflow.
---

# Git-flow in this hub

Every repository — the hub and each plugin under `plugins/<name>` (a separate repository,
mounted as a submodule) — follows git-flow with plain git (no `git flow` extension needed).

| Branch           | From      | Merges into            | Notes                                        |
| ---------------- | --------- | ---------------------- | -------------------------------------------- |
| `main`           | —         | —                      | Released, tagged commits only. Never commit. |
| `develop`        | `main`    | —                      | Integration. Only `--no-ff` merges land here. |
| `feature/<topic>`| `develop` | `develop`              | All work. Kebab-case topic.                   |
| `release/x.y.z`  | `develop` | `main` + `develop`     | Version bump, changelog, checks only.         |
| `hotfix/x.y.z`   | `main`    | `main` + `develop`     | Urgent fix of a release.                      |

GitHub enforces part of it: ruleset `gitflow` blocks deleting or force-pushing `main` and
`develop`; pull requests are open to collaborators only.

## Feature

```sh
git switch develop && git pull --ff-only          # when a remote exists
git switch -c feature/<topic>
# … commits (Conventional Commits: feat:, fix:, docs:, refactor:, test:, chore:) …
git switch develop
git merge --no-ff feature/<topic> -m "Merge feature/<topic> into develop"
git branch -d feature/<topic>
git push origin develop
```

Push a feature branch (`git push -u origin feature/<topic>`) only to share it or open a PR.

## Release

Plugins: `scripts/release-plugin.sh <name> <x.y.z>` does the whole release (see the
`orca-plugin-release` skill). By hand, or for the hub itself:

```sh
git switch -c release/<x.y.z> develop
# bump versions, move CHANGELOG [Unreleased] → [x.y.z] - YYYY-MM-DD, run the checks
git commit -am "chore(release): v<x.y.z>"
git switch main && git merge --no-ff release/<x.y.z> -m "Release v<x.y.z>"
git tag -a v<x.y.z> -m v<x.y.z>
git switch develop && git merge --no-ff release/<x.y.z> -m "Merge release/<x.y.z> into develop"
git branch -d release/<x.y.z>
git push origin main develop v<x.y.z>
```

Hub release tags for a plugin are `<name>/v<x.y.z>`.

## Hotfix

```sh
git switch -c hotfix/<x.y.z> main
# fix, bump patch version, changelog
git commit -am "fix: …"
git switch main && git merge --no-ff hotfix/<x.y.z> -m "Hotfix v<x.y.z>" && git tag -a v<x.y.z> -m v<x.y.z>
git switch develop && git merge --no-ff hotfix/<x.y.z> -m "Merge hotfix/<x.y.z> into develop"
git branch -d hotfix/<x.y.z> && git push origin main develop v<x.y.z>
```

For a plugin, update the hub catalog after a hotfix like after a release: run
`scripts/release-plugin.sh` only for develop→main releases; for a hotfix, pin the submodule and
catalog by hand on a hub `release/<name>-<x.y.z>` branch (see `scripts/release-plugin.sh`'s hub part).

## Rules

- Commit only when the user asked for it; never commit on `main` or straight on `develop`.
- `--no-ff` for every merge into `develop` and `main`, so each feature/release stays visible.
- A release or hotfix branch merges into `main` and back into `develop` as two separate `--no-ff`
  merges. Afterwards `develop` is one merge commit ahead of `main` and behind it by the
  `Release …` commits, with the same files: that is expected, leave it. Never even the branches
  out (no fast-forward of `develop` to `main`, no merging `main` into `develop`) and never open
  or merge a pull request `develop` → `main`; ignore GitHub's "Compare & pull request" banner
  after pushing `develop`. `main` only receives release and hotfix merges.
- Never rewrite pushed history; force-push is blocked on `main`/`develop` anyway.
- Submodules in the hub are pinned to plugin release commits; `.gitmodules` sets `ignore = all`,
  so plugin development does not dirty the hub. Do not run `git submodule update` inside a
  plugin you are developing — it would check out the pinned commit.
- End commit messages with the Co-Authored-By line from the session's attribution rules.
