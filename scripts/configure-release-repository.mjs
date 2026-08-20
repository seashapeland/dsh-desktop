import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repository = (process.env.DSH_UPDATE_REPOSITORY || '').trim()
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error('DSH_UPDATE_REPOSITORY 必须是 owner/repository。')
}
const packagePath = path.join(projectRoot, 'package.json')
const desktopPackage = JSON.parse(await readFile(packagePath, 'utf8'))
desktopPackage.desktopUpdate ??= {}
desktopPackage.desktopUpdate.repository = repository
desktopPackage.desktopUpdate.manifestUrl = `https://github.com/${repository}/releases/latest/download/update.json`
await writeFile(packagePath, `${JSON.stringify(desktopPackage, null, 2)}\n`, 'utf8')
console.log(`已将更新源配置为 ${repository}。`)
