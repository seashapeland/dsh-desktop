import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoot = path.join(projectRoot, 'runtime')
const run = (command, args, cwd = projectRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// npm's peer resolver can consume excessive memory when it has to construct
// this large prerelease graph from scratch. Seed a deterministic base lock,
// install it, then let a normal pass add and lock the required peers.
run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], runtimeRoot)
run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund'], runtimeRoot)
run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], runtimeRoot)
run('node', ['scripts/patch-dsh-directory-picker.mjs'])
run('node', ['scripts/verify-dsh-runtime.mjs'])
