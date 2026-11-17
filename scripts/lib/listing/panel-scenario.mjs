// Runs in a fresh Node process with Orca's own test loader, like `orca plugin check`.
// stdin carries the capture request. fd 3 carries the tree, separate from the plugin's logs.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { mockHost, mount, mountWorker } from 'orca/testing'

const { panel, entry, main, fixture, scenario, theme, acts } = JSON.parse(fs.readFileSync(0, 'utf8'))
const load = (file) => import(pathToFileURL(path.resolve(file)).href)
const definitions = await load(fixture)
const cases = definitions.default ?? definitions.scenarios
if (!cases || !Object.hasOwn(cases, scenario)) {
  throw new Error(`${fixture} has no scenario "${scenario}" (available: ${Object.keys(cases ?? {}).join(', ')})`)
}
const { events = [], persisted, theme: fixtureTheme, ...hostOptions } = cases[scenario]
const host = mockHost(hostOptions)
const worker = main ? await mountWorker(await load(main), { host }) : null
let view
try {
  view = await mount(await load(entry), { host, panelId: panel, persisted, theme: theme ?? fixtureTheme })
  for (const { event, payload } of events) await view.emit(event, payload)
  for (const [i, act] of acts.entries()) {
    try {
      await applyAct(view, act)
    } catch (error) {
      throw new Error(`panel act ${i + 1} ${JSON.stringify(act)}: ${error.message}`, { cause: error })
    }
  }
  // drawnTree is the validated wire tree that Orca passes to PluginShotReplaySurface.
  // tree() is the test snapshot and drops keys, default props and callback references.
  const tree = view.drawnTree()
  if (!tree) throw new Error(`${entry}, scenario "${scenario}" drew no tree: ${view.errors.map((e) => e.message).join(', ')}`)
  fs.writeFileSync(3, JSON.stringify({
    tree, summary: view.summary(), calls: [...new Set(host.calls.map((c) => c.method))],
    errors: view.errors.map((e) => e.message),
    warnings: [...view.warnings, ...view.refusals.map((r) => `host refused ${r.method} (${r.code}): ${r.message}`)],
  }))
} finally {
  try {
    await view?.unmount()
  } finally {
    await worker?.deactivate()
  }
}

// The parent validated these with Orca's pluginShotActsSchema. Every SDK act awaits its redraw.
function applyAct(view, act) {
  if (act.type) return view.type(act.type, act.text, { replace: act.replace, submit: act.submit })
  if (act.press) return view.press(act.press)
  if (act.toggle) return view.toggle(act.toggle)
  if (act.select) return view.select(act.select, act.value)
  if (act.slide) return view.slide(act.slide, act.value)
  if (act.sort) return view.sort(act.sort, act.column)
  if (act.selectRows) return view.selectRows(act.selectRows, act.keys)
  if (act.loadMore) return view.loadMore(act.loadMore)
  for (const verb of ['activateRow', 'expand', 'collapse', 'selectItem', 'activateItem']) {
    if (act[verb]) return view[verb](act[verb], act.key)
  }
  throw new Error('unsupported panel act')
}
