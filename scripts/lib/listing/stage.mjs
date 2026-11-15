// The stage: renders a plugin's real custom editor outside Orca, in headless Google Chrome at any
// device scale, as Orca 1.4.258 would show it in an isolated guest frame.
//
// - A local HTTP server whose root is the plugin folder. Every response carries Orca's guest CSP,
//   so whatever Orca would block fails here too instead of ending up in an image. `.ts` (and
//   extensionless imports that resolve to `.ts`/`.js`/`index.ts`) is transpiled by esbuild.
// - The guest document copies Orca's `buildPluginGuestShellHtml`: `<html class="dark|light">`, the
//   design tokens on `:root` in `<style id="orca-design-tokens">`, the frame API, then the editor
//   entry exactly as Orca's main process wraps a `.ts` entry.
// - `window.orca` stands in for the part of the frame API the plugins use: api, locale, document,
//   on('theme'), files.saveAs, shell.openExternal. Any other `orca.*` member, and `orca.on` for any
//   other event, is recorded and fails the build after the capture (not at access time: plugins
//   feature-detect with `?.`).
// - Nothing leaves 127.0.0.1: every request to another origin is aborted, and, as Orca's main
//   process fences an isolated guest, cross-document navigation and `window.open` do nothing.
//   Each attempt fails the build, naming the URL.
// - The server answers only `Host: 127.0.0.1:<port>` and serves only files whose real path is
//   inside the plugin folder (no symlinks out of it).
// - Acts are input only (mouse, keyboard, select, fill), never DOM edits.
//
// Values (tokens, CSP, entry HTML, document payload) come from orca-frame.json; see its `sources`.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
export const FRAME = JSON.parse(fs.readFileSync(path.join(here, 'orca-frame.json'), 'utf8'))
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// --mute-audio: never play sound. Google Chrome (unlike Chromium) decodes H.264.
export const CHROME_ARGS = ['--mute-audio', '--hide-scrollbars', '--force-color-profile=srgb']

export async function launchChrome() {
  const { chromium } = await import('playwright-core')
  if (!fs.existsSync(CHROME)) throw new Error(`Google Chrome not found at ${CHROME}`)
  return chromium.launch({ executablePath: CHROME, headless: true, args: CHROME_ARGS })
}

const MIME = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
}

/** The custom editor Orca would pick for a file: the longest matching extension wins. */
export function pickEditor(manifest, file, editorId) {
  const editors = manifest.contributes?.customEditors ?? []
  if (editorId) {
    const editor = editors.find((e) => e.id === editorId)
    if (!editor) throw new Error(`no custom editor "${editorId}" in the manifest`)
    const ext = (editor.extensions ?? []).filter((x) => file.toLowerCase().endsWith(x.toLowerCase())).sort((a, b) => b.length - a.length)[0]
    return { editor, ext: ext ?? path.extname(file) }
  }
  let best = null
  for (const editor of editors) {
    for (const ext of editor.extensions ?? []) {
      if (file.toLowerCase().endsWith(ext.toLowerCase()) && (!best || ext.length > best.ext.length)) best = { editor, ext }
    }
    for (const name of editor.filenames ?? []) {
      if (path.basename(file).toLowerCase() === name.toLowerCase() && !best) best = { editor, ext: path.extname(file) }
    }
  }
  if (!best) throw new Error(`no custom editor of this plugin opens ${path.basename(file)}`)
  return best
}

/** The guest document Orca serves for an editor entry (buildPluginGuestShellHtml + main's entry HTML). */
function guestHtml({ theme, entryBase, standIn }) {
  const tokens = Object.entries(FRAME.tokens[theme]).map(([k, v]) => `--orca-${k.slice(2)}:${v}`).join(';')
  const pluginHtml = FRAME.editorEntryHtml.replace('{basename}', encodeURIComponent(entryBase))
  return `<!doctype html>\n<html class="${theme}">\n<head>\n<meta charset="utf-8">\n` +
    `<style id="${FRAME.tokensStyleId}">:root{${tokens}}</style>\n` +
    `<script>\n'use strict'\n${standIn}</script>\n</head>\n${pluginHtml}`
}

/** The frame-API stand-in, run before any plugin code (like Orca's frameApiScript). */
function standInScript(cfg) {
  return `;(function (C) {
  var unknown = new Set()
  var calls = []
  var listeners = new Map()
  var latest = null
  var waiting = []
  var subscribed = false
  window.__stage = { unknown: unknown, calls: calls, ready: false, get subscribed() { return subscribed } }
  // Orca's main process fences an isolated guest: a cross-document navigation is cancelled and
  // window.open is denied (returns null). The stage does the same and reports each attempt.
  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', function (event) {
      if (event.destination && event.destination.sameDocument) return
      if (event.cancelable) event.preventDefault()
      console.error('[stage] blocked a navigation to ' + (event.destination && event.destination.url) + ': Orca keeps an editor on its document')
    })
  }
  try {
    Object.defineProperty(window, 'open', {
      value: function (url) { console.error('[stage] blocked window.open(' + String(url) + '): Orca denies popups'); return null },
      writable: false, configurable: false
    })
  } catch (_) {}
  function failure(code, message) { var e = new Error(message); e.code = code; e.retryable = false; return e }
  // Events the stage sends: 'theme' (once, at the hello) and the document channel.
  var EVENTS = { theme: true, 'editor.document': true }
  function publicOn(name, fn) {
    var event = String(name)
    if (!EVENTS[event]) unknown.add("orca.on('" + event + "')")
    return on(event, fn)
  }
  function on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('orca.on needs a handler')
    var set = listeners.get(name) || new Set()
    listeners.set(name, set)
    var entry = function (payload) { return fn(payload) }
    set.add(entry)
    return Object.freeze({ dispose: function () { set.delete(entry) } })
  }
  function emit(name, payload) {
    var set = listeners.get(name)
    if (set) Array.from(set).forEach(function (fn) { try { fn(payload) } catch (e) { console.error(e) } })
  }
  // Orca's user-gesture methods refuse without a click or key press in the frame.
  function userCall(method, result) {
    var activation = navigator.userActivation
    calls.push(method)
    if (!activation || !activation.isActive) return Promise.reject(failure('not_permitted', method + ' needs a click or key press in the frame'))
    return Promise.resolve(result)
  }
  function watch(name, target) {
    return new Proxy(target, {
      get: function (t, key, receiver) {
        if (typeof key === 'string' && key !== 'then' && key !== 'toJSON' && !(key in t)) unknown.add(name + '.' + key)
        return Reflect.get(t, key, receiver)
      },
      has: function (t, key) {
        if (typeof key === 'string' && !(key in t)) unknown.add(name + '.' + key)
        return Reflect.has(t, key)
      }
    })
  }
  var documentApi = Object.freeze({
    get: function () {
      subscribed = true
      return latest ? Promise.resolve(latest) : new Promise(function (resolve) { waiting.push(resolve) })
    },
    onDidChange: function (fn) {
      subscribed = true
      var subscription = on('editor.document', fn)
      var current = latest
      var live = true
      if (current) Promise.resolve().then(function () { if (live && latest === current) fn(current) })
      return Object.freeze({ dispose: function () { live = false; subscription.dispose() } })
    },
    applyEdit: function () {
      calls.push('document.applyEdit')
      return Promise.reject(failure('not_permitted', 'the stage never edits the file'))
    }
  })
  var orca = {
    api: watch('orca.api', Object.freeze(C.api)),
    locale: C.locale,
    on: publicOn,
    document: watch('orca.document', documentApi),
    files: watch('orca.files', Object.freeze({
      saveAs: function (options) {
        var o = options || {}
        calls.push('files.saveAs ' + JSON.stringify({ suggestedName: o.suggestedName, mimeType: o.mimeType }))
        return userCall('files.saveAs', { status: C.saveAs })
      }
    })),
    shell: watch('orca.shell', Object.freeze({
      openExternal: function (url) { return userCall('shell.openExternal ' + String(url), { opened: false, reason: 'cancelled' }) }
    }))
  }
  Object.defineProperty(window, 'orca', { value: watch('orca', Object.freeze(orca)), writable: false, configurable: false })
  // Orca's hello: the theme (already baked into <html> and the tokens) and the document.
  fetch('/__doc').then(function (r) { return C.kind === 'bytes' ? r.arrayBuffer() : r.text() }).then(function (body) {
    latest = Object.freeze(C.kind === 'bytes'
      ? { version: 1, readOnly: C.readOnly, fileType: C.fileType, content: Object.freeze({ kind: 'bytes', bytes: body }) }
      : { version: 1, readOnly: C.readOnly, content: Object.freeze({ kind: 'text', text: body }) })
    emit('theme', { colorScheme: C.theme })
    waiting.splice(0).forEach(function (resolve) { resolve(latest) })
    emit('editor.document', latest)
    window.__stage.ready = true
  }, function (e) { console.error('[stage] cannot load the document: ' + e) })
})(${JSON.stringify(cfg).replaceAll('<', '\\u003c')})
`
}

/**
 * Starts the server for one plugin folder. `stage.capture(...)` renders one state and saves a PNG.
 * One server, one Chrome; each capture gets a fresh browser context.
 */
export async function createStage({ pluginDir, browser, log = () => {} }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'orca-plugin.json'), 'utf8'))
  let current = null // { html, docPath }
  const rootReal = fs.realpathSync(pluginDir)

  /** A file inside the plugin folder for a URL path: its real path must stay inside too. */
  function resolveFile(urlPath) {
    const abs = path.join(pluginDir, urlPath)
    if (!abs.startsWith(pluginDir + path.sep)) return null
    for (const c of [abs, abs + '.ts', abs + '.js', path.join(abs, 'index.ts'), path.join(abs, 'index.js')]) {
      let real
      try {
        real = fs.realpathSync(c)
      } catch {
        continue
      }
      if (!real.startsWith(rootReal + path.sep)) return null // a symlink out of the plugin folder
      if (fs.statSync(real).isFile()) return real
    }
    return null
  }

  let host = '' // 127.0.0.1:<port>, set once listening
  const server = http.createServer(async (req, res) => {
    const headers = { 'content-security-policy': FRAME.guestCsp, 'cache-control': 'no-store' }
    const send = (status, body, type) => res.writeHead(status, type ? { ...headers, 'content-type': type } : headers).end(body)
    let urlPath = '/'
    try {
      // Only the stage's own origin (a page that rebinds a DNS name to 127.0.0.1 sends another Host).
      if (req.headers.host !== host) return send(421, 'wrong host')
      urlPath = decodeURIComponent(new URL(req.url, 'http://stage').pathname)
      if (urlPath === '/favicon.ico') return send(204)
      if (!current) return send(503, 'no capture running')
      if (urlPath === current.guestPath) return send(200, current.html, 'text/html; charset=utf-8')
      if (urlPath === '/__doc') return send(200, fs.readFileSync(current.docPath), 'application/octet-stream')
      const file = resolveFile(urlPath)
      if (!file) return send(404, 'not found')
      if (file.endsWith('.ts') || file.endsWith('.mts')) {
        const out = await transform(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2022', sourcefile: file })
        return send(200, out.code, 'text/javascript')
      }
      return send(200, fs.readFileSync(file), MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
    } catch (e) {
      log(`[stage] ${urlPath}: ${e.message}`)
      return send(500, String(e.message))
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  host = `127.0.0.1:${server.address().port}`
  const origin = `http://${host}`

  /**
   * opts: { file, out, theme='dark', scale, width, height, act=[], waitFor, saveAs='saved', editor,
   *         readOnly=false, settleMs=250, timeoutMs=60000 }
   * Returns { out, width, height, scale, errors, warnings, unknown, calls, editor, fileType }.
   */
  async function capture(opts) {
    const theme = opts.theme ?? 'dark'
    const docPath = path.isAbsolute(opts.file) ? opts.file : path.join(pluginDir, opts.file)
    if (!fs.existsSync(docPath)) throw new Error(`demo file not found: ${docPath} (run the plugin's sample generator first)`)
    const { editor, ext } = pickEditor(manifest, docPath, opts.editor)
    const entry = editor.entry.replace(/^\.\//, '')
    const entryDir = path.posix.dirname('/' + entry)
    const cfg = {
      api: FRAME.api, locale: 'en', theme, kind: editor.contentKind === 'bytes' ? 'bytes' : 'text',
      fileType: ext.replace(/^\./, ''), readOnly: opts.readOnly ?? false, saveAs: opts.saveAs ?? 'saved',
    }
    const guestPath = path.posix.join(entryDir, '__orca-guest.html')
    current = { guestPath, docPath, html: guestHtml({ theme, entryBase: path.posix.basename(entry), standIn: standInScript(cfg) }) }

    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.scale, colorScheme: theme,
      locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
    })
    const errors = []
    const warnings = []
    // Nothing beyond the stage's server: every other origin is aborted, popups included.
    const blocked = new Set()
    await context.route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith(origin + '/') || /^(data|blob):/.test(url)) return route.continue()
      if (!blocked.has(url)) errors.push(`network: blocked ${url} (the stage reaches only its own 127.0.0.1 server)`)
      blocked.add(url)
      return route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
      else if (m.type() === 'warning') warnings.push(`console.warn: ${m.text()}`)
    })
    page.on('requestfailed', (r) => {
      if (!r.url().endsWith('/favicon.ico') && !blocked.has(r.url())) errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`)
    })
    page.on('popup', (p) => {
      errors.push(`popup: the editor opened a window (${p.url()}); Orca denies popups`)
      p.close().catch(() => {})
    })
    let leftTo = null
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame()) return
      const u = f.url()
      if (!u.startsWith(origin + guestPath) && !leftTo) {
        leftTo = u
        errors.push(`navigation: the page left the stage for ${u}`)
      }
    })
    const timeout = opts.timeoutMs ?? 60_000
    try {
      await page.goto(origin + guestPath, { waitUntil: 'networkidle', timeout })
      await page.waitForFunction(() => window.__stage?.ready && window.__stage.subscribed, null, { timeout })
      await page.evaluate(() => document.fonts.ready)
      if (opts.waitFor) await waitForText(page, opts.waitFor, timeout)
      for (const [i, act] of (opts.act ?? []).entries()) {
        try {
          await runAct(page, act, timeout)
        } catch (e) {
          throw new Error(`act ${i + 1} ${JSON.stringify(act)} failed: ${e.message.split('\n')[0]}`)
        }
        await page.waitForTimeout(act.pause ?? 150)
      }
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      await page.waitForTimeout(opts.settleMs ?? 250)
      fs.mkdirSync(path.dirname(opts.out), { recursive: true })
      await page.screenshot({ path: opts.out, animations: 'allow', caret: 'hide' })
      const state = await page.evaluate(() => (window.__stage ? { unknown: [...window.__stage.unknown], calls: window.__stage.calls.slice() } : null))
      if (!state || leftTo) throw new Error(`the page navigated away from the stage${leftTo ? ` (to ${leftTo})` : ''}`)
      return {
        out: opts.out, width: opts.width, height: opts.height, scale: opts.scale, theme, errors, warnings,
        unknown: state.unknown, calls: state.calls, editor: editor.id, fileType: cfg.kind === 'bytes' ? cfg.fileType : undefined,
      }
    } catch (e) {
      // Keep what the page showed, for debugging.
      try {
        fs.mkdirSync(path.dirname(opts.out), { recursive: true })
        await page.screenshot({ path: opts.out.replace(/\.png$/, '.failed.png') })
      } catch {}
      e.stageErrors = errors
      throw e
    } finally {
      await context.close()
      current = null
    }
  }

  return { capture, manifest, origin, close: () => new Promise((resolve) => server.close(resolve)) }
}

/** waitFor: "text", "/regex/flags", { text }, { regex }, { noText }. */
export async function waitForText(page, waitFor, timeout = 60_000) {
  const spec = typeof waitFor === 'string'
    ? (/^\/.+\/[a-z]*$/.test(waitFor) ? { regex: waitFor } : { text: waitFor })
    : waitFor
  if (spec.noText !== undefined) {
    await page.waitForFunction((t) => !document.body.innerText.includes(t), spec.noText, { timeout })
  } else if (spec.regex !== undefined) {
    const m = /^\/(.+)\/([a-z]*)$/.exec(spec.regex)
    const [source, flags] = m ? [m[1], m[2]] : [spec.regex, '']
    await page.waitForFunction(([s, f]) => new RegExp(s, f).test(document.body.innerText), [source, flags], { timeout })
  } else if (spec.text !== undefined) {
    await page.waitForFunction((t) => document.body.innerText.includes(t), spec.text, { timeout })
  } else {
    throw new Error(`waitFor needs text, regex or noText: ${JSON.stringify(waitFor)}`)
  }
}

const MODIFIER = { shift: 'Shift', meta: 'Meta', cmd: 'Meta', command: 'Meta', ctrl: 'Control', control: 'Control', alt: 'Alt', option: 'Alt' }

/** Elements whose aria-label or title is `label`: exact first, then by prefix. */
async function byLabel(page, label, selector = '*') {
  const q = JSON.stringify(label)
  const exact = page.locator(`:is(${selector})[aria-label=${q}], :is(${selector})[title=${q}]`).filter({ visible: true })
  if (await exact.count()) return exact.first()
  const prefix = page.locator(`:is(${selector})[aria-label^=${q}], :is(${selector})[title^=${q}]`).filter({ visible: true })
  if (await prefix.count()) return prefix.first()
  throw new Error(`nothing visible with aria-label or title ${q}`)
}

async function byText(page, text, exact, nth = 0) {
  const loc = page.getByText(text, { exact }).filter({ visible: true })
  const n = await loc.count()
  if (n <= nth) throw new Error(`no visible text ${JSON.stringify(text)}${exact ? ' (exact)' : ''}${nth ? ` #${nth + 1}` : ''}`)
  return loc.nth(nth)
}

/**
 * One act. `orca plugin shot` vocabulary: click, drag, key; stage additions: dblclick, clickText,
 * clickLabel (both with `offset`), select, fill, hover, type, wheel, wait, waitForText, waitForNoText.
 */
export async function runAct(page, a, timeout = 60_000) {
  const mods = (a.modifiers ?? []).map((m) => MODIFIER[m.toLowerCase()] ?? m)
  if (a.click) await page.mouse.click(a.click[0], a.click[1])
  else if (a.dblclick) await page.mouse.dblclick(a.dblclick[0], a.dblclick[1])
  else if (a.drag) {
    const [[x1, y1], [x2, y2]] = a.drag
    await page.mouse.move(x1, y1)
    await page.mouse.down()
    await page.mouse.move(x2, y2, { steps: 12 })
    await page.mouse.up()
  } else if (a.key) await page.keyboard.press([...mods, a.key].join('+'))
  else if (a.clickText !== undefined || a.clickLabel !== undefined) {
    const el = a.clickText !== undefined ? await byText(page, a.clickText, a.exact ?? true, a.nth ?? 0) : await byLabel(page, a.clickLabel)
    if (a.offset) {
      // A point beside the element (a chevron left of a label): offset from its left edge, mid-height.
      await el.scrollIntoViewIfNeeded({ timeout })
      const box = await el.boundingBox()
      if (!box) throw new Error('the element has no box')
      for (const m of mods) await page.keyboard.down(m)
      await page.mouse.click(box.x + a.offset[0], box.y + box.height / 2 + a.offset[1], { clickCount: a.count ?? 1 })
      for (const m of mods) await page.keyboard.up(m)
    } else {
      await el.click({ modifiers: mods, clickCount: a.count ?? 1, timeout })
    }
  } else if (a.select !== undefined) {
    const el = await byLabel(page, a.select, 'select')
    const wanted = String(a.option)
    const options = await el.evaluate((s) => [...s.options].map((o) => ({ label: o.label, value: o.value })))
    const stem = wanted.replace(/…$/, '')
    const hit = options.find((o) => o.label === wanted) ?? options.find((o) => o.label.startsWith(stem)) ?? options.find((o) => o.value === wanted)
    if (!hit) throw new Error(`no option ${JSON.stringify(wanted)} in ${JSON.stringify(options.map((o) => o.label))}`)
    await el.selectOption({ value: hit.value }, { timeout })
  } else if (a.fill !== undefined) {
    const el = await byLabel(page, a.fill, 'input, textarea, [contenteditable]')
    const type = await el.evaluate((n) => (n instanceof HTMLInputElement ? n.type : ''))
    if (type === 'range' || type === 'number') {
      // What a user's drag or typing ends with: the value, then input and change.
      await el.focus()
      await el.evaluate((n, v) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        setter.call(n, String(v))
        n.dispatchEvent(new Event('input', { bubbles: true }))
        n.dispatchEvent(new Event('change', { bubbles: true }))
      }, a.value)
    } else {
      await el.fill(String(a.value), { timeout })
    }
  } else if (a.hover) await page.mouse.move(a.hover[0], a.hover[1], { steps: 4 })
  else if (a.type !== undefined) await page.keyboard.type(String(a.type), { delay: 10 })
  else if (a.wheel) {
    await page.mouse.move(a.wheel[0], a.wheel[1])
    await page.mouse.wheel(0, a.wheel[2])
  } else if (a.wait !== undefined) await page.waitForTimeout(a.wait)
  else if (a.waitForText !== undefined) await waitForText(page, { text: a.waitForText }, timeout)
  else if (a.waitForNoText !== undefined) await waitForText(page, { noText: a.waitForNoText }, timeout)
  else throw new Error(`unknown act ${JSON.stringify(a)}`)
}
