// Adds or updates one plugin release in the hub's orca-catalog.json.
//
//   node scripts/lib/catalog.mjs <catalog.json> <request.json>
//
// request.json: { id, source: {kind,url,ref[,path]}, description?, categories?, release, changelog?,
// pluginDir? } where `release` is the `entry` printed by `orca plugin release-entry --json`. Releases
// stay newest first; a release with the same version is replaced. Plugins stay sorted by id.
//
// Listing images (icon, cover, screenshots) must live in the catalog repository itself: they are
// read from the release commit in `pluginDir`, checked against the entry's sha256, written to
// assets/<id>/<path in the plugin> and the entry points there. Only the newest release keeps
// `images`, since assets/<id>/ holds one set.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

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

/** Copies the release's images into assets/<id>/ next to the catalog and repoints the entry. */
function syncImages(images, id, pluginDir, commit, hubRoot) {
  const assetsRel = path.posix.join('assets', id)
  const assetsAbs = path.join(hubRoot, assetsRel)
  fs.rmSync(assetsAbs, { recursive: true, force: true })
  if (!images) return
  const all = [images.icon, images.cover, ...(images.screenshots ?? [])].filter(Boolean)
  for (const image of all) {
    const bytes = execFileSync('git', ['-C', pluginDir, 'show', `${commit}:${image.path}`], {
      maxBuffer: 64 * 1024 * 1024
    })
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== image.sha256) {
      throw new Error(`${image.path} at ${commit} does not match the sha256 of the release entry`)
    }
    const target = path.posix.join(assetsRel, image.path)
    fs.mkdirSync(path.dirname(path.join(hubRoot, target)), { recursive: true })
    fs.writeFileSync(path.join(hubRoot, target), bytes)
    image.path = target
  }
}

if (release.images && !request.pluginDir) {
  console.error('the release has images: pass pluginDir in the request to copy them into assets/')
  process.exit(2)
}
if (request.pluginDir) {
  release.images = release.images && structuredClone(release.images)
  syncImages(release.images, request.id, request.pluginDir, release.commit, path.dirname(path.resolve(catalogPath)))
}

let entry = catalog.plugins.find((plugin) => plugin.id === request.id)
if (!entry) {
  entry = { id: request.id, source: request.source, releases: [] }
  catalog.plugins.push(entry)
}
entry.source = request.source
if (request.description) entry.description = request.description
if (Array.isArray(request.categories) && request.categories.length > 0) entry.categories = request.categories
entry.releases = [release, ...(entry.releases ?? []).filter((r) => r.version !== release.version)].slice(0, 32)
for (const older of entry.releases.slice(1)) delete older.images

catalog.plugins.sort((a, b) => a.id.localeCompare(b.id))
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
console.log(`${request.id} ${release.version} → ${catalogPath}`)
