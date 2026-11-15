// Validation of a plugin's listing images and texts (`--check`), the contact sheet (`--sheet`),
// the manifest rewrite (`--write-manifest`) and the parity picture (`--parity`).
// House-style limits are in README.md ("House style"); Orca's own hard limits come from
// orca-frame.json `imageRules` (Orca 1.4.258 refuses the whole install when one image breaks them).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const FRAME = JSON.parse(fs.readFileSync(path.join(here, 'orca-frame.json'), 'utf8'))
const KB = 1024
export const LIMITS = {
  width: 1600, height: 1000, imageBytes: 400 * KB, screenshots: 6, totalBytes: 1.6 * 1024 * KB,
  iconSide: 256, iconBytes: 256 * KB, iconTarget: 60 * KB, editorIconTarget: 30 * KB, iconEdge: 8,
  alt: 140, headline: 40, headlineWords: 7, tagline: 60, chips: 5, chip: 16,
}
export const LIGHT_SENTENCE = "Shown in Orca's light theme."
// Overlay text and alts: no superlatives, trust badges, pricing, ratings or install counts.
const BANNED = [
  [/\bbest\b/i, 'Best'], [/#\s?1\b/, '#1'], [/\bnew\b/i, 'New'], [/\bfree\b/i, 'Free'], [/\bpro\b/i, 'Pro'],
  [/\btrial\b/i, 'trial'], [/\bofficial\b/i, 'Official'], [/\bverified\b/i, 'Verified'],
  [/[$€£¥]\s?\d|\b\d+([.,]\d+)?\s?(usd|eur|gbp)\b|\bprice[sd]?\b|\bpricing\b/i, 'a price'],
  [/\brat(ed|ing|ings)\b|\b\d(\.\d)?\s?(\/\s?5|stars?)\b|[★☆]/i, 'a rating'],
  [/\b\d[\d,.]*\s?[kKmM]?\+?\s?(installs?|downloads?|users)\b/i, 'an install count'],
  [/[✓✔☑✅]/, 'a check-mark badge'],
]
const chars = (s) => Array.from(String(s ?? '')).length

/** PNG chunk facts: dimensions, bit depth, colour type, animation, transparency, metadata. */
export function pngInfo(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!sig.every((b, i) => buf[i] === b)) return { png: false }
  const info = { png: true, chunks: [] }
  for (let o = 8; o + 8 <= buf.length;) {
    const len = buf.readUInt32BE(o)
    const type = buf.toString('latin1', o + 4, o + 8)
    info.chunks.push(type)
    if (type === 'IHDR') {
      info.width = buf.readUInt32BE(o + 8)
      info.height = buf.readUInt32BE(o + 12)
      info.bitDepth = buf[o + 16]
      info.colorType = buf[o + 17]
    }
    if (type === 'IEND') break
    o += 12 + len
  }
  info.animated = info.chunks.includes('acTL')
  info.transparency = info.chunks.includes('tRNS')
  info.metadata = info.chunks.filter((c) => ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(c))
  return info
}

function checkListingImage(file, kind, { palette }, errors, warnings) {
  const name = path.basename(file)
  if (!fs.existsSync(file)) return errors.push(`${name}: missing`)
  const buf = fs.readFileSync(file)
  const p = pngInfo(buf)
  const rule = FRAME.imageRules[kind === 'cover' ? 'cover' : 'screenshot']
  if (!p.png) return errors.push(`${name}: not a PNG`)
  if (p.width !== LIMITS.width || p.height !== LIMITS.height) errors.push(`${name}: ${p.width}x${p.height}, not ${LIMITS.width}x${LIMITS.height}`)
  if (p.width < rule.minWidth || p.height < rule.minHeight) errors.push(`${name}: below Orca's ${rule.minWidth}x${rule.minHeight}`)
  if (p.bitDepth !== 8) errors.push(`${name}: bit depth ${p.bitDepth}, not 8`)
  if (p.colorType === 3 && !palette) errors.push(`${name}: palette PNG without --palette`)
  else if (p.colorType !== 2 && p.colorType !== 3) errors.push(`${name}: colour type ${p.colorType} (must be RGB without alpha)`)
  if (p.transparency) errors.push(`${name}: has transparency (tRNS)`)
  if (p.animated) errors.push(`${name}: animated (acTL); Orca refuses it`)
  if (p.metadata.length) warnings.push(`${name}: metadata chunks ${p.metadata.join(', ')}`)
  if (buf.length > rule.maxBytes) errors.push(`${name}: ${(buf.length / KB).toFixed(0)} KB is over Orca's ${rule.maxBytes / KB} KB`)
  else if (buf.length > LIMITS.imageBytes) errors.push(`${name}: ${(buf.length / KB).toFixed(0)} KB is over the 400 KB budget`)
  return buf.length
}

async function checkIcon(file, { plugin }, errors, warnings) {
  const name = path.relative(path.dirname(path.dirname(file)), file)
  if (!fs.existsSync(file)) return errors.push(`${name}: missing`)
  const bytes = fs.statSync(file).size
  const buf = fs.readFileSync(file)
  const p = pngInfo(buf)
  const isWebp = buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP'
  if (!p.png && !isWebp) errors.push(`${name}: must be PNG or WebP`)
  if (p.animated) errors.push(`${name}: animated`)
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width !== info.height) errors.push(`${name}: ${info.width}x${info.height} is not square`)
  if (info.width < 128) errors.push(`${name}: smaller than Orca's 128x128`)
  if (info.width !== LIMITS.iconSide || info.height !== LIMITS.iconSide) warnings.push(`${name}: ${info.width}x${info.height}, house style is 256x256`)
  if (bytes > LIMITS.iconBytes) errors.push(`${name}: ${(bytes / KB).toFixed(0)} KB is over 256 KB`)
  else if (bytes > (plugin ? LIMITS.iconTarget : LIMITS.editorIconTarget)) warnings.push(`${name}: ${(bytes / KB).toFixed(0)} KB, target ${(plugin ? LIMITS.iconTarget : LIMITS.editorIconTarget) / KB} KB`)
  const a = (x, y) => data[(y * info.width + x) * 4 + 3]
  const cx = Math.floor(info.width / 2)
  const cy = Math.floor(info.height / 2)
  let opaque = 0
  for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if (a(x, y) === 255) opaque++
  if (opaque < 25) errors.push(`${name}: the centre is not opaque`)
  if (plugin) {
    // A margin shows as a ring where Orca and orca.dev clip at 25%; corners up to r56 pass.
    const edge = LIMITS.iconEdge
    const clearRow = (y) => { for (let x = 0; x < info.width; x++) if (a(x, y) !== 0) return false; return true }
    const clearCol = (x) => { for (let y = 0; y < info.height; y++) if (a(x, y) !== 0) return false; return true }
    for (let i = 0; i < edge; i++) {
      if (clearRow(i) || clearRow(info.height - 1 - i) || clearCol(i) || clearCol(info.width - 1 - i)) {
        errors.push(`${name}: transparent margin (a fully transparent row or column within ${edge} px of an edge); the artwork must fill the square`)
        break
      }
    }
  }
  return bytes
}

function checkText(spec, errors, warnings) {
  const banned = (where, text) => {
    for (const [re, label] of BANNED) if (re.test(text)) errors.push(`${where}: banned wording (${label}): "${text}"`)
  }
  const shots = spec.screenshots ?? []
  const cover = spec.cover ?? {}
  banned('title', (spec.title ?? []).join(' '))
  if (chars(cover.tagline) > LIMITS.tagline) errors.push(`tagline: ${chars(cover.tagline)} characters (at most ${LIMITS.tagline})`)
  banned('tagline', cover.tagline ?? '')
  const chips = cover.chips ?? []
  if (chips.length > LIMITS.chips) errors.push(`chips: ${chips.length} (at most ${LIMITS.chips})`)
  for (const c of chips) {
    if (chars(c) > LIMITS.chip) errors.push(`chip "${c}": ${chars(c)} characters (at most ${LIMITS.chip})`)
    banned(`chip "${c}"`, c)
  }
  if ((cover.stage?.theme ?? 'dark') !== 'dark') errors.push('cover: the cover is dark (stage.theme)')
  const entries = [['cover', cover], ...shots.map((s, i) => [`screenshot ${i + 1}`, s])]
  for (const [where, x] of entries) {
    const n = chars(x.alt)
    if (n < 1 || n > LIMITS.alt) errors.push(`${where} alt: ${n} characters (1-${LIMITS.alt})`)
    else if (n > 125) warnings.push(`${where} alt: ${n} characters (aim for 125 or fewer)`)
    banned(`${where} alt`, x.alt ?? '')
    if (/with (Orca's )?(the )?(dark|light) theme/i.test(x.alt ?? '')) errors.push(`${where} alt: never "with the dark/light theme"; the light slide ends with "${LIGHT_SENTENCE}"`)
    if ('caption' in x || 'theme' in x) errors.push(`${where}: has caption or theme (removed from every listing)`)
  }
  if (shots.length > LIMITS.screenshots) errors.push(`${shots.length} screenshots (at most ${LIMITS.screenshots})`)
  shots.forEach((s, i) => {
    const where = `screenshot ${i + 1}`
    const words = String(s.headline ?? '').trim().split(/\s+/).filter(Boolean).length
    if (chars(s.headline) > LIMITS.headline) errors.push(`${where} headline: ${chars(s.headline)} characters (at most ${LIMITS.headline})`)
    if (words > LIMITS.headlineWords) errors.push(`${where} headline: ${words} words (at most ${LIMITS.headlineWords})`)
    banned(`${where} headline`, s.headline ?? '')
    if (s.headline && (s.alt ?? '').toLowerCase().includes(s.headline.toLowerCase())) warnings.push(`${where} alt repeats the headline word for word`)
    const light = (s.stage?.theme ?? 'dark') === 'light'
    const sentence = (s.alt ?? '').includes(LIGHT_SENTENCE)
    if (light && i !== shots.length - 1) errors.push(`${where}: the one light slide must be the last`)
    if (light && !(s.alt ?? '').endsWith(LIGHT_SENTENCE)) errors.push(`${where}: a light slide's alt ends with "${LIGHT_SENTENCE}"`)
    if (!light && sentence) errors.push(`${where}: "${LIGHT_SENTENCE}" on a dark slide`)
  })
  if (shots.filter((s) => s.stage?.theme === 'light').length > 1) errors.push('at most one light slide')
}

/**
 * Everything `--check` validates. `results` are this run's build results; images not built in this
 * run (--only) are checked where they are now (the dry-run folder, else the plugin's images/).
 */
export async function checkListing({ pluginDir, spec, manifest, results, outPathFor, palette, dryRun, writeManifest = false }) {
  const errors = []
  const warnings = []
  const facts = []
  const fromPlugin = (p) => (path.isAbsolute(p) ? p : path.join(pluginDir, p))

  // Stage and composition, from this run.
  for (const r of results) {
    for (const e of r.errors) errors.push(`${r.id}: ${e}`)
    for (const w of r.warnings) warnings.push(`${r.id}: ${w}`)
    if (r.uiPixelsIdentical === false) errors.push(`${r.id}: UI resampled`)
  }

  // Listing images.
  let total = 0
  const entries = [['cover', spec.cover], ...(spec.screenshots ?? []).map((s, i) => [`shot-${i + 1}`, s])]
  for (const [id, entry] of entries) {
    let file = outPathFor(entry)
    if (!fs.existsSync(file) && dryRun) file = fromPlugin(entry.out)
    const bytes = checkListingImage(file, id === 'cover' ? 'cover' : 'screenshot', { palette }, errors, warnings)
    if (typeof bytes === 'number') {
      total += bytes
      facts.push(`${id.padEnd(7)} ${path.basename(file).padEnd(34)} ${(bytes / KB).toFixed(0).padStart(4)} KB  alt ${chars(entry.alt)}`)
    }
  }

  // Icons: the plugin icon, every custom editor and new-file icon of the manifest.
  const iconFile = fromPlugin(manifest.icon ?? spec.icon ?? 'images/icon.png')
  const ib = await checkIcon(iconFile, { plugin: true }, errors, warnings)
  if (typeof ib === 'number') { total += ib; facts.push(`icon    ${path.relative(pluginDir, iconFile).padEnd(34)} ${(ib / KB).toFixed(0).padStart(4)} KB`) }
  const editorIcons = new Set([...(manifest.contributes?.customEditors ?? []), ...(manifest.contributes?.newFiles ?? [])].map((e) => e.icon).filter(Boolean))
  for (const p of editorIcons) {
    const b = await checkIcon(fromPlugin(p), { plugin: false }, errors, warnings)
    if (typeof b === 'number') { total += b; facts.push(`editor  ${p.padEnd(34)} ${(b / KB).toFixed(0).padStart(4)} KB`) }
  }
  facts.push(`images total ${(total / KB).toFixed(0)} KB (budget ${(LIMITS.totalBytes / KB).toFixed(0)} KB, Orca ${(FRAME.imageRules.totalMaxBytes / KB).toFixed(0)} KB)`)
  if (total > FRAME.imageRules.totalMaxBytes) errors.push(`images total ${(total / KB).toFixed(0)} KB, over Orca's 8 MB`)
  else if (total > LIMITS.totalBytes) errors.push(`images total ${(total / KB).toFixed(0)} KB, over the 1.6 MB budget`)

  // Texts.
  checkText(spec, errors, warnings)

  // The manifest's listing fields. With --write-manifest (not a dry run) the check judges the
  // manifest this run is about to write; otherwise the file on disk, and only a note in a dry run.
  const plan = planManifest({ pluginDir, manifest, spec })
  const rewriting = writeManifest && !dryRun
  const judged = rewriting ? JSON.parse(plan.text) : manifest
  const listed = [judged.cover, ...(judged.screenshots ?? [])].filter(Boolean)
  const stale = listed.some((x) => 'caption' in x || 'theme' in x)
  const note = (msg) => (dryRun ? warnings : errors).push(msg)
  if (stale) note('orca-plugin.json still has caption/theme in cover or screenshots: run --write-manifest')
  else if (!rewriting && plan.changed) note('orca-plugin.json cover/screenshots differ from the spec: run --write-manifest')
  if (rewriting) facts.push(plan.changed ? 'manifest: cover and screenshots will be rewritten from the spec' : 'manifest: already matches the spec')
  return { errors, warnings, facts, total }
}

/**
 * What would make Orca refuse a manifest that lists the spec's images: a missing file, or one that
 * breaks Orca's image rules (or the house size and format). `fileFor(entry)` is where to look.
 */
export function listedImageProblems({ spec, fileFor, palette = false }) {
  const problems = []
  const entries = [['cover', spec.cover], ...(spec.screenshots ?? []).map((s, i) => [`shot-${i + 1}`, s])]
  for (const [id, entry] of entries) {
    const errors = []
    checkListingImage(fileFor(entry), id === 'cover' ? 'cover' : 'screenshot', { palette }, errors, [])
    for (const e of errors) problems.push(`${entry.out} (${id}): ${e.replace(/^[^:]+: /, '')}`)
  }
  return problems
}

/** The manifest with `cover` = {path, alt} and `screenshots` = [{path, alt}] in spec order. */
export function planManifest({ pluginDir, manifest, spec }) {
  const m = structuredClone(manifest)
  const cover = { path: spec.cover.out, alt: spec.cover.alt }
  const screenshots = (spec.screenshots ?? []).map((s) => ({ path: s.out, alt: s.alt }))
  const rebuilt = {}
  for (const [k, v] of Object.entries(m)) {
    if (k === 'cover' || k === 'screenshots') continue
    rebuilt[k] = v
    if (k === 'icon') { rebuilt.cover = cover; if (screenshots.length) rebuilt.screenshots = screenshots }
  }
  if (!('cover' in rebuilt)) { rebuilt.cover = cover; if (screenshots.length) rebuilt.screenshots = screenshots }
  const text = JSON.stringify(rebuilt, null, 2) + '\n'
  const changed = text !== JSON.stringify(manifest, null, 2) + '\n'
  // Images nothing references any more (never deleted here).
  const referenced = new Set([rebuilt.icon, cover.path, ...screenshots.map((s) => s.path)]
    .concat((m.contributes?.customEditors ?? []).map((e) => e.icon), (m.contributes?.newFiles ?? []).map((e) => e.icon))
    .filter(Boolean).map((p) => path.normalize(p)))
  const readme = ['README.md', 'readme.md'].map((f) => path.join(pluginDir, f)).find((f) => fs.existsSync(f))
  const readmeText = readme ? fs.readFileSync(readme, 'utf8') : ''
  const unreferenced = []
  const dir = path.join(pluginDir, 'images')
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      const rel = path.join('images', f)
      if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(f) || referenced.has(rel)) continue
      if (readmeText.includes(rel) || readmeText.includes(`./${rel}`)) continue
      unreferenced.push(rel)
    }
  }
  return { text, changed, unreferenced }
}

// ── Contact sheet ────────────────────────────────────────────────────────────────────────────

/** A thumbnail as orca.dev serves it: cover-fit, WebP q75 (4:2:0), PNG for the sheet page. */
async function thumb(file, w, h) {
  const webp = await sharp(file).resize(w, h, { fit: 'cover' }).webp({ quality: 75 }).toBuffer()
  return 'data:image/png;base64,' + (await sharp(webp).png().toBuffer()).toString('base64')
}
async function tile(file, s, bg) {
  // The icon inside a tile with 25% corners on a background, like Orca and orca.dev draw it.
  const r = Math.round(s * 0.25)
  const ic = await sharp(file).resize(s, s).png().toBuffer()
  const mask = Buffer.from(`<svg width="${s}" height="${s}"><rect width="${s}" height="${s}" rx="${r}" fill="#fff"/></svg>`)
  const clipped = await sharp({ create: { width: s, height: s, channels: 4, background: bg } }).composite([{ input: ic }, { input: mask, blend: 'dest-in' }]).png().toBuffer()
  return 'data:image/png;base64,' + clipped.toString('base64')
}
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export async function writeSheet({ browser, pluginDir, spec, manifest, results, outPathFor, out, hubPlugins, check }) {
  const fromPlugin = (p) => (path.isAbsolute(p) ? p : path.join(pluginDir, p))
  const pick = (entry) => [outPathFor(entry), fromPlugin(entry.out)].find((f) => fs.existsSync(f))
  const coverFile = pick(spec.cover)
  const parts = []
  const section = (title, body) => parts.push(`<section><h2>${escHtml(title)}</h2>${body}</section>`)
  const fig = (src, label, extra = '') => `<figure${extra}><img src="${src}"><figcaption>${escHtml(label)}</figcaption></figure>`

  if (coverFile) {
    // Cards at orca.dev and Orca sizes; the "New" pill at its measured place on the orca.dev sizes.
    let cards = ''
    for (const w of [112, 244, 300, 398, 800]) {
      const h = Math.round((w * 10) / 16)
      const pill = w >= 244 ? `<i class="pill" style="left:${(54 * w) / 1600}px;top:${(54 * w) / 1600}px;width:${(296 * w) / 1600}px;height:${(121 * w) / 1600}px"></i>` : ''
      cards += `<figure class="card" style="width:${w}px"><div class="clip" style="width:${w}px;height:${h}px;border-radius:${w < 150 ? 8 : 12}px"><img src="${await thumb(coverFile, w, h)}">${pill}</div><figcaption>${w} px</figcaption></figure>`
    }
    section('Cover at card sizes (WebP q75; the pill is orca.dev\'s "New")', `<div class="row">${cards}</div>`)
    // Zones on an 800 px copy; the share card.
    const z = 0.5
    const zones = `<div class="clip" style="width:800px;height:500px"><img src="${await thumb(coverFile, 800, 500)}">` +
      `<i class="zone keep" style="left:0;top:0;width:${560 * z}px;height:${240 * z}px"></i>` +
      `<i class="zone aha" style="left:${720 * z}px;top:${160 * z}px;width:${580 * z}px;height:${700 * z}px"></i>` +
      `<i class="zone share" style="left:${1392 * z}px;top:0;width:${208 * z}px;height:500px"></i></div>`
    const share = `<div class="clip" style="width:554px;height:398px;border-radius:8px"><img src="${await thumb(coverFile, 637, 398)}"></div>`
    section('Safe zones and share card', `<div class="row"><figure>${zones}<figcaption>red: keep-out (x&lt;560, y&lt;240) · green: aha (720-1300 × 160-860) · grey: cut on the share card (x&gt;1392)</figcaption></figure><figure>${share}<figcaption>share card 637×398, right 13% cut</figcaption></figure></div>`)
    // Banding: 2x crop of the top-right glow above the panel.
    const glow = await sharp(coverFile).extract({ left: 1000, top: 0, width: 600, height: 118 }).resize(1200, 236, { kernel: 'nearest' }).png().toBuffer()
    section('Glow, top right, 2× (look for banding)', fig('data:image/png;base64,' + glow.toString('base64'), 'cover x 1000-1600, y 0-118'))
  }

  // Icons.
  const iconFile = fromPlugin(manifest.icon ?? spec.icon ?? 'images/icon.png')
  let icons = ''
  for (const bg of ['#08090a', '#f5f5f5']) {
    let row = ''
    for (const s of [64, 48, 16]) row += `<img class="px" src="${await tile(iconFile, s, bg)}" width="${s}" height="${s}">`
    for (const e of manifest.contributes?.customEditors ?? []) if (e.icon && fs.existsSync(fromPlugin(e.icon))) row += `<img class="px" title="${escHtml(e.icon)}" src="data:image/png;base64,${(await sharp(fromPlugin(e.icon)).resize(16, 16).png().toBuffer()).toString('base64')}" width="16" height="16">`
    icons += `<div class="icons" style="background:${bg}">${row}</div>`
  }
  section('Icon at 64, 48, 16 px in 25% tiles; editor icons at 16 px', icons)

  // Slides.
  const shots = (spec.screenshots ?? []).map((s, i) => ({ s, i, file: pick(s) })).filter((x) => x.file)
  if (shots.length) {
    let strip = ''
    let grid = ''
    for (const { i, file } of shots) {
      strip += fig(await thumb(file, 240, 150), `${i + 1}`)
      grid += fig(await thumb(file, 386, 241), `${i + 1}`)
    }
    section("Slides at 240 px (Orca's strip)", `<div class="row">${strip}</div>`)
    section("Slides at 386 px (orca.dev's grid)", `<div class="row wrap">${grid}</div>`)
    let big = ''
    for (const { s, i, file } of shots) {
      const r = results.find((x) => x.id === `shot-${i + 1}`)
      big += fig(await thumb(file, 1024, 640), `${i + 1}. ${s.headline} — alt (${Array.from(s.alt).length}): ${s.alt}` + (r?.bytes ? ` — ${(r.bytes / KB).toFixed(0)} KB` : ''))
    }
    section('Slides at 1024 px (lightbox)', `<div class="col">${big}</div>`)
  }

  // Family row: every plugin's current cover at 300 px, this one's new cover in its place.
  if (hubPlugins && fs.existsSync(hubPlugins)) {
    let fam = ''
    for (const name of fs.readdirSync(hubPlugins).sort()) {
      const own = path.resolve(hubPlugins, name) === path.resolve(pluginDir)
      const f = own ? coverFile : path.join(hubPlugins, name, 'images', 'cover.png')
      if (f && fs.existsSync(f)) fam += fig(await thumb(f, 300, 188), own ? `${name} (this build)` : name)
    }
    section('Family: current covers at 300 px', `<div class="row wrap">${fam}</div>`)
  }

  // Texts and findings.
  const lines = [
    `cover alt (${Array.from(spec.cover.alt).length}): ${spec.cover.alt}`,
    `tagline (${Array.from(spec.cover.tagline ?? '').length}): ${spec.cover.tagline}`,
    `chips: ${(spec.cover.chips ?? []).join(' · ')}`,
    ...results.flatMap((r) => r.stage ? [`${r.id}: stage ${r.ui?.viewport} @${r.ui?.scale}x, editor ${r.stage.editor}${r.stage.calls.length ? ', calls ' + r.stage.calls.join(', ') : ''}`] : []),
    ...results.flatMap((r) => r.warnings.map((w) => `warn ${r.id}: ${w}`)),
    ...(check ? [...check.facts, ...check.warnings.map((w) => `warn: ${w}`), ...check.errors.map((e) => `ERROR: ${e}`)] : []),
  ]
  section('Texts and findings', `<pre>${escHtml(lines.join('\n'))}</pre>`)

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px 28px 40px; width: max-content; min-width: 1700px; box-sizing: border-box; background: #08090a; color: #c9c9cf; font: 13px/1.45 -apple-system, system-ui, sans-serif; }
    h1 { font-size: 20px; color: #f5f5f7; margin: 0 0 8px; } h2 { font-size: 14px; color: #f5f5f7; margin: 22px 0 10px; font-weight: 600; }
    .row { display: flex; gap: 18px; align-items: flex-end; } .wrap { flex-wrap: wrap; } .col { display: flex; flex-direction: column; gap: 14px; }
    figure { margin: 0; } figcaption { margin-top: 6px; color: #8e8e96; max-width: 1024px; }
    .clip { position: relative; overflow: hidden; } .clip img { display: block; }
    .pill { position: absolute; border-radius: 999px; background: rgba(250, 250, 250, .92); }
    .zone { position: absolute; box-sizing: border-box; border: 2px solid; } .keep { border-color: #ef4444; } .aha { border-color: #22c55e; } .share { background: rgba(8, 9, 10, .55); border: 0; }
    .icons { display: inline-flex; gap: 20px; align-items: center; padding: 16px 22px; margin-right: 12px; border-radius: 10px; }
    img.px { image-rendering: auto; } pre { white-space: pre-wrap; color: #c9c9cf; font: 12px/1.5 ui-monospace, Menlo, monospace; margin: 0; }
  </style></head><body><h1>${escHtml(manifest.name)} — listing sheet</h1>${parts.join('')}</body></html>`
  const htmlPath = out.replace(/\.png$/, '.html')
  fs.writeFileSync(htmlPath, html)
  const context = await browser.newContext({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  try {
    await page.goto('file://' + htmlPath, { waitUntil: 'load' })
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))))
    const raw = out.replace(/\.png$/, '.raw.png')
    await page.screenshot({ path: raw, fullPage: true })
    await sharp(raw).removeAlpha().png({ compressionLevel: 9 }).toFile(out)
    fs.rmSync(raw)
  } finally {
    await context.close()
  }
}

/** Orca's capture and the stage's, side by side at scale 1, with a count of differing pixels. */
export async function writeParity({ orcaPng, stagePng, out }) {
  const a = await sharp(orcaPng).metadata()
  const b = await sharp(stagePng).metadata()
  const w = Math.min(a.width, b.width)
  const h = Math.min(a.height, b.height)
  const gap = 16
  const ra = await sharp(orcaPng).removeAlpha().extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer()
  const rb = await sharp(stagePng).removeAlpha().extract({ left: 0, top: 0, width: w, height: h }).raw().toBuffer()
  let diff = 0
  for (let i = 0; i < ra.length; i += 3) if (Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]) > 24) diff++
  await sharp({ create: { width: a.width + b.width + gap * 3, height: Math.max(a.height, b.height) + gap * 2, channels: 3, background: '#08090a' } })
    .composite([{ input: orcaPng, left: gap, top: gap }, { input: stagePng, left: a.width + gap * 2, top: gap }])
    .png().toFile(out)
  return { orca: `${a.width}x${a.height}`, stage: `${b.width}x${b.height}`, differingPixelsPct: Math.round((diff / (w * h)) * 1000) / 10 }
}
