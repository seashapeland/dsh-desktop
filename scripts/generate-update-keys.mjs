import { generateKeyPairSync } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const secretRoot = path.join(projectRoot, '.release-secrets')
const privateKeyPath = path.join(secretRoot, 'update-private-key.pem')
const publicKeyPath = path.join(projectRoot, 'build', 'update-public-key.pem')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')

await mkdir(secretRoot, { recursive: true })
await writeFile(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { encoding: 'utf8', flag: 'wx' })
await writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }), { encoding: 'utf8', flag: 'wx' })
console.log('已生成更新签名密钥。私钥位于被 git 忽略的 .release-secrets；公钥位于 build/update-public-key.pem。')
