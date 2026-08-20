import { createHash, verify as verifySignature } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'

export type UpdatePayload = {
  schema: 1
  desktopVersion: string
  dshVersion: string
  publishedAt: string
  msiUrl: string
  sha256: string
  size: number
  notes?: string
}

type UpdateEnvelope = {
  payload: string
  signature: string
}

export type DownloadProgress = {
  transferred: number
  total: number
  percent: number
}

export type OfficialDshRelease = {
  version: string
  packageUrl: string
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/i
const BASE64_PATTERN = /^[0-9A-Za-z+/]+={0,2}$/
const MAX_UPDATE_BYTES = 1_500_000_000

function requiredString(value: unknown, field: string, maxLength = 8_000): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`更新清单中的 ${field} 无效。`)
  }
  return value
}

function trustedHttpsUrl(value: unknown, field: string): string {
  const text = requiredString(value, field, 2_048)
  const parsed = new URL(text)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`更新清单中的 ${field} 必须是可信 HTTPS 地址。`)
  }
  return parsed.toString()
}

function versionParts(value: string): { core: number[]; prerelease: Array<number | string> | null } {
  const [core, prerelease] = value.split('-', 2)
  return {
    core: core.split('.').map(Number),
    prerelease: prerelease === undefined
      ? null
      : prerelease.split('.').map((part) => /^\d+$/.test(part) ? Number(part) : part)
  }
}

export function compareVersions(left: string, right: string): number {
  if (!VERSION_PATTERN.test(left) || !VERSION_PATTERN.test(right)) {
    throw new Error('无法比较无效的桌面端版本号。')
  }
  const leftParts = versionParts(left)
  const rightParts = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts.core[index] === rightParts.core[index]) continue
    return leftParts.core[index] < rightParts.core[index] ? -1 : 1
  }
  if (leftParts.prerelease === null && rightParts.prerelease === null) return 0
  if (leftParts.prerelease === null) return 1
  if (rightParts.prerelease === null) return -1
  const length = Math.max(leftParts.prerelease.length, rightParts.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const a = leftParts.prerelease[index]
    const b = rightParts.prerelease[index]
    if (a === b) continue
    if (a === undefined) return -1
    if (b === undefined) return 1
    if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1
    if (typeof a === 'number') return -1
    if (typeof b === 'number') return 1
    return a.localeCompare(b)
  }
  return 0
}

export function parseOfficialDshRelease(value: unknown): OfficialDshRelease {
  if (!value || typeof value !== 'object') throw new Error('官方 DSH 版本响应格式无效。')
  const version = requiredString((value as { version?: unknown }).version, 'version', 64)
  if (!VERSION_PATTERN.test(version)) throw new Error('官方 DSH 版本号无效。')
  return {
    version,
    packageUrl: `https://www.npmjs.com/package/@deepseek-ai/dsh/v/${encodeURIComponent(version)}`
  }
}

export async function fetchOfficialDshRelease(): Promise<OfficialDshRelease> {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest', {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`官方 DSH 版本服务返回 HTTP ${response.status}。`)
  return parseOfficialDshRelease(await response.json())
}

export function verifyUpdateManifest(value: unknown, publicKey: string): UpdatePayload {
  if (!value || typeof value !== 'object') throw new Error('更新清单格式无效。')
  const envelope = value as Partial<UpdateEnvelope>
  const encodedPayload = requiredString(envelope.payload, 'payload', 32_000)
  const encodedSignature = requiredString(envelope.signature, 'signature', 2_048)
  if (!BASE64_PATTERN.test(encodedPayload) || !BASE64_PATTERN.test(encodedSignature)) {
    throw new Error('更新清单签名编码无效。')
  }

  const payloadBytes = Buffer.from(encodedPayload, 'base64')
  const signatureBytes = Buffer.from(encodedSignature, 'base64')
  if (!verifySignature(null, payloadBytes, publicKey, signatureBytes)) {
    throw new Error('更新清单签名验证失败。')
  }

  const parsed = JSON.parse(payloadBytes.toString('utf8')) as Partial<UpdatePayload>
  if (parsed.schema !== 1) throw new Error('更新清单版本不受支持。')
  const desktopVersion = requiredString(parsed.desktopVersion, 'desktopVersion', 64)
  if (!VERSION_PATTERN.test(desktopVersion)) throw new Error('更新清单中的桌面端版本无效。')
  const dshVersion = requiredString(parsed.dshVersion, 'dshVersion', 64)
  const publishedAt = requiredString(parsed.publishedAt, 'publishedAt', 64)
  if (!Number.isFinite(Date.parse(publishedAt))) throw new Error('更新清单中的发布时间无效。')
  const msiUrl = trustedHttpsUrl(parsed.msiUrl, 'msiUrl')
  if (!new URL(msiUrl).pathname.toLowerCase().endsWith('.msi')) {
    throw new Error('更新清单只能指向 MSI 安装包。')
  }
  const sha256 = requiredString(parsed.sha256, 'sha256', 64).toLowerCase()
  if (!SHA256_PATTERN.test(sha256)) throw new Error('更新清单中的 SHA-256 无效。')
  if (typeof parsed.size !== 'number' || !Number.isSafeInteger(parsed.size) || parsed.size <= 0 || parsed.size > MAX_UPDATE_BYTES) {
    throw new Error('更新清单中的安装包大小无效。')
  }
  const size = parsed.size
  const notes = parsed.notes === undefined ? undefined : requiredString(parsed.notes, 'notes')
  return { schema: 1, desktopVersion, dshVersion, publishedAt, msiUrl, sha256, size, notes }
}

export async function fetchUpdateManifest(manifestUrl: string, publicKey: string): Promise<UpdatePayload> {
  const url = trustedHttpsUrl(manifestUrl, 'manifestUrl')
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`更新服务返回 HTTP ${response.status}。`)
  if (new URL(response.url).protocol !== 'https:') throw new Error('更新服务发生了不安全的重定向。')
  return verifyUpdateManifest(await response.json(), publicKey)
}

export async function downloadUpdate(
  payload: UpdatePayload,
  destinationDirectory: string,
  onProgress: (progress: DownloadProgress) => void
): Promise<string> {
  await mkdir(destinationDirectory, { recursive: true })
  const finalPath = path.join(destinationDirectory, `DSH-Desktop-Setup-${payload.desktopVersion}.msi`)
  const temporaryPath = `${finalPath}.partial`
  await rm(temporaryPath, { force: true })

  const response = await fetch(payload.msiUrl, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60_000) })
  if (!response.ok || !response.body) throw new Error(`安装包下载失败：HTTP ${response.status}。`)
  if (new URL(response.url).protocol !== 'https:') throw new Error('安装包下载发生了不安全的重定向。')
  const advertisedSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(advertisedSize) && advertisedSize > 0 && advertisedSize !== payload.size) {
    throw new Error('安装包大小与签名清单不一致。')
  }

  const file = await open(temporaryPath, 'w')
  const hash = createHash('sha256')
  const reader = response.body.getReader()
  let transferred = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      transferred += chunk.length
      if (transferred > payload.size) throw new Error('安装包超过签名清单声明的大小。')
      hash.update(chunk)
      await file.write(chunk)
      onProgress({ transferred, total: payload.size, percent: Math.min(100, transferred / payload.size * 100) })
    }
  } catch (error) {
    await file.close()
    await rm(temporaryPath, { force: true })
    throw error
  }
  await file.close()

  if (transferred !== payload.size) {
    await rm(temporaryPath, { force: true })
    throw new Error('安装包下载不完整。')
  }
  if (hash.digest('hex') !== payload.sha256) {
    await rm(temporaryPath, { force: true })
    throw new Error('安装包 SHA-256 校验失败。')
  }
  await rm(finalPath, { force: true })
  await rename(temporaryPath, finalPath)
  onProgress({ transferred, total: payload.size, percent: 100 })
  return finalPath
}
