import { createHash, sign } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const desktopPackage = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const repository = (process.env.DSH_UPDATE_REPOSITORY || desktopPackage.desktopUpdate?.repository || '').trim()
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
  throw new Error('请通过 DSH_UPDATE_REPOSITORY 或 desktopUpdate.repository 设置 owner/repository。')
}
const desktopVersion = desktopPackage.version
const dshVersion = desktopPackage.dshRuntime?.version
if (!versionPattern.test(desktopVersion) || !versionPattern.test(dshVersion)) throw new Error('桌面端或 DSH runtime 版本无效。')

const assetName = `DSH Desktop-Setup-${desktopVersion}.msi`
const msiPath = path.join(projectRoot, 'release', assetName)
const msiBytes = await readFile(msiPath)
const msiStat = await stat(msiPath)
const privateKey = (process.env.DSH_DESKTOP_UPDATE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim()
if (!privateKey.includes('BEGIN PRIVATE KEY')) throw new Error('缺少 DSH_DESKTOP_UPDATE_PRIVATE_KEY。')

const payload = Buffer.from(JSON.stringify({
  schema: 1,
  desktopVersion,
  dshVersion,
  publishedAt: new Date().toISOString(),
  msiUrl: `https://github.com/${repository}/releases/download/v${desktopVersion}/${encodeURIComponent(assetName)}`,
  sha256: createHash('sha256').update(msiBytes).digest('hex'),
  size: msiStat.size,
  notes: (process.env.DSH_RELEASE_NOTES || `DSH Desktop ${desktopVersion}，内置 DeepSeek Harness ${dshVersion}。`).trim()
}))
const envelope = {
  payload: payload.toString('base64'),
  signature: sign(null, payload, privateKey).toString('base64')
}
const outputPath = path.join(projectRoot, 'release', 'update.json')
await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8')
console.log(`已生成签名更新清单：${outputPath}`)
