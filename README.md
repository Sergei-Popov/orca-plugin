# Orca plugins by Sergei Popov

Plugins for [Orca](https://orca.dev), and the Orca catalog that lists them.

| Plugin                                                                  | What it does                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Media Viewer](https://github.com/Sergei-Popov/orca-media-viewer)        | Video and audio in Orca's editor tabs: plays `.mkv`, adds a full player view to `.mp4`, `.mov`, `.mp3`, `.flac`… |
| [Archive Viewer](https://github.com/Sergei-Popov/orca-archive-viewer)    | `.zip`, `.jar`, `.tar.gz` and other archives in Orca's editor tabs: a file tree, previews inside, saving single files. |
| [Font Viewer](https://github.com/Sergei-Popov/orca-font-viewer)          | `.ttf`, `.otf`, `.woff`, `.woff2` fonts in Orca's editor tabs: sample text, every character, variable axes, details. |

## Install

In Orca: **Settings → Plugins → ⋯ → Catalog sources…**, add

```
https://github.com/Sergei-Popov/orca-plugin.git
```

with ref `main`, then install a plugin from the list. Orca checks every release against the
commit and content hash pinned in [`orca-catalog.json`](orca-catalog.json).

## Layout

- `orca-catalog.json` — the catalog (format 2).
- `assets/<plugin-id>/` — each plugin's icon, cover and screenshots for the catalog listing, copied
  from its latest release by `scripts/release-plugin.sh`.
- `plugins/<name>` — each plugin as a git submodule of its own repository, pinned to its latest
  release. Clone with `git clone --recurse-submodules`.
- `scripts/` — creating, releasing and protecting plugin repositories.
- `.claude/skills/` — instructions for Claude Code working in this repository.

## Contributing

The repositories are public to read and fork, but only the maintainers push and open pull
requests. Every repository uses git-flow: `main` holds tagged releases, `develop` integrates
`feature/*` branches, and releases go through `release/x.y.z`.

## License

MIT, see [LICENSE](LICENSE). Each plugin carries its own license file.
