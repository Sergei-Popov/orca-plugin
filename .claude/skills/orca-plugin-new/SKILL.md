---
name: orca-plugin-new
description: >-
  Create a new Orca plugin subproject in this hub end to end: scaffold, its own git-flow
  repository, a public GitHub repository locked to collaborators, a submodule of the hub, an Orca
  project in the "orca-plugin" group. Use when the user asks for a new plugin, a new subproject
  or a new Orca extension here ("сделай плагин…", "новый плагин", "новый подпроект").
---

# New plugin subproject

Every plugin is its own project: folder `plugins/<name>`, repository `Sergei-Popov/orca-<name>`,
Orca project in the sidebar group `orca-plugin`. Do all of the steps; the last one is required by
the user, not optional.

## 1. Decide the shape

Load the `orca-plugin-authoring` skill and pick the lowest `execution` profile and the template
(`theme`, `terminal-theme`, `icon-theme`, `syntax`, `language-pack`, `editor`, `panel`,
`components`, `worker-panel`, `hook`). Choose:

- `<name>`: kebab-case, short, no `orca-` prefix (the repo gets `orca-` prepended).
- plugin id: defaults to `<name>`; must not start with `orca-`.
- title and a one-sentence description in English (listings are public).

If something the user wants is already built into Orca (check with a quick real test, as was the
case for `.mp4` playback), say so and design around it rather than replacing it.

## 2. Create everything

From the hub root, on a clean tree:

```sh
scripts/new-plugin.sh <name> --template <template> --title "<Title>" --description "<one sentence>"
```

It runs `orca plugin create`, fills manifest author/repository/license, adds LICENSE and
CHANGELOG, makes the repo with `main` + `develop`, creates the public GitHub repo, applies
`scripts/github-protect.sh` (PRs collaborators-only, ruleset on main/develop), adds the submodule to
the hub through `feature/plugin-<name>` → `develop`, and runs `orca repo add`.
Flags: `--no-github` (local only), `--no-orca` (skip `orca repo add`).

If GitHub reports the PR policy could not be set, open
`https://github.com/Sergei-Popov/orca-<name>/settings` → Pull requests → *Collaborators only*.

## 3. Put the Orca project into the group (required)

Follow the `orca-project-group` skill for `plugins/<name>`, then confirm:

```sh
scripts/orca-group.sh status     # every line must start with ✓
```

## 4. Start the work

```sh
cd plugins/<name>
git switch -c feature/<topic> develop
orca plugin dev watch . --check --json      # background terminal; approve only what the user asked for
```

Implement in `src/`, test (`orca plugin test .`, `tsc`, `orca plugin check .`), look at a shot,
commit on the feature branch, merge `--no-ff` into `develop`. Update the plugin table in
`CLAUDE.md` and `README.md` of the hub on a hub feature branch.

## 5. Release when asked

Skill `orca-plugin-release`.
