import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requested = process.argv[2]?.trim()
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
let version = requested
if (!version || version === 'latest') {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh/latest', {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`官方 DSH 版本服务返回 HTTP ${response.status}。`)
  version = (await response.json()).version
}
if (typeof version !== 'string' || !versionPattern.test(version)) throw new Error(`无效的 DSH 版本：${version}`)

const updateJson = async (file, mutate) => {
  const value = JSON.parse(await readFile(file, 'utf8'))
  mutate(value)
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
await updateJson(path.join(projectRoot, 'package.json'), (pkg) => {
  pkg.devDependencies ??= {}
  pkg.devDependencies['@deepseek-ai/dsh'] = version
  pkg.dshRuntime = { version }
})
await updateJson(path.join(projectRoot, 'runtime', 'package.json'), (pkg) => {
  pkg.dependencies['@deepseek-ai/dsh'] = version
})

const run = (command, args, cwd = projectRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('npm', ['install', '--no-audit', '--no-fund'])
run('node', ['scripts/install-dsh-runtime.mjs'])
console.log(`已同步 DSH ${version}。请完成兼容测试并递增桌面端版本后再打包。`)
