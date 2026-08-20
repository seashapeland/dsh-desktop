import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  console.log('Skipping packaged Windows runtime smoke test on non-Windows host.')
  process.exit(0)
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagedRoot = path.join(projectRoot, 'release', 'win-unpacked')
const executable = path.join(packagedRoot, 'DSH Desktop.exe')
const runtimeModules = path.join(packagedRoot, 'resources', 'dsh-runtime', 'node_modules')
const cli = path.join(runtimeModules, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const requiredPackages = [
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/dsh-client-ui-settings-plugins',
  '@deepseek-ai/dsh-client-ui-plan'
]

for (const packageName of requiredPackages) {
  const packageFile = path.join(runtimeModules, ...packageName.split('/'), 'package.json')
  await readFile(packageFile, 'utf8').catch(() => {
    throw new Error(`打包后的 DSH runtime 缺少 ${packageName}。`)
  })
}

const port = await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('无法分配运行时测试端口。'))
    server.close((error) => error ? reject(error) : resolve(address.port))
  })
})
const temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'dsh-desktop-packaged-smoke-'))
const child = spawn(executable, ['--expose-internals', cli, 'web', '--port', String(port)], {
  cwd: projectRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: temporaryHome, NO_COLOR: '1' },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
})
let output = ''
const collect = (data) => { output = `${output}${data.toString()}`.slice(-8_000) }
child.stdout.on('data', collect)
child.stderr.on('data', collect)

const stopTree = async () => {
  if (!child.pid || child.exitCode !== null) return
  await new Promise((resolve) => {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    killer.once('error', resolve)
    killer.once('close', resolve)
  })
}

try {
  const deadline = Date.now() + 60_000
  let response
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`打包后的 DSH 后端提前退出（${child.exitCode}）。\n${output}`)
    try {
      response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1_500) })
      if (response.ok) break
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  if (!response?.ok) throw new Error(`打包后的 DSH 后端未能在 60 秒内就绪。\n${output}`)
  const html = await response.text()
  for (const packageName of requiredPackages.slice(1)) {
    if (!html.includes(packageName)) throw new Error(`DSH 启动页未注册 ${packageName}。`)
  }
  console.log(`打包后 DSH runtime 启动验证通过（HTTP ${response.status}）。`)
} finally {
  await stopTree()
  await rm(temporaryHome, { recursive: true, force: true })
}
