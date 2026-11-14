// Adds or updates one plugin release in the hub's orca-catalog.json.
//
//   node scripts/lib/catalog.mjs <catalog.json> <request.json>
//
// request.json: { id, source: {kind,url,ref[,path]}, description?, categories?, release, changelog? }
// where `release` is the `entry` printed by `orca plugin release-entry --json`. Releases stay newest
// first; a release with the same version is replaced. Plugins stay sorted by id.
import fs from 'node:fs'

const [catalogPath, requestPath] = process.argv.slice(2)
if (!catalogPath || !requestPath) {
  console.error('usage: node catalog.mjs <catalog.json> <request.json>')
  process.exit(2)
}

const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'))
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
catalog.plugins ??= []

const release = { ...request.release }
if (request.changelog) {
  release.changelog = String(request.changelog).slice(0, 2000)
}
release.updatedAt ??= new Date().toISOString().slice(0, 10)

let entry = catalog.plugins.find((plugin) => plugin.id === request.id)
if (!entry) {
  entry = { id: request.id, source: request.source, releases: [] }
  catalog.plugins.push(entry)
}
entry.source = request.source
if (request.description) entry.description = request.description
if (Array.isArray(request.categories) && request.categories.length > 0) entry.categories = request.categories
entry.releases = [release, ...(entry.releases ?? []).filter((r) => r.version !== release.version)].slice(0, 32)

catalog.plugins.sort((a, b) => a.id.localeCompare(b.id))
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
console.log(`${request.id} ${release.version} → ${catalogPath}`)
