// Builds the catalog request for scripts/lib/catalog.mjs from a plugin folder and the output of
// `orca plugin release-entry --json` (read from the ENTRY_JSON environment variable).
//
//   ENTRY_JSON=... node release-request.mjs <out.json> <catalog-id> <source-url> <plugin-dir> <version> [categories]
import fs from 'node:fs'
import path from 'node:path'

const [out, id, url, dir, version, categories = ''] = process.argv.slice(2)
const entry = JSON.parse(process.env.ENTRY_JSON ?? '{}')?.result?.entry
if (!entry) {
  console.error('ENTRY_JSON does not hold `orca plugin release-entry --json` output')
  process.exit(2)
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'orca-plugin.json'), 'utf8'))

/** The body of the `## [version]` section of CHANGELOG.md, as plain text. */
function changelogFor(file, wanted) {
  if (!fs.existsSync(file)) return ''
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## [${wanted}]`))
  if (start < 0) return ''
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## ['))
  return (end < 0 ? rest : rest.slice(0, end))
    .join('\n')
    .replace(/^###\s+/gm, '')
    .replace(/`/g, '')
    .trim()
}

const release = { ...entry, license: manifest.license, repository: manifest.repository }
for (const key of Object.keys(release)) if (release[key] === undefined) delete release[key]

fs.writeFileSync(
  out,
  JSON.stringify({
    id,
    source: { kind: 'git', url, ref: 'main' },
    description: manifest.description,
    categories: categories.split(',').map((c) => c.trim()).filter(Boolean),
    release,
    changelog: changelogFor(path.join(dir, 'CHANGELOG.md'), version)
  })
)
