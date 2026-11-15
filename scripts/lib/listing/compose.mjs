// Builds a plugin's listing images from its listing spec (tools/listing.json): stage capture of
// the real editor -> house-style template -> 1600x1000 PNG. Entry point: scripts/listing-image.sh.
//
//   node compose.mjs --plugin <dir> [--spec <listing.json>] [--work <dir>] [--dry-run]
//                    [--only cover|N] [--check] [--sheet] [--write-manifest] [--plain] [--palette]
//                    [--parity <file> --parity-orca <png>]
//
// --work     generated files (raw/, out/, sheet.png, report.json); default <plugin>/.orca/listing
// --dry-run  final PNGs go to <work>/out/ instead of the spec's `out` paths; the manifest is never written
// An image whose build has an error never reaches its `out` path: it goes to <work>/out/ instead.
// --write-manifest writes only when the build (and --check) passed and every image the manifest
// would list exists and meets Orca's image rules.
// Exit 0: every image built (and passed --check when given). Exit 1: a build, check or manifest failure.

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { createStage, launchChrome } from './stage.mjs'
import { budgetOf, budgetProblems, checkListing, listedImageProblems, planManifest, writeParity, writeSheet } from './check.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const W = 1600
const H = 1000
/** Cover: the visible UI window is 880x880 image px at (720, 120). Slides: 1440x804 at (80, 196). */
const COVER = { x: 720, y: 120, w: 880, h: 880, minScale: 1.6, scale: 2 }
const SLIDE = { x: 80, y: 196, w: 1440, h: 804, scale: 1.5, width: 960, height: 536 }
/** --plain: a bare capture; 1067x667 CSS at 1.5 covers 1600x1000, cropped to exactly that. */
const PLAIN = { width: 1067, height: 667, scale: 1.5 }

const log = (...a) => console.error(...a)
const fail = (msg) => {
  log(`error: ${msg}`)
  process.exit(1)
}

const { values: args } = parseArgs({
  options: {
    plugin: { type: 'string' },
    spec: { type: 'string' },
    work: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    only: { type: 'string' },
    check: { type: 'boolean', default: false },
    sheet: { type: 'boolean', default: false },
    'write-manifest': { type: 'boolean', default: false },
    plain: { type: 'boolean', default: false },
    palette: { type: 'boolean', default: false },
    parity: { type: 'string' },
    'parity-orca': { type: 'string' },
  },
})

if (!args.plugin) fail('--plugin <dir> is required')
const pluginDir = path.resolve(args.plugin)
const manifestPath = path.join(pluginDir, 'orca-plugin.json')
if (!fs.existsSync(manifestPath)) fail(`${pluginDir} has no orca-plugin.json`)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const work = path.resolve(args.work ?? path.join(pluginDir, '.orca', 'listing'))
const dryRun = args['dry-run']
const fromPlugin = (p) => (path.isAbsolute(p) ? p : path.join(pluginDir, p))

// ── Parity: the stage at scale 1 next to `orca plugin shot`'s capture (taken by the shell script) ──
if (args.parity) {
  if (!args['parity-orca']) fail('--parity needs --parity-orca <png> (scripts/listing-image.sh takes it)')
  const browser = await launchChrome()
  const stage = await createStage({ pluginDir, browser, log })
  try {
    const stageOut = path.join(work, 'parity-stage.png')
    const r = await stage.capture({ file: args.parity, out: stageOut, theme: 'dark', scale: 1, width: 960, height: 536 })
    const out = path.join(work, 'parity.png')
    const facts = await writeParity({ orcaPng: path.resolve(args['parity-orca']), stagePng: stageOut, out })
    console.log(JSON.stringify({ parity: out, ...facts, stageErrors: r.errors, unknown: r.unknown }, null, 2))
  } finally {
    await stage.close()
    await browser.close()
  }
  process.exit(0)
}

// ── Spec ──
const specPath = path.resolve(args.spec ?? path.join(pluginDir, 'tools', 'listing.json'))
if (!fs.existsSync(specPath)) fail(`no listing spec at ${specPath} (see scripts/lib/listing/README.md)`)
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
const specErrors = validateSpec(spec)
if (specErrors.length) fail(`listing spec ${specPath}:\n  - ${specErrors.join('\n  - ')}`)

const targets = [
  { id: 'cover', kind: 'cover', entry: spec.cover },
  ...spec.screenshots.map((entry, i) => ({ id: `shot-${i + 1}`, kind: 'shot', index: i, entry })),
]
let selected = targets
if (args.only) {
  selected = args.only === 'cover' ? targets.slice(0, 1) : targets.filter((t) => t.kind === 'shot' && String(t.index + 1) === args.only)
  if (!selected.length) fail(`--only ${args.only}: no such image (cover or 1..${spec.screenshots.length})`)
}
const workOutFor = (entry) => path.join(work, 'out', path.basename(entry.out))
const outPathFor = (entry) => (dryRun ? workOutFor(entry) : fromPlugin(entry.out))

const iconPath = fromPlugin(spec.icon ?? manifest.icon ?? 'images/icon.png')
if (!fs.existsSync(iconPath)) fail(`icon not found: ${iconPath}`)
const fontCss = path.join(here, 'node_modules', '@fontsource-variable', 'inter', 'opsz.css')
if (!fs.existsSync(fontCss)) fail(`${fontCss} is missing; run npm ci in ${here}`)
const css = fs.readFileSync(path.join(here, 'templates', 'listing.css'), 'utf8').replaceAll('{{fontCss}}', pathToUrl(fontCss))

fs.mkdirSync(path.join(work, 'raw'), { recursive: true })
fs.mkdirSync(path.join(work, 'out'), { recursive: true })

// ── Build ──
const results = []
let buildFailed = false
const browser = await launchChrome()
const stage = await createStage({ pluginDir, browser, log })
try {
  for (const t of selected) {
    const r = { id: t.id, kind: t.kind, entry: t.entry, out: outPathFor(t.entry), written: null, errors: [], warnings: [] }
    results.push(r)
    try {
      await buildOne(t, r)
    } catch (e) {
      r.errors.push(e.message)
      if (e.stageErrors?.length) r.errors.push(...e.stageErrors)
    }
    if (r.errors.length) buildFailed = true
    log(`${r.errors.length ? 'FAIL' : 'ok  '} ${t.id.padEnd(7)} ${r.written ? path.relative(process.cwd(), r.written) : '(no image)'}` +
      (r.bytes ? `  ${r.width}x${r.height}  ${(r.bytes / 1024).toFixed(0)} KB` : '') +
      (r.ui ? `  ui ${r.ui.width}x${r.ui.height} @${r.ui.scale}x` : ''))
    if (r.written && r.written !== r.out) log(`       not written to ${path.relative(pluginDir, r.out)}: the build failed, so the image went to the work folder`)
    for (const e of r.errors) log(`       error: ${e}`)
    for (const w of r.warnings) log(`       warn: ${w}`)
  }
} finally {
  await stage.close()
}

// ── Check, sheet, manifest ──
let checkFailed = false
let manifestFailed = false
const writeManifest = args['write-manifest']
const report = { plugin: pluginDir, spec: specPath, work, dryRun, plain: args.plain, results }
if (args.check) {
  const c = await checkListing({ pluginDir, spec, manifest, results, outPathFor, palette: args.palette, dryRun, writeManifest })
  report.check = c
  for (const f of c.facts) log(`  ${f}`)
  for (const w of c.warnings) log(`warn: ${w}`)
  for (const e of c.errors) log(`error: ${e}`)
  checkFailed = c.errors.length > 0
  log(checkFailed ? `check: FAILED (${c.errors.length} errors)` : `check: passed (${c.warnings.length} warnings)`)
}
if (args.sheet) {
  const sheet = path.join(work, 'sheet.png')
  // This run's image when it built one (also a failed one), else the one in place.
  const shownFor = (entry) => results.find((r) => r.entry === entry && r.written)?.written ?? outPathFor(entry)
  await writeSheet({ browser, pluginDir, spec, manifest, results, outPathFor: shownFor, out: sheet, hubPlugins: path.resolve(here, '..', '..', '..', 'plugins'), check: report.check })
  report.sheet = sheet
  log(`sheet: ${sheet}`)
}
await browser.close()
if (writeManifest) {
  const plan = planManifest({ pluginDir, manifest, spec })
  // Orca refuses the whole install when one listed image is missing or breaks its rules, so every
  // image the manifest would list must be in place, whether or not --check ran (--only included).
  const problems = listedImageProblems({ spec, fileFor: dryRun ? (e) => [outPathFor(e), fromPlugin(e.out)].find((f) => fs.existsSync(f)) ?? outPathFor(e) : (e) => fromPlugin(e.out), palette: args.palette })
  report.manifest = { unreferenced: plan.unreferenced, changed: plan.changed, problems }
  if (dryRun) {
    const preview = path.join(work, 'orca-plugin.preview.json')
    fs.writeFileSync(preview, plan.text)
    log(`manifest: dry run, not written; preview in ${preview}`)
    for (const p of problems) log(`warn: manifest preview: ${p}`)
  } else if (buildFailed || checkFailed || problems.length) {
    manifestFailed = true
    log(`manifest: not written, ${buildFailed || checkFailed ? 'the build or the check failed' : 'a listed image is missing or invalid'}`)
    for (const p of problems) log(`error: manifest: ${p}`)
  } else {
    fs.writeFileSync(manifestPath, plan.text)
    log(`manifest: ${plan.changed ? 'cover and screenshots rewritten' : 'already up to date'} in ${manifestPath}`)
  }
  for (const f of plan.unreferenced) log(`  unreferenced image (delete it yourself if it is obsolete): ${f}`)
}
fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 2) + '\n')
process.exit(buildFailed || checkFailed || manifestFailed ? 1 : 0)

// ────────────────────────────────────────────────────────────────────────────────────────────────

async function buildOne(t, r) {
  const e = t.entry
  const st = e.stage
  const raw = path.join(work, 'raw', `${t.id}.png`)
  const plain = args.plain && t.kind === 'shot'
  let scale, width, height, win, origin
  if (t.kind === 'cover') {
    scale = st.scale ?? COVER.scale
    if (scale < COVER.minScale) throw new Error(`cover scale ${scale} is below the minimum ${COVER.minScale}`)
    origin = { x: st.origin?.x ?? 0, y: st.origin?.y ?? 0 }
    win = { w: COVER.w, h: COVER.h }
    width = st.width ?? Math.ceil(origin.x + COVER.w / scale)
    height = st.height ?? Math.ceil(origin.y + COVER.h / scale)
  } else if (plain) {
    ;({ scale, width, height } = PLAIN)
    origin = { x: 0, y: 0 }
    win = { w: W, h: H }
  } else {
    scale = st.scale ?? SLIDE.scale
    origin = { x: st.origin?.x ?? 0, y: st.origin?.y ?? 0 }
    win = { w: SLIDE.w, h: SLIDE.h }
    width = st.width ?? SLIDE.width
    height = st.height ?? SLIDE.height
  }
  const left = Math.round(origin.x * scale)
  const top = Math.round(origin.y * scale)

  const cap = await stage.capture({
    file: st.file, out: raw, theme: st.theme ?? 'dark', scale, width, height, act: st.act ?? [],
    waitFor: st.waitFor, saveAs: st.saveAs, editor: st.editor, readOnly: st.readOnly, settleMs: st.settleMs,
  })
  r.stage = cap
  r.ui = { width: win.w, height: win.h, scale, viewport: `${width}x${height}`, origin }
  for (const m of cap.errors) r.errors.push(`stage: ${m}`)
  for (const m of cap.unknown) r.errors.push(`stage: the editor touched orca.${m.replace(/^orca\./, '')}, which the stage does not provide`)
  for (const m of cap.warnings) r.warnings.push(`stage: ${m}`)

  const meta = await sharp(raw).metadata()
  if (meta.width - left < win.w || meta.height - top < win.h) {
    throw new Error(`the capture (${meta.width}x${meta.height} px) is smaller than origin (${origin.x}, ${origin.y}) ` +
      `plus the ${win.w}x${win.h} px window: make the stage viewport at least ` +
      `${Math.ceil(origin.x + win.w / scale)}x${Math.ceil(origin.y + win.h / scale)} CSS px`)
  }
  const crop = path.join(work, 'raw', `${t.id}.ui.png`)
  await sharp(raw).extract({ left, top, width: win.w, height: win.h }).png().toFile(crop)

  let composed
  if (plain) {
    composed = crop
  } else {
    composed = path.join(work, 'raw', `${t.id}.composed.png`)
    const metrics = await render(t, crop, composed)
    r.layout = metrics
    for (const m of layoutProblems(t.kind, metrics)) r.errors.push(`layout: ${m}`)
    // The UI must land unresampled: compare a block well inside the panel with the crop itself.
    const diff = await samePixels(composed, crop, t.kind === 'cover' ? COVER : SLIDE)
    r.uiPixelsIdentical = diff === 0
    if (diff !== 0) r.errors.push(`the UI was resampled or shifted in the panel (${diff} differing pixels)`)
  }

  const png = await encode(composed, args.palette)
  const outMeta = await sharp(png).metadata()
  r.width = outMeta.width
  r.height = outMeta.height
  r.bytes = png.length
  r.rawBytes = fs.statSync(composed).size
  if (r.width !== W || r.height !== H) r.errors.push(`${r.width}x${r.height}, not ${W}x${H}`)
  const maxBytes = budgetOf(spec).imageBytes
  if (r.bytes > maxBytes) {
    r.errors.push(`${(r.bytes / 1024).toFixed(0)} KB is over the ${maxBytes / 1024} KB budget: choose a calmer UI state or crop` +
      (args.palette ? '' : ' (--palette only after looking at the glow crop on the sheet)'))
  }
  // Only a clean build replaces the image in the plugin; a failed one stays in the work folder.
  const out = r.errors.length ? workOutFor(e) : outPathFor(e)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, png)
  r.written = out
}

/**
 * 8-bit RGB PNG, no alpha, no metadata. Lossless by default: both filter strategies, the smaller
 * wins. Careful: in sharp, `png({ effort })` or `png({ quality })` silently switch to a palette.
 */
async function encode(file, palette) {
  const img = () => sharp(file).removeAlpha().toColourspace('srgb')
  if (palette) return img().png({ palette: true, quality: 95, dither: 1, effort: 10, compressionLevel: 9 }).toBuffer()
  const tries = await Promise.all([true, false].map((adaptiveFiltering) => img().png({ compressionLevel: 9, adaptiveFiltering, palette: false }).toBuffer()))
  return tries.sort((a, b) => a.length - b.length)[0]
}

/** Fills the template, renders 1600x1000 at device scale 1, and measures the layout. */
async function render(t, uiPng, out) {
  const e = t.entry
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const fill = (tpl, map) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in map)) throw new Error(`template placeholder {{${k}}} has no value`)
    return map[k]
  })
  const common = { css, accent: esc(spec.accent), icon: esc(pathToUrl(iconPath)), ui: esc(pathToUrl(uiPng)) }
  let html
  if (t.kind === 'cover') {
    const chips = (e.chips ?? []).map((c, i) => `<span class="chip${i === (e.chipMain ?? 0) ? ' main' : ''}">${esc(c)}</span>`).join('')
    html = fill(fs.readFileSync(path.join(here, 'templates', 'cover.html'), 'utf8'), {
      ...common, title1: esc(spec.title[0]), title2: esc(spec.title[1] ?? ''), tagline: esc(e.tagline), chips,
    })
  } else {
    html = fill(fs.readFileSync(path.join(here, 'templates', 'shot.html'), 'utf8'), { ...common, headline: esc(e.headline) })
  }
  const htmlPath = path.join(work, 'raw', `${t.id}.html`)
  fs.writeFileSync(htmlPath, html)
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'dark' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (er) => errors.push(er.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('requestfailed', (q) => errors.push(`${q.url()}: ${q.failure()?.errorText}`))
  try {
    await page.goto(pathToUrl(htmlPath), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())))
    const metrics = await page.evaluate(measure, t.kind)
    if (!metrics.fontLoaded) errors.push('Inter did not load')
    await page.screenshot({ path: out })
    if (errors.length) throw new Error(`template: ${errors.join('; ')}`)
    return metrics
  } finally {
    await context.close()
  }
}

/** Runs in the template page. */
function measure(kind) {
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom }
  }
  // Area covered by text: the client rects of every text line (not the boxes around them).
  const textRects = (root) => {
    const rects = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) rects.push({ x: r.x, y: r.y, w: r.width, h: r.height })
    }
    return rects
  }
  const ui = document.getElementById('ui')
  const uiRect = rect(ui)
  const m = {
    fontLoaded: document.fonts.check('760 112px "Inter Variable"') && [...document.fonts].some((f) => f.status === 'loaded'),
    ui: { naturalWidth: ui.naturalWidth, naturalHeight: ui.naturalHeight, clientWidth: ui.clientWidth, clientHeight: ui.clientHeight, x: uiRect.x, y: uiRect.y },
  }
  if (kind === 'cover') {
    const tagline = document.getElementById('tagline')
    const lh = parseFloat(getComputedStyle(tagline).lineHeight)
    const chips = [...document.querySelectorAll('.chip')].map(rect)
    const rows = new Set(chips.map((c) => Math.round(c.y))).size
    const texts = [...textRects(document.getElementById('title')), ...textRects(tagline), ...chips]
    m.left = rect(document.getElementById('left'))
    m.title1 = rect(document.getElementById('title1'))
    m.title2 = rect(document.getElementById('title2'))
    m.taglineLines = Math.round(rect(tagline).h / lh)
    m.chipRows = rows
    m.textAreaPct = Math.round((texts.reduce((a, r) => a + r.w * r.h, 0) / (1600 * 1000)) * 1000) / 10
    m.keepOut = texts.filter((r) => r.x < 560 && r.y < 240).length
    m.icon = rect(document.getElementById('icon'))
  } else {
    const h = document.getElementById('headline')
    m.headline = rect(h)
    m.headlineLines = Math.round(m.headline.h / (parseFloat(getComputedStyle(h).fontSize) * 1.25))
    m.icon = rect(document.getElementById('icon'))
  }
  return m
}

function layoutProblems(kind, m) {
  const p = []
  const u = m.ui
  if (u.naturalWidth !== u.clientWidth || u.naturalHeight !== u.clientHeight) p.push(`UI image drawn at ${u.clientWidth}x${u.clientHeight}, natural ${u.naturalWidth}x${u.naturalHeight}`)
  if (!Number.isInteger(u.x) || !Number.isInteger(u.y)) p.push(`UI image at a fractional position (${u.x}, ${u.y})`)
  if (kind === 'cover') {
    if (m.title1.w > 600 || m.title2.w > 600) p.push(`a title line is wider than the 600 px column (${Math.round(Math.max(m.title1.w, m.title2.w))} px)`)
    if (m.taglineLines > 2) p.push(`the tagline takes ${m.taglineLines} lines (at most 2)`)
    if (m.left.bottom > H - 96) p.push(`the left column ends at y ${Math.round(m.left.bottom)}, less than 96 px from the bottom`)
    if (m.textAreaPct > 22) p.push(`text covers ${m.textAreaPct}% of the cover (at most 22%)`)
    if (m.keepOut) p.push('text inside the keep-out box (x < 560, y < 240)')
  } else {
    if (m.headline.right > W - 96) p.push(`the headline ends at x ${Math.round(m.headline.right)}, past the 96 px margin`)
    if (m.headlineLines > 1) p.push('the headline wraps')
  }
  return p
}

/** Counts differing pixels between the composed image and the UI crop, in a block inside the panel. */
async function samePixels(composedPng, uiPng, box) {
  const inset = 24
  const w = Math.min(box.w, W - box.x) - inset * 2
  const h = Math.min(box.h, H - box.y) - inset * 2
  const a = await sharp(composedPng).removeAlpha().extract({ left: box.x + inset, top: box.y + inset, width: w, height: h }).raw().toBuffer()
  const b = await sharp(uiPng).removeAlpha().extract({ left: inset, top: inset, width: w, height: h }).raw().toBuffer()
  let diff = 0
  for (let i = 0; i < a.length; i += 3) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++
  return diff
}

function validateSpec(s) {
  const e = []
  const str = (v) => typeof v === 'string' && v.length > 0
  if (!/^#[0-9a-fA-F]{6}$/.test(s.accent ?? '')) e.push('accent must be a #rrggbb colour')
  if (!Array.isArray(s.title) || !str(s.title[0])) e.push('title must be ["<word>", "Viewer"]')
  if (!s.cover || typeof s.cover !== 'object') e.push('cover is missing')
  if (!Array.isArray(s.screenshots)) e.push('screenshots must be an array (may be empty)')
  const entries = [['cover', s.cover], ...(s.screenshots ?? []).map((x, i) => [`screenshots[${i}]`, x])]
  e.push(...budgetProblems(s))
  for (const [name, x] of entries) {
    if (!x) continue
    if (!str(x.out) || !/\.png$/.test(x.out)) e.push(`${name}.out must be a .png path`)
    if (!str(x.alt)) e.push(`${name}.alt is missing`)
    if (!x.stage || !str(x.stage.file)) e.push(`${name}.stage.file is missing`)
    if ('caption' in x || 'theme' in x) e.push(`${name}: no caption or theme fields (the stage's theme goes in stage.theme)`)
    if (name === 'cover' && !str(x.tagline)) e.push('cover.tagline is missing')
    if (name !== 'cover' && !str(x.headline)) e.push(`${name}.headline is missing`)
    for (const [i, a] of (x.stage?.act ?? []).entries()) if (typeof a !== 'object' || !a) e.push(`${name}.stage.act[${i}] must be an object`)
  }
  return e
}

function pathToUrl(p) {
  return 'file://' + path.resolve(p).split(path.sep).map(encodeURIComponent).join('/')
}
