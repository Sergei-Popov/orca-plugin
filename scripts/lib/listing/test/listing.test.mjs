// Tests of the listing tool on a synthetic plugin built in a temp folder (no fixtures on disk).
// macOS with Google Chrome only, like the tool: `npm test` in scripts/lib/listing.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { CHROME, createStage, launchChrome } from '../stage.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(here, '..', '..', '..', 'listing-image.sh')
const skip = process.platform !== 'darwin' || !fs.existsSync(CHROME) ? 'needs macOS and Google Chrome' : false

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'listing-test-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

// The editor reacts to the demo file's first word; see the samples below.
const EDITOR = `
const root = document.getElementById('root')!
document.documentElement.style.background = '#16181d'
root.innerHTML = '<p id="t" style="color:#eee;font:16px system-ui;margin:24px">ready</p>' +
  '<a id="lnk" href="#">link</a> <a id="blank" target="_blank" href="#">blank</a> <button id="btn">btn</button>'
const doc = await orca.document.get()
const text = (doc.content as { text: string }).text.trim()
const [word, arg] = text.split(' ')
root.querySelector('#t')!.textContent = 'Synthetic ' + word
orca.on('theme', () => {})
JSON.stringify(orca.api)
if (word === 'reject') Promise.reject(new Error('unhandled rejection in editor'))
if (word === 'on') orca.on('workspace.changed', () => {})
if (word === 'api') void (orca.api as unknown as Record<string, unknown>).nope
if (word === 'session') void (orca.document as unknown as Record<string, unknown>).session
if (word === 'nav') (root.querySelector('#lnk') as HTMLAnchorElement).href = arg
if (word === 'blank') (root.querySelector('#blank') as HTMLAnchorElement).href = arg
if (word === 'open') root.querySelector('#btn')!.addEventListener('click', () => { window.open(arg) })
if (word === 'img') { const i = new Image(); i.src = arg; root.append(i) }
`

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

/** A plugin folder whose manifest still has caption/theme, with a full-bleed 256 px icon. */
async function makePlugin(name, { images = false } = {}) {
  const dir = path.join(tmp, name)
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'samples'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'src', 'editor.ts'), EDITOR)
  for (const w of ['plain', 'reject', 'on', 'api', 'session', 'wait']) fs.writeFileSync(path.join(dir, 'samples', `${w}.syn`), w)
  await sharp({ create: { width: 256, height: 256, channels: 4, background: '#3b82f6' } }).png().toFile(path.join(dir, 'images', 'icon.png'))
  if (images) {
    for (const f of ['cover.png', 'shot-1-a.png']) {
      await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#202020' } }).png().toFile(path.join(dir, 'images', f))
    }
  }
  const manifest = {
    manifestVersion: 2, id: `syn-${name}`, name: 'Synthetic', version: '0.0.1', icon: 'images/icon.png',
    cover: { path: 'images/cover.png', alt: 'Old cover.', caption: 'Old', theme: 'dark' },
    screenshots: [{ path: 'images/shot-1-a.png', alt: 'Old shot.', theme: 'dark' }],
    contributes: { customEditors: [{ id: 'syn', title: 'Syn', extensions: ['.syn'], entry: 'src/editor.ts', contentKind: 'text', frame: 'isolated' }] },
  }
  fs.writeFileSync(path.join(dir, 'orca-plugin.json'), JSON.stringify(manifest, null, 2) + '\n')
  const spec = {
    accent: '#3B82F6', title: ['Synth', 'Viewer'], icon: 'images/icon.png',
    cover: { out: 'images/cover.png', alt: 'A synthetic editor on a plain file.', tagline: 'A synthetic tagline.', chips: ['.syn'], stage: { file: 'samples/plain.syn', width: 440, height: 440 } },
    screenshots: [{ out: 'images/shot-1-a.png', headline: 'One synthetic slide', alt: 'The synthetic editor showing its file.', stage: { file: 'samples/plain.syn' } }],
  }
  const specPath = path.join(tmp, `${name}.listing.json`)
  fs.writeFileSync(specPath, JSON.stringify(spec, null, 2))
  return { dir, specPath, spec, work: path.join(tmp, `${name}-work`) }
}

function run(args, opts = {}) {
  const r = spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8', timeout: 180_000, ...opts })
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` }
}

describe('listing-image.sh', { skip }, () => {
  test('replays a real SDK panel with its worker, tooltip provider and input before composing', {
    skip: !fs.existsSync(process.env.ORCA_APP_PATH ?? '/Applications/Orca.app') && 'needs the installed Orca replay renderer',
  }, async () => {
    const p = await makePlugin('native')
    const manifestPath = path.join(p.dir, 'orca-plugin.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath))
    Object.assign(manifest, { main: 'src/worker.ts', execution: 'trusted-worker', pluginApi: 1, capabilities: [{ kind: 'storage:own' }] })
    manifest.contributes.panels = [{ id: 'report', title: 'Report', ui: 'components', entry: 'src/panel.tsx' }]
    fs.writeFileSync(manifestPath, JSON.stringify(manifest))
    const source = (name, text) => fs.writeFileSync(path.join(p.dir, 'src', name), text)
    source('worker.ts', `export default function activate(orca) {
      orca.panels.handle('report.title', () => orca.storage.get('title'))
    }`)
    source('panel.check.ts', `import { defineCheck } from 'orca/testing'
      export default defineCheck({ seeded: { storage: { title: 'April totals' } } })`)
    source('panel.tsx', `import { atom, Button, Heading, IconButton, Input, plugin, read, set, Stack, Text } from 'orca'
      const title = atom(''), draft = atom(''), summary = atom('')
      function refresh() { return plugin.request('report.title').then((t) => set(title, t)) }
      export function setup() { void refresh() }
      export default function Panel() {
        return <Stack><Heading>{read(title)}</Heading>
          <IconButton label="Refresh" icon="refresh" onPress={refresh} />
          <Input label="Filter" value={read(draft)} onChange={(v) => set(draft, v)} />
          <Button onPress={() => set(summary, 'Selected ' + read(draft))}>Prepare</Button>
          <Text>{read(summary)}</Text></Stack>
      }`)
    const stage = { panel: 'report', scenario: 'seeded' }
    p.spec.cover.stage = { ...stage, waitFor: { text: 'April totals' } }
    p.spec.screenshots[0].stage = {
      ...stage, act: [{ type: { label: 'Filter' }, text: 'invoices', replace: true }, { press: { text: 'Prepare' } }],
      waitFor: { text: 'Selected invoices' },
    }
    fs.writeFileSync(p.specPath, JSON.stringify(p.spec))
    const args = [p.dir, '--spec', p.specPath, '--out-dir', p.work]
    const build = run([...args, '--check', '--sheet', '--write-manifest'])
    assert.equal(build.status, 0, build.out)
    const report = JSON.parse(fs.readFileSync(path.join(p.work, 'report.json')))
    assert.ok(fs.existsSync(report.sheet))
    for (const frame of report.results) {
      assert.equal(frame.stage.panel, 'report')
      assert.equal(frame.stage.scenario, 'seeded')
      assert.ok(frame.stage.calls.includes('storage.get'))
      assert.deepEqual(frame.errors, [])
      assert.equal(frame.uiPixelsIdentical, true)
      assert.deepEqual([frame.width, frame.height], [1600, 1000])
    }
    const cover = path.join(p.dir, p.spec.cover.out)
    const before = [sha(cover), sha(manifestPath)]
    p.spec.cover.stage.scenario = 'missing'
    fs.writeFileSync(p.specPath, JSON.stringify(p.spec))
    const failed = run([...args, '--only', 'cover', '--write-manifest'])
    assert.equal(failed.status, 1, failed.out)
    assert.match(failed.out, /no scenario "missing"/)
    assert.deepEqual([sha(cover), sha(manifestPath)], before)
  })

  test('--check --write-manifest rewrites a manifest that still has caption/theme', async () => {
    const p = await makePlugin('write-manifest')
    const r = run([p.dir, '--spec', p.specPath, '--out-dir', p.work, '--check', '--write-manifest'])
    assert.equal(r.status, 0, r.out)
    const m = JSON.parse(fs.readFileSync(path.join(p.dir, 'orca-plugin.json'), 'utf8'))
    assert.deepEqual(m.cover, { path: 'images/cover.png', alt: p.spec.cover.alt })
    assert.deepEqual(m.screenshots, [{ path: 'images/shot-1-a.png', alt: p.spec.screenshots[0].alt }])
    for (const f of ['cover.png', 'shot-1-a.png']) assert.equal((await sharp(path.join(p.dir, 'images', f)).metadata()).width, 1600)
    // A second check of the rewritten manifest passes without --write-manifest.
    const again = run([p.dir, '--spec', p.specPath, '--out-dir', p.work, '--check', '--only', 'cover'])
    assert.equal(again.status, 0, again.out)
  })

  test('a failed build leaves images/ alone and keeps its image in the work folder', async () => {
    const p = await makePlugin('failed-build', { images: true })
    p.spec.cover.stage.file = 'samples/reject.syn'
    fs.writeFileSync(p.specPath, JSON.stringify(p.spec))
    const before = sha(path.join(p.dir, 'images', 'cover.png'))
    const r = run([p.dir, '--spec', p.specPath, '--out-dir', p.work, '--only', 'cover', '--write-manifest'])
    assert.equal(r.status, 1, r.out)
    assert.match(r.out, /unhandled rejection in editor/)
    assert.match(r.out, /manifest: not written/)
    assert.equal(sha(path.join(p.dir, 'images', 'cover.png')), before)
    assert.ok(fs.existsSync(path.join(p.work, 'out', 'cover.png')), 'the failed image is kept in <out-dir>/out')
  })

  test('--write-manifest refuses to list images that do not exist', async () => {
    const p = await makePlugin('missing-images')
    const before = sha(path.join(p.dir, 'orca-plugin.json'))
    const r = run([p.dir, '--spec', p.specPath, '--out-dir', p.work, '--only', 'cover', '--write-manifest'])
    assert.equal(r.status, 1, r.out)
    assert.match(r.out, /images\/shot-1-a\.png \(shot-1\): missing/)
    assert.equal(sha(path.join(p.dir, 'orca-plugin.json')), before)
  })

  test('--parity passes one absolute path to orca plugin shot and to the stage', async () => {
    const p = await makePlugin('parity')
    const fakeDir = path.join(tmp, 'fake-orca')
    fs.mkdirSync(fakeDir, { recursive: true })
    const shot = path.join(fakeDir, 'shot.png')
    await sharp({ create: { width: 960, height: 536, channels: 3, background: '#16181d' } }).png().toFile(shot)
    const argsLog = path.join(fakeDir, 'args.txt')
    const fake = path.join(fakeDir, 'orca')
    // Records its arguments and writes the PNG named by --out, like `orca plugin shot`.
    fs.writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${argsLog}"\nwhile [[ $# -gt 0 ]]; do [[ "$1" == --out ]] && cp "${shot}" "$2"; shift; done\n`, { mode: 0o755 })
    const env = { ...process.env, ORCA_CLI_COMMAND: fake, LISTING_PARITY_OK: '1' }
    const want = path.join(fs.realpathSync(p.dir), 'samples', 'plain.syn')
    // Plugin-relative from an unrelated cwd, then cwd-relative from the plugin's parent.
    for (const [cwd, file] of [[fakeDir, 'samples/plain.syn'], [tmp, path.join(path.basename(p.dir), 'samples', 'plain.syn')]]) {
      const r = run([p.dir, '--out-dir', p.work, '--parity', file], { cwd, env })
      assert.equal(r.status, 0, r.out)
      const args = fs.readFileSync(argsLog, 'utf8').split('\n')
      assert.equal(fs.realpathSync(args[args.indexOf('--editor') + 1]), want)
      assert.ok(fs.existsSync(path.join(p.work, 'parity.png')))
    }
    const missing = run([p.dir, '--out-dir', p.work, '--parity', 'samples/nope.syn'], { cwd: fakeDir, env })
    assert.equal(missing.status, 1)
    assert.match(missing.out, /not found/)
  })
})

describe('stage', { skip }, () => {
  let browser, stage, plugin, outside
  const hits = []
  before(async () => {
    plugin = await makePlugin('stage')
    fs.writeFileSync(path.join(tmp, 'outside-secret.txt'), 'secret-outside')
    fs.symlinkSync(path.join(tmp, 'outside-secret.txt'), path.join(plugin.dir, 'src', 'link-out.txt'))
    // Stands in for the internet: the stage must never reach it.
    outside = http.createServer((req, res) => { hits.push(req.url); res.end('<p>outside</p>') })
    await new Promise((r) => outside.listen(0, '127.0.0.1', r))
    browser = await launchChrome()
    stage = await createStage({ pluginDir: plugin.dir, browser })
  })
  after(async () => {
    await stage?.close()
    await browser?.close()
    outside?.close()
  })
  const OUT = () => `http://localhost:${outside.address().port}`
  const capture = (name, text, extra = {}) => {
    if (text !== undefined) fs.writeFileSync(path.join(plugin.dir, 'samples', `${name}.syn`), text)
    return stage.capture({ file: `samples/${name}.syn`, out: path.join(plugin.work, `${name}.png`), scale: 1, width: 400, height: 200, timeoutMs: 15_000, ...extra })
  }
  const get = (urlPath, host) => new Promise((resolve, reject) => {
    const { port } = new URL(stage.origin)
    const s = net.connect(Number(port), '127.0.0.1', () => s.write(`GET ${urlPath} HTTP/1.1\r\nHost: ${host ?? `127.0.0.1:${port}`}\r\nConnection: close\r\n\r\n`))
    let b = ''
    s.on('data', (d) => (b += d))
    s.on('end', () => resolve({ status: Number(b.split(' ')[1]), body: b.split('\r\n\r\n').slice(1).join('') }))
    s.on('error', reject)
  })

  test('serves only real files inside the plugin folder, and only to its own Host', async () => {
    const running = capture('wait', undefined, { act: [{ wait: 1500 }] }) // the server answers 503 between captures
    await new Promise((r) => setTimeout(r, 700))
    assert.equal((await get('/src/editor.ts')).status, 200)
    assert.equal((await get('/src/editor.ts', 'evil.example:80')).status, 421)
    const link = await get('/src/link-out.txt')
    assert.equal(link.status, 404)
    assert.doesNotMatch(link.body, /secret-outside/)
    for (const u of ['/../outside-secret.txt', '/%2e%2e/outside-secret.txt', '/..%2foutside-secret.txt', '/src/..%2f..%2foutside-secret.txt']) {
      assert.equal((await get(u)).status, 404, u)
    }
    await running
  })

  test('a link to another origin does not navigate and fails the build', async () => {
    const r = await capture('nav', `nav ${OUT()}/nav-click`, { act: [{ clickText: 'link' }, { wait: 500 }] })
    assert.ok(r.errors.some((e) => /blocked a navigation/.test(e)), JSON.stringify(r.errors))
  })

  test('window.open and target=_blank links open nothing and fail the build', async () => {
    const r = await capture('open', `open ${OUT()}/popup`, { act: [{ clickText: 'btn' }, { wait: 500 }] })
    assert.ok(r.errors.some((e) => /blocked window\.open/.test(e)), JSON.stringify(r.errors))
    const b = await capture('blank', `blank ${OUT()}/blank`, { act: [{ clickText: 'blank' }, { wait: 800 }] })
    assert.ok(b.errors.some((e) => /popup|network: blocked/.test(e)), JSON.stringify(b.errors))
  })

  test('an image from another origin is refused', async () => {
    const r = await capture('img', `img ${OUT()}/img.png`, { act: [{ wait: 300 }] })
    assert.ok(r.errors.length > 0)
  })

  test('nothing reached the outside server', () => {
    assert.deepEqual(hits, [])
  })

  test('records orca.on for unknown events, orca.api.* and document.session', async () => {
    assert.deepEqual((await capture('plain')).unknown, [])
    assert.deepEqual((await capture('on')).unknown, ["orca.on('workspace.changed')"])
    assert.deepEqual((await capture('api')).unknown, ['orca.api.nope'])
    assert.deepEqual((await capture('session')).unknown, ['orca.document.session'])
  })
})

describe('budget exception', () => {
  test('a documented spec budget raises the per-image limit, within the caps', async () => {
    const { budgetOf, budgetProblems, listedImageProblems, BUDGET_CAPS } = await import('../check.mjs')
    // A 1600x1000 RGB image whose noise block makes it a little over 400 KB, built in code.
    const side = 380
    const noise = Buffer.alloc(side * side * 3)
    let x = 2463534242
    for (let i = 0; i < noise.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; noise[i] = x & 255 }
    const file = path.join(tmp, 'heavy.png')
    await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#101010' } })
      .composite([{ input: noise, raw: { width: side, height: side, channels: 3 }, left: 600, top: 300 }])
      .removeAlpha().png({ compressionLevel: 9 }).toFile(file)
    const kb = fs.statSync(file).size / 1024
    assert.ok(kb > 400 && kb < BUDGET_CAPS.imageKB, `precondition: ${kb.toFixed(0)} KB`)
    const spec = { cover: { out: 'heavy.png' }, screenshots: [] }
    const fileFor = () => file
    assert.deepEqual(listedImageProblems({ spec, fileFor }), [`heavy.png (cover): ${kb.toFixed(0)} KB is over the 400 KB budget`])
    const withBudget = { ...spec, budget: { imageKB: BUDGET_CAPS.imageKB, totalKB: 2300, reason: 'photo content cannot be lossless within 400 KB' } }
    assert.deepEqual(budgetProblems(withBudget), [])
    assert.deepEqual(listedImageProblems({ spec: withBudget, fileFor }), [])
    assert.equal(budgetOf(withBudget).totalBytes, 2300 * 1024)
    // Out-of-range values, a missing reason and unknown fields are refused.
    assert.equal(budgetProblems({ budget: { imageKB: 900, totalKB: 9000, reason: 'x', extra: 1 } }).length, 4)
    assert.deepEqual(budgetOf({}).imageBytes, 400 * 1024)
  })
})
