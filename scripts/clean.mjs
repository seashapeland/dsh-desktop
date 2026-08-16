// Removes all regenerable build and test artifacts from the project root.
// Run with `npm run clean`; safe to rerun, never touches node_modules or src.
import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targets = new Set([
  'dist',
  'release',
  'output',
  '.preview-data',
  '.runtime-test',
  '.runtime-tests',
  '.package-smoke'
])

let removed = 0
let skipped = 0
for (const entry of await readdir(projectRoot)) {
  const isBuildCache = entry.startsWith('.build-cache')
  if (!targets.has(entry) && !isBuildCache) continue
  try {
    await rm(path.join(projectRoot, entry), { recursive: true, force: true })
    console.log(`removed ${entry}`)
    removed += 1
  } catch (error) {
    // Windows locks (e.g. a running preview holding Chromium profile files)
    // must not abort the rest of the cleanup. Report and continue.
    console.warn(`skipped ${entry}: ${error instanceof Error ? error.message : String(error)}`)
    skipped += 1
  }
}
if (skipped > 0) console.warn(`Skipped ${skipped} locked director${skipped === 1 ? 'y' : 'ies'}; close running DSH Desktop previews and rerun.`)
console.log(removed === 0 && skipped === 0 ? 'Nothing to clean.' : `Cleaned ${removed} artifact director${removed === 1 ? 'y' : 'ies'}.`)
