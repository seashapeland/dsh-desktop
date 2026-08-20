import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(projectRoot, 'runtime')
const runtimeModules = path.join(runtimeRoot, 'node_modules')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const desktopPackage = await readJson(path.join(projectRoot, 'package.json'))
const runtimePackage = await readJson(path.join(runtimeRoot, 'package.json'))
const installedDshPath = path.join(runtimeModules, '@deepseek-ai', 'dsh', 'package.json')
const installedDsh = await readJson(installedDshPath)
const expected = desktopPackage.dshRuntime?.version

if (!expected || runtimePackage.dependencies?.['@deepseek-ai/dsh'] !== expected || installedDsh.version !== expected) {
  throw new Error(`DSH runtime 版本不一致：desktop=${expected ?? 'missing'}, runtime=${runtimePackage.dependencies?.['@deepseek-ai/dsh'] ?? 'missing'}, installed=${installedDsh.version}`)
}
if (Object.keys(runtimePackage.dependencies ?? {}).some((name) => name !== '@deepseek-ai/dsh')) {
  throw new Error('DSH runtime 只允许声明官方 @deepseek-ai/dsh；检测到意外的本地或附加依赖。')
}

const bootPackagePath = path.join(runtimeModules, '@deepseek-ai', 'dsh-app-boot', 'package.json')
const bootRequire = createRequire(bootPackagePath)
for (const packageName of ['@deepseek-ai/cordis-plugin-group', '@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/dsh-invariants']) {
  try {
    bootRequire.resolve(packageName)
  } catch {
    throw new Error(`DSH runtime 缺少可从 dsh-app-boot 解析的必需 peer：${packageName}`)
  }
}

const npmCheck = spawnSync('npm', ['ls', '--prefix', runtimeRoot, '--omit=dev', '--all'], {
  cwd: projectRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024
})
if (npmCheck.status !== 0) {
  throw new Error(`DSH runtime 依赖闭包无效：\n${npmCheck.stdout}\n${npmCheck.stderr}`)
}

console.log(`DSH runtime ${expected} 依赖闭包验证通过。`)
