# Listing images

`scripts/listing-image.sh` builds a plugin's listing images, a cover and 4–5 screenshots, each
1600×1000 PNG, in the hub's house style. It renders the plugin's **real editor UI** on a local
stage in headless Google Chrome. Orca's window is never driven or captured; the only exception is
`--parity`, which needs your OK first.

```
plugin folder ──stage.mjs──> raw capture (real UI, Orca 1.4.258 tokens and CSP)
               ──compose.mjs─> template (cover.html / shot.html + listing.css, Inter) ──> 1600×1000 PNG
               ──check.mjs──> checks + contact sheet (.orca/listing/sheet.png)
```

## Command

```sh
scripts/listing-image.sh <name|dir> [--only cover|N] [--check] [--sheet] [--write-manifest]
                         [--plain] [--palette] [--spec <listing.json>] [--out-dir <dir>] [--dry-run]
scripts/listing-image.sh <name|dir> --parity <file>   # needs your OK: opens a tab in Orca
scripts/listing-image.sh shared-samples              # stub for now: prints what it would build
```

| Option | What it does |
|---|---|
| `--spec <file>` | The listing spec. Default: `<plugin>/tools/listing.json`. |
| `--out-dir <dir>` | Where generated files go (`raw/`, `out/`, `sheet.png`, `sheet.html`, `report.json`). Default: `<plugin>/.orca/listing`, which every plugin git-ignores. |
| `--dry-run` | Writes the final PNGs to `<out-dir>/out/` instead of the spec's `out` paths (`images/…`). The manifest is never written; `--write-manifest` writes `<out-dir>/orca-plugin.preview.json` instead. |
| `--only cover\|N` | Builds only the cover, or screenshot N (1-based). |
| `--check` | Runs the checks below after the build. |
| `--sheet` | Writes the contact sheet. |
| `--write-manifest` | Rewrites `orca-plugin.json` `cover` as `{path, alt}` and `screenshots` as `[{path, alt}]`, in spec order. It does this only if the build and the checks passed. It lists images that nothing references any more but never deletes them. |
| `--plain` | Screenshots become bare stage captures, with no headline or backdrop: 1067×667 CSS at scale 1.5, cropped to 1600×1000. This is a fallback in case a reviewer ever objects to composed screenshots. |
| `--palette` | Palette PNG instead of lossless. Use it only after you have checked the glow crop on the sheet for banding. |
| `--parity <file>` | Runs `orca plugin shot <dir> --editor <file> --width 960 --height 536` and puts the result next to the stage render at scale 1, as `<out-dir>/parity.png`. It opens a tab in Orca and can switch workspaces, so it asks in a terminal, or needs `LISTING_PARITY_OK=1` once you have agreed. It passes no `--theme` and no `--act`. |

- **macOS only.** It uses `/Applications/Google Chrome.app` with `--mute-audio --hide-scrollbars
  --force-color-profile=srgb`, because fonts differ on other machines.
- On first use, and whenever `package-lock.json` changes, it runs `npm ci` here (exact pins, see
  `package.json`).
- **Exit codes:** 0 means every image was built and, with `--check`, passed. 1 means a build or
  check failure; the reason is printed.

## Workflow for a plugin

1. In the plugin, branch `feature/listing-images` from `develop`, after any open review branch is merged.
2. Make the demo files under `.orca/listing/samples/`. Use the plugin's generator in `tools/`, or
   committed test files, or `scripts/listing-image.sh shared-samples` once that is built.
3. Write `tools/listing.json` (schema below).
4. Run `scripts/listing-image.sh <name> --dry-run --check --sheet`.
5. Open every PNG in `.orca/listing/out/` and `.orca/listing/sheet.png` with the Read tool.
   - Adjust `origin`, the acts and the stage size.
   - **Copy the values the capture shows into the alts.**
   - Re-run until the check passes and every alt describes only what is visible.
6. Run `scripts/listing-image.sh <name> --check --write-manifest` (without `--dry-run`). This
   writes `images/*.png` and the manifest. Then run `orca plugin validate . --json`.
7. Delete the images the run lists as unreferenced, if they are obsolete and the README does not use them.
8. Before any orca.dev release, run `scripts/directory-check.sh <name> --update`. Releases go through
   the `orca-plugin-release` skill.

**Tip.** To find where things are, capture the state once at scale 1 with a tall viewport. For
example, set `"height": 2600` on a slide's stage, and use `--out-dir` for this throwaway run. Then
scroll with `wheel` by the measured distance.

## `tools/listing.json`

```json
{
  "accent": "#22C55E",
  "title": ["HAR", "Viewer"],
  "icon": "images/icon.png",
  "cover": {
    "out": "images/cover.png",
    "alt": "HAR Viewer with secrets masked: the request list and waterfall, a failed POST /v1/reports/export selected, its headers below.",
    "tagline": "Read network recordings, mask secrets, brief your agent.",
    "chips": [".har", ".har.zip", "Waterfall", "Masked secrets", "Agent digest"],
    "chipMain": 0,
    "stage": {
      "file": ".orca/listing/samples/dashboard.har", "theme": "dark", "scale": 2, "width": 480, "height": 800,
      "waitFor": { "text": "29 requests" },
      "act": [{ "clickLabel": "Mask secrets" }, { "clickText": "/v1/reports/export" }],
      "origin": { "x": 0, "y": 153 }
    }
  },
  "screenshots": [
    {
      "out": "images/shot-1-agent-export.png",
      "headline": "Hand failed requests to your agent",
      "alt": "Export for agent: a Markdown digest of the 4 failed requests with known secret patterns masked, to copy or save as .md.",
      "stage": { "file": ".orca/listing/samples/dashboard.har", "act": [{ "clickLabel": "Export for agent" }] }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `accent` | The plugin's accent colour (see the table under "Colour accents"). |
| `title` | `[distinctive word, "Viewer"]`. Line 1 must fit the 600 px column. |
| `icon` | The plugin icon, used on the cover and the slides. Default: `images/icon.png`. |
| `cover.tagline` / `cover.chips` / `cover.chipMain` | At most 60 characters and 2 lines; at most 5 chips of ≤ 16 characters each; the index of the filled main chip (default 0). |
| `*.out` | The final image path in the plugin (`images/cover.png`, `images/shot-<n>-<slug>.png`). |
| `*.alt` | The visible caption on orca.dev and in Orca's lightbox. See "Alt text rules". |
| `screenshots[].headline` | At most 40 characters and 7 words, on one line. The only overlay text on a slide. |
| No `caption`, no `theme` | These are refused in the spec and in the manifest. The stage theme goes in `stage.theme`. |

**`stage`**

| Field | Default | Meaning |
|---|---|---|
| `file` | required | The demo file, relative to the plugin folder. |
| `theme` | `dark` | `dark` or `light`. Only the last slide may be light. |
| `scale` | cover 2 (min 1.6), slides 1.5 | Device scale factor. |
| `width` × `height` | slides 960×536 | CSS viewport. On the cover, from `origin` the viewport must reach at least the window: 440 CSS at scale 2, 550 at 1.6. |
| `origin` | `{x: 0, y: 0}` | The CSS point of the UI that lands at the panel's top-left corner. |
| `waitFor` | none | `{"text": "…"}`, `{"regex": "…"}` or `{"noText": "Loading…"}`. Timeout 60 s. |
| `act` | `[]` | Input steps (below). |
| `editor` | longest matching extension | A `customEditors` id, when the extension is ambiguous. |
| `saveAs` | `saved` | What `orca.files.saveAs` resolves: `saved` or `cancelled`. |
| `readOnly` | `false` | The document's `readOnly`. Orca passes the file's real state. |
| `settleMs` | 250 | The pause after the last act, before capture. |

### Acts: input only, never DOM edits

Each act is followed by a 150 ms pause. Coordinates are CSS px of the stage viewport.

| Act | Example |
|---|---|
| click, dblclick | `{"click": [x, y]}`, `{"dblclick": [x, y]}` |
| drag | `{"drag": [[x1, y1], [x2, y2]]}` |
| key | `{"key": "f", "modifiers": ["meta"]}` |
| clickText | `{"clickText": "Add a book"}`. Exact and case-sensitive by default. `"exact": false` matches a substring, ignoring case. `"nth": 1` picks the second match. `"count": 2` double-clicks. |
| clickLabel | `{"clickLabel": "Validation and lint results"}`. Matches `aria-label` or `title`, exactly first, then by prefix. Visible elements only. |
| select | `{"select": "<aria-label>", "option": "<label>"}`. Matches the option by label, then by prefix, then by value. **A native `<select>` popup is never captured**, so an image only ever shows a select closed, with its value. |
| fill | `{"fill": "<aria-label>", "value": "…"}`. On range and number inputs it sets the value and fires `input` and `change`, which is what a drag ends with. |
| hover, type, wheel | `{"hover": [x, y]}`, `{"type": "text"}`, `{"wheel": [x, y, dy]}` |
| wait | `{"wait": ms}`, `{"waitForText": "…"}`, `{"waitForNoText": "…"}` |

- **Virtualised lists only render visible rows.** Reach deep entries by expanding, filtering or
  using the keyboard.
- **Capture toasts quickly.** Capture within about 1 s of an act that shows a toast.
- **Some trees toggle only on a chevron or a double-click.** API Spec's schema rows, for example,
  open with `{"clickText": "shelf", "count": 2}`.

## Checks (`--check`)

**Images**
- Cover and slides:
  - exactly 1600×1000;
  - 8-bit RGB, with palette allowed only with `--palette`;
  - no alpha or `tRNS`, no `acTL`;
  - ≤ 400 KB (house) and ≤ Orca's limit (cover 1 MB, screenshot 1.5 MB).
- The UI image was not resampled: the pixels of the panel interior are identical to the raw capture's.
- The layout:
  - title lines ≤ 600 px;
  - tagline ≤ 2 lines;
  - left column ends ≥ 96 px above the bottom;
  - text ≤ 22% of the area;
  - nothing in the keep-out box;
  - the headline on one line.

**Icons**
- `images/icon.png` and every editor icon in the manifest:
  - square, at least 128 px (256×256 house size);
  - ≤ 256 KB, with a warning above 60 KB (plugin icon) or 30 KB (editor icons);
  - an opaque centre.
- The plugin icon must also have no fully transparent row or column within 8 px of an edge.

**Text**
- Banned words.
- Tagline and chips within their limits.
- Alts 1–140 characters, with a warning above 125.
- Headlines ≤ 40 characters and 7 words.
- A dark cover; at most one light slide, last only, whose alt ends with "Shown in Orca's light theme.".

**Budget:** images total ≤ 1.6 MB (house), and ≤ 8 MB (Orca).

**Stage**
- No `pageerror`, `console.error` or failed request.
- No access to an `orca.*` member the stage does not provide.

**Manifest:** a manifest that still has `caption`/`theme`, or differs from the spec, is a warning
in a dry run and an error otherwise.

## The sheet (`--sheet`)

Every thumbnail goes through a WebP q75 round trip, like orca.dev. The sheet shows:
- the cover at 112, 244, 300, 398 and 800 px, with orca.dev's "New" pill;
- the safe zones;
- the share card (637×398, right 13% cut);
- a 2× crop of the top-right glow, to spot banding;
- the icon at 64/48/16 px on dark and light, inside 25% tiles, plus the editor icons at 16 px;
- the slides at 240 (Orca's strip), 386 (orca.dev's grid) and 1024 px (lightbox);
- the family row (every hub plugin's current `images/cover.png`);
- texts and findings.

## What the stage reproduces (Orca 1.4.258, `orca-frame.json`)

- **Guest document.** Orca's `buildPluginGuestShellHtml`: `<!doctype html><html class="dark|light">`,
  then `<style id="orca-design-tokens">:root{--orca-…}</style>`, then the frame-API stand-in, then
  the editor's entry HTML (`<div id="root"></div><script type="module" src="./<entry>?orca-module">`).
- **Tokens.** The 20 tokens of `PANEL_DESIGN_TOKEN_ALLOWLIST`, with Orca's default light and dark
  values. The dark theme is `background #0a0a0a`, `card #171717`, `destructive #ff6568`. The light
  theme is `background #fff`, `destructive #e40014`.
- **CSP.** Every response carries `PLUGIN_GUEST_CSP`, so anything Orca would block also fails here.
- **Modules.** `.ts` is transpiled with esbuild, including workers created with `new URL(…, import.meta.url)`.
- **`window.orca`** provides only what editors use today.
  - `api {major: 1, minor: 2}` and `locale 'en'`.
  - The real frame also has `plugin`, `host`, `storage`, `settings` and `secrets`. Using any of
    these fails the build, with the member named, until the stage supports it.
  - `document.get` / `onDidChange` replay `{version: 1, readOnly, content}`.
    - A bytes editor gets `content: {kind: 'bytes', bytes}` and a `fileType` (the extension without its dot).
    - A text editor gets `{kind: 'text', text}` and no `fileType`.
  - `applyEdit` rejects with `not_permitted`.
  - `on('theme')` sends `{colorScheme}` once.
  - `files.saveAs` resolves `{status}` and `shell.openExternal` resolves
    `{opened: false, reason: 'cancelled'}`. Both reject with `not_permitted` without a user gesture,
    as Orca does.
  - Access to any other member is recorded and fails the build.
- **Browser context.** Each capture gets a fresh context: `locale en-US`, `timezoneId UTC`,
  `reducedMotion reduce`.

Where these differ from the art direction of 2026-11-15, the values here come from the app
(`app.asar` of 1.4.258):
- the real token values, not the invented `#dc2626` destructive;
- `readOnly` is the file's state, not `true`;
- a text editor gets no `fileType`;
- `api` is an object, not `1`;
- the theme payload is `{colorScheme}`;
- `--plain` uses 1067×667 cropped, because 1066×666 at 1.5 is 1599×999.

**Encoding.** The default is lossless: sharp `png({compressionLevel: 9, palette: false})`, trying
both adaptive filtering settings and keeping the smaller file. Real covers land at 200–300 KB.

Do not pass `effort` or `quality` to sharp's `png()`. Either one silently switches to palette mode.
That is how the prototype's "lossless" 146 KB cover came about: hundreds of thousands of pixels
changed, by up to 35 levels. Use `--palette` for that on purpose.

---

## House style: one family (art direction A, 2026-11-15)

### Canvas and formats

| Image | Size | Format | Budget |
|---|---|---|---|
| Icon (`images/icon.png`) | 256×256 | PNG, opaque artwork filling the square, own corner radius 48–56 px (Orca and orca.dev clip at 25% = 64 px), **no transparent margin** | ≤ 60 KB (hard limit 256 KB) |
| Editor tab icons (`icons/*.png`) | 256×256 | PNG. The same icon rules apply, because Orca checks them at install and counts them toward its 8 MB. They draw at 14–16 px, so a margin is allowed here. | ≤ 30 KB each |
| Cover | 1600×1000, exactly 16:10, so no 16:10 box crops it; only the share card cuts it | PNG, 8-bit RGB, no alpha, not animated, metadata stripped | ≤ 400 KB (hard limit 1024 KB) |
| Screenshots | 4–5, all 1600×1000 | Same as the cover | ≤ 400 KB each (hard limit 1536 KB) |

**Images per plugin: ≤ 1.6 MB in total** (icon, cover, screenshots and editor icons).
- That keeps each whole plugin under the self-scan's 2.5 MB warning.
- Media is the exception: it already carries 2.16 MB of code and a 1.86 MB WASM decoder, so it
  gets a warning only, far below the 5 MiB "size" hold.
- Lossless covers and slides land at 200–300 KB each, so five slides and a cover come close to
  1.6 MB. HAR Viewer reached 1625 KB. Pick calm UI states.

**Why not 2560×1600:**
- On a retina display, orca.dev's lightbox enlarges a 1600 px image about 1.5×, so 2560 px would look sharper.
- But 2560×1600 costs about 2.5× the bytes. The budget wins.

**File names:**
- `images/cover.png`: keep this path, because the READMEs use it as their hero image.
- `images/shot-<n>-<slug>.png` for screenshots.
- Delete every image that neither the manifest nor the README references any more.

### Theme policy

- orca.dev is dark-only (`#08090a`), and `theme` filters nothing anywhere.
- **The cover and slides 1 to n−1 are dark.**
  - At most one light slide is allowed, and it is always last.
  - It must show a feature, not just the theme.
  - Its alt ends with "Shown in Orca's light theme."
- **No `theme` and no `caption` in manifests.** If Orca ever starts filtering by theme, an untagged
  screenshot still shows in both themes.
- The UI uses Orca 1.4.258's default theme tokens (`orca-frame.json`), so images show what new users see.

### Backdrop and framing (identical for all plugins)

- **Base:** `color-mix(accent 7%, #0a0b0e)`. Because it is a tinted near-black, each cover keeps its own colour at 112 px.
- **Glows:**
  - the accent at 34%, as a radial gradient of 1000×760 at (80%, 18%), fading out by 70%;
  - the accent at 14%, as a radial gradient of 700×600 at (6%, 100%).
- **Texture:** a dot grid of 1 px dots, `rgba(255,255,255,.045)`, every 28 px.
- **UI panel:**
  - corner radius 22 px on the cover, and 20 px on the top corners of slides;
  - a 1.5 px border, `rgba(255,255,255,.14)`, drawn as an overlay so the UI stays on whole pixels;
  - a shadow, `0 40px 120px rgba(0,0,0,.65)`.
  - The panel holds **only the plugin's real UI**: no Orca window chrome, tab bar, file tree or
    Orca logo, and no device frames.
- **No annotations:** no arrows, rings or fake tooltips. The UI state itself (a selection, a
  filter, a popover) carries the focus.

### Cover layout (1600×1000)

**Left column** (x 104–704, top at y 240)
- **Icon:** 112 px, radius 26, with a soft glow of the accent at 45%.
- **Title, line 1:** the distinctive word, in `#f5f5f7`.
- **Title, line 2:** **"Viewer"**, in `color-mix(accent 35%, #8e8e96)`, weight 640. This is the family signature.
- **Title type:** Inter, 112 px, weight 760, line height .98, letter spacing −0.035em. The first word must fit the 600 px column.
- **Tagline:** 38 px with line height 1.28, weight 420, 78% white. At most 60 characters and 2 lines.
- **Chips:**
  - at most 5, each at most 16 characters;
  - 27 px, weight 560, pill-shaped, with a 1.5 px border of 16% white;
  - the main chip (the main file type) is filled with the accent and has `#08090a` text.
- With two rows of chips the column ends at about y 898, which keeps 96 px from the bottom edge.

**Panel and UI window**
- The panel sits at (720, 120) and bleeds off the right and bottom edges.
- The visible window is 880×880 image px:
  - 440×440 CSS px of UI at device scale 2 (the default);
  - 550×550 CSS px at scale 1.6 (the minimum).
- The UI image is placed at its natural pixel size and never resampled.
- **Two-pane constraint.** Most editors switch to a stacked or narrow layout at a viewport width of
  720 px or less (Image at 640 px). A 440×440 CSS window therefore cannot show two panes side by
  side. Pick the cover's state with that in mind, for example by using a tall stage and choosing
  `origin`.

### Screenshot (slide) layout

**Headline row**
- The icon at 72 px (radius 17) at (96, 74), then the headline in Inter 700 at 60 px, letter spacing −0.025em.
- One line, **at most 40 characters and 7 words**. It is the only overlay text on the slide.

**Panel**
- At (80, 196), 1440×804, flush with the bottom edge.
- It holds a stage capture of a **960×536 CSS viewport at device scale 1.5**, so 12 px UI text becomes 18 px.

**How the text reads at each display size**

| Where | Size | UI text reads as | Headline reads as |
|---|---|---|---|
| Orca's lightbox (inferred) | about 976 px | about 11 px | |
| orca.dev's lightbox (1440×900 window) | about 1184 px | about 13 px | |
| orca.dev's grid | about 386 px | | about 14.5 px |
| Orca's screenshot strip | 240 px | | about 9 px |

### Safe zones (1600×1000)

**Keep-out box (backdrop only): x < 560 and y < 240.** It covers:
- orca.dev's "New" pill: about 54–350 × 54–175 on desktop, and 69–444 × 69–222 on phones;
- Orca's in-app "Installed" badge (inferred: about x 546, y 200 in a 3-column grid).

**Text** stays at least 96 px from the left, top and bottom edges.

**The aha element** (the one thing that must read) sits inside x 720–1300 and y 160–860.
- That zone survives the share card, which cuts about 13% off the right, so x > 1392 disappears there.
- Anything right of x 1300 survives on orca.dev and in Orca but not on the share card.
- The area right of x 1500 and below y 940 is bleed only.

### Maximum text

- **Cover:** title, tagline and chips together take ≤ 22% of the area.
- **Slides:** the headline only, about 8% of the area.
- **Banned in overlay text and alts:** Best, #1, New, Free, Pro, trial, any price, Official,
  Verified, ratings, install counts, and check-mark "trust" badges.
- **Format names** (OpenAPI, AsyncAPI, Swagger, Arazzo, OpenType, javap) may appear as plain text,
  never as logos. Their disclaimers belong in the description.

### Typography

- **Inter**, variable (OFL 1.1), for all overlay text. It comes from the pinned
  `@fontsource-variable/inter` here, so no binary font sits in the hub's history.
- **Never put a TTF/OTF/TTC into a plugin repo.** The directory rejects it.
- **No SF Pro or SF Mono for artwork.** Apple licenses them only for mock-ups of Apple-platform UIs.
  SF still appears inside the UI captures, because the editors use `system-ui`; that is real UI and is fine.

### Colour accents (one per plugin, at least 31° of hue apart)

| Plugin | Accent | Hue |
|---|---|---|
| Archive Viewer | `#F59E0B` amber | 38° |
| HAR Viewer | `#22C55E` green | 142° |
| Font Viewer | `#14B8A6` teal | 173° |
| API Spec Viewer | `#3B82F6` blue | 217° |
| Class File Viewer | `#8B5CF6` violet | 258° |
| Media Viewer | `#D946EF` fuchsia | 292° |
| Image Viewer | `#F43F5E` rose | 350° |

The "Viewer" line measures 5.0–6.6:1 contrast and the white title more than 13:1. Main-chip text
ranges from 4.7:1 (violet) to 9.3:1 (amber). All pass WCAG AA for large text.

### Alt text rules (alt is the visible caption on orca.dev and in Orca's lightbox)

- **Length:** 1–140 characters (the hard limit is 160). Aim for ≤ 125, so it fits about 2–3 lines under a 386 px screenshot.
- **Order:** first what you can do or the benefit, then what the image shows, with concrete values
  and control names exactly as the UI prints them.
- **Values come from the capture, never from memory.** Counts, sizes, layers, tiles and frame
  rates are copied from the rendered UI.
- **Wording:**
  - present tense, no superlatives;
  - never "with Orca's dark theme"; the light slide ends with "Shown in Orca's light theme.";
  - only what is visible (a save dialog, for example, is never in an image);
  - do not repeat the headline word for word; add to it.
- **Fields:** no `caption`, so installed users and visitors see the same text.

### Demo content

- Demo files are fictional: no real people, books, products, tokens or analytics IDs.
- Generators go in the plugin's `tools/` and write to `.orca/listing/samples/`.
- Generators must pass the self-scan:
  - never 16 or more `\xNN`/`\uNNNN` escapes in a row;
  - no base64 blobs;
  - no binary fixtures (build bytes in code).
