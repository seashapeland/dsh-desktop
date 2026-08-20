import { generateKeyPairSync, sign } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { compareVersions, parseOfficialDshRelease, verifyUpdateManifest } = require('../dist/main/update.js')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const payload = Buffer.from(JSON.stringify({
  schema: 1,
  desktopVersion: '0.2.0',
  dshVersion: '0.1.0-rc.7',
  publishedAt: '2026-08-15T12:00:00.000Z',
  msiUrl: 'https://updates.example.test/DSH-Desktop-Setup-0.2.0.msi',
  sha256: 'a'.repeat(64),
  size: 150_000_000,
  notes: 'Compatibility-tested release.'
}))
const envelope = {
  payload: payload.toString('base64'),
  signature: sign(null, payload, privateKey).toString('base64')
}

const verified = verifyUpdateManifest(envelope, publicKey.export({ type: 'spki', format: 'pem' }).toString())
if (verified.desktopVersion !== '0.2.0') throw new Error('signed update manifest was not accepted')
if (compareVersions('0.2.0', '0.1.4') <= 0) throw new Error('stable version comparison failed')
if (compareVersions('0.2.0-rc.1', '0.2.0') >= 0) throw new Error('prerelease version comparison failed')
if (compareVersions('0.1.0-rc.8', '0.1.0-rc.7') <= 0) throw new Error('numbered prerelease comparison failed')
if (parseOfficialDshRelease({ version: '0.1.0-rc.7' }).version !== '0.1.0-rc.7') {
  throw new Error('official DSH release response was not accepted')
}

const tampered = { ...envelope, payload: Buffer.from(payload.toString().replace('0.2.0', '9.9.9')).toString('base64') }
try {
  verifyUpdateManifest(tampered, publicKey.export({ type: 'spki', format: 'pem' }).toString())
  throw new Error('tampered manifest was accepted')
} catch (error) {
  if (error instanceof Error && error.message === 'tampered manifest was accepted') throw error
}

console.log('Update manifest signature and version tests passed.')
