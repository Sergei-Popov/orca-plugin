// Paint a checked SDK scenario with the same components, styles and replay surface as
// `orca plugin shot --scenario`, in the listing tool's headless Chrome.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { waitForText } from './stage.mjs'

const require = createRequire(import.meta.url)
const runner = fileURLToPath(new URL('./panel-scenario.mjs', import.meta.url))
const origin = 'https://orca-listing.invalid'
let installedReplay

function replayFiles() {
  const app = process.env.ORCA_APP_PATH ?? '/Applications/Orca.app'
  const root = path.join(app, 'Contents', 'Resources', 'app.asar.unpacked')
  const assets = path.join(root, 'out', 'renderer', 'assets')
  if (!fs.existsSync(assets)) throw new Error(`Orca's installed replay renderer is missing at ${assets} (set ORCA_APP_PATH to the .app)`)
  const files = new Set(fs.readdirSync(assets))
  const version = JSON.parse(fs.readFileSync(path.join(root, 'out', 'package.json'), 'utf8')).version
  const chunk = (name) => {
    const matches = [...files].filter((f) => new RegExp(`^${name}-[a-zA-Z0-9_-]{8}\\.js$`).test(f))
    if (matches.length !== 1) throw new Error(`Orca ${version}: expected one ${name} renderer module in ${assets}`)
    return matches[0]
  }
  // App wraps the replay in its TooltipProvider. IconButton uses that context even when
  // closed. Find the panel view's own dependency by Orca's data-slot, across chunk hashes.
  const view = chunk('PluginDeclarativeView')
  const source = fs.readFileSync(path.join(assets, view), 'utf8')
  const deps = [...source.matchAll(/\bfrom\s*["']\.\/([^/"']+\.js)["']/g)].map((m) => m[1])
  const tooltip = [view, ...deps].find((f) => fs.readFileSync(path.join(assets, f), 'utf8').includes('tooltip-provider'))
  if (!tooltip) throw new Error(`Orca ${version}: could not locate the panel view's TooltipProvider`)
  const index = fs.readFileSync(path.join(assets, '..', 'index.html'), 'utf8')
  const styles = index.match(/<link rel="stylesheet"[^>]*>/g)
  if (!styles?.length) throw new Error(`Orca ${version}: no renderer stylesheets in index.html`)
  return {
    root, assets, files, version, styles: styles.join('\n'),
    modules: { react: chunk('react'), root: chunk('react-renderer-root'), replay: chunk('PluginShotReplaySurface'), tooltip },
  }
}

function runScenario({ root }, pluginDir, manifest, { panel, scenario, theme, act = [] }) {
  const contribution = manifest.contributes?.panels?.find((p) => p.id === panel && p.ui === 'components')
  if (!contribution) throw new Error(`no ui: "components" panel with id "${panel}" in orca-plugin.json`)
  const { pluginCheckFixturePath } = require(path.join(root, 'out/cli/plugin-authoring/plugin-panel-check.js'))
  const fixture = pluginCheckFixturePath(pluginDir, contribution.entry)
  if (!fixture) throw new Error(`${contribution.entry} has no .check.ts scenario file`)
  let acts = []
  if (act.length) {
    const { parsePluginShotActs } = require(path.join(root, 'out/shared/plugins/view/plugin-shot-acts.js'))
    const parsed = parsePluginShotActs(JSON.stringify(act))
    if (!parsed.ok) throw new Error(`panel act: ${parsed.error}`)
    acts = parsed.acts
  }
  const register = pathToFileURL(path.join(root, 'resources/plugins/declarative/orca-test-register.mjs')).href
  const child = spawnSync(process.execPath, ['--import', register, runner], {
    cwd: pluginDir, env: { ...process.env, ORCA_PLUGIN_TEST_ROOT: fs.realpathSync(pluginDir) },
    input: JSON.stringify({ panel, entry: contribution.entry, main: manifest.main, fixture, scenario, theme, acts }),
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`${panel}/${scenario}: ${(child.stderr || child.stdout || child.signal || `exit ${child.status}`).trim()}`)
  return JSON.parse(child.output[3])
}

export async function capturePanel({ browser, pluginDir, manifest }, opts) {
  const install = installedReplay ??= replayFiles()
  const { tree, summary, calls, errors, warnings } = runScenario(install, pluginDir, manifest, opts)
  const { panel, scenario, theme, width, height, scale, out } = opts
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: scale, colorScheme: theme, locale: 'en-US',
    timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block',
  })
  try {
    // Serve only installed renderer assets to this context. No app entry point, profile or runtime.
    const html = `<!doctype html><html class="native-shell ${theme}"><head><meta charset="utf-8">${install.styles}</head>
      <body class="bg-sidebar"><div id="root"></div></body></html>`
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      if (url.href === origin + '/') return route.fulfill({ contentType: 'text/html', body: html })
      const name = url.pathname.slice('/assets/'.length)
      if (url.origin === origin && url.pathname.startsWith('/assets/') && install.files.has(name)) {
        return route.fulfill({ path: path.join(install.assets, name) })
      }
      return route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
      if (m.type() === 'warning') warnings.push(m.text())
    })
    page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()} (${r.failure()?.errorText})`))
    await page.goto(origin)
    const render = page.evaluate(async ({ modules, tree, width }) => {
      // The bundle minifies export names. React and the root helper each expose one function.
      const onlyFunction = async (url) => {
        const exports = Object.values(await import('/assets/' + url))
        if (exports.length !== 1 || typeof exports[0] !== 'function') throw new Error(`unsupported Orca renderer module: ${url}`)
        return exports[0]
      }
      const [loadReact, createRoot, { default: Replay }, tooltip] = await Promise.all([
        onlyFunction(modules.react), onlyFunction(modules.root), import('/assets/' + modules.replay), import('/assets/' + modules.tooltip),
      ])
      const Provider = Object.values(tooltip).find((f) => typeof f === 'function' && f.toString().includes('tooltip-provider'))
      if (!Provider) throw new Error("Orca's TooltipProvider export is missing")
      const preview = { id: 'listing', tree, width }
      const { createElement } = loadReact()
      createRoot(document.getElementById('root')).render(createElement(Provider, null, createElement(Replay, { preview })))
    }, { modules: install.modules, tree, width })
    const ready = Promise.race([
      page.locator('[data-plugin-shot-replay] > *').first().waitFor({ state: 'visible', timeout: 10_000 }),
      page.waitForEvent('pageerror', { timeout: 0 }).then((error) => { throw error }),
    ])
    await Promise.all([render, ready])
    if (opts.waitFor) await waitForText(page, opts.waitFor, 10_000)
    await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    })
    if (opts.settleMs) await page.waitForTimeout(opts.settleMs)
    await page.screenshot({ path: out, caret: 'hide', animations: 'disabled' })
    return { out, panel, scenario, orcaVersion: install.version, width, height, scale, theme, summary, calls, errors, warnings, unknown: [] }
  } catch (error) {
    error.stageErrors = errors
    throw error
  } finally {
    await context.close()
  }
}
