import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron'
import { ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, downloadUpdate, fetchUpdateManifest, UpdatePayload } from './update'

type PluginState = {
  installed: string[]
}

let mainWindow: BrowserWindow | null = null
let pluginsWindow: BrowserWindow | null = null
let updatesWindow: BrowserWindow | null = null
let dshProcess: ChildProcess | null = null
let dshPort: number | null = null
let isQuitting = false
let quitCleanupStarted = false
let lifecycleTail: Promise<void> = Promise.resolve()
const intentionalStops = new WeakSet<ChildProcess>()
let currentTheme: 'light' | 'dark' = 'dark'

const PRODUCT_NAME = 'DSH Desktop'
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i
const LOG_LIMIT_BYTES = 1_000_000
const LOG_BACKUPS = 3

type DesktopPackage = {
  dependencies?: Record<string, string>
  desktopUpdate?: { manifestUrl?: string; publicKey?: string }
}

type SkillRecord = {
  name: string
  description: string
  path: string
  format: 'bundle' | 'markdown'
}

type UpdateState = {
  phase: 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'unavailable' | 'error'
  currentVersion: string
  currentDshVersion: string
  available?: UpdatePayload
  progress?: number
  detail?: string
  downloadPath?: string
}

const desktopPackage = require(path.join(app.getAppPath(), 'package.json')) as DesktopPackage
const currentDshVersion = desktopPackage.dependencies?.['@deepseek-ai/dsh'] ?? 'unknown'
let updateState: UpdateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  currentDshVersion
}

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = lifecycleTail.then(operation, operation)
  lifecycleTail = result.then(() => undefined, () => undefined)
  return result
}

function dshHome(): string {
  const override = process.env.DSH_DESKTOP_HOME?.trim()
  if (override) return path.resolve(override)
  return path.join(app.getPath('userData'), 'dsh')
}

function pluginStatePath(): string {
  return path.join(app.getPath('userData'), 'desktop-plugins.json')
}

function skillRoot(): string {
  return path.join(dshHome(), 'skills')
}

function codexSkillRoot(): string {
  const override = process.env.CODEX_HOME?.trim()
  return path.join(override ? path.resolve(override) : path.join(app.getPath('home'), '.codex'), 'skills')
}

function rendererPath(file: string): string {
  return path.join(app.getAppPath(), 'src', 'renderer', file)
}

function dshCliPath(): string {
  const cliPath = require.resolve('@deepseek-ai/dsh/lib/bin.js')
  // DSH creates profile-level junctions for its bundled plugins. Junctions
  // cannot be resolved through Electron's virtual app.asar filesystem, so the
  // CLI itself must run from the physical unpacked dependency tree.
  if (!app.isPackaged) return cliPath
  return cliPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
}

function safeRuntimeText(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-***REDACTED***')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1***REDACTED***')
    .replace(/\b(api[-_ ]?key|token|secret|password)(\s*[=:]\s*)[^\s,;}{"']{6,}/gi, '$1$2***REDACTED***')
    .slice(-12_000)
}

function childExitReason(code: number | null, signal: NodeJS.Signals | null): number | string {
  if (code === null) return signal ?? 'unknown'
  return process.platform === 'win32' && code > 0x7fffffff ? code - 0x100000000 : code
}

async function rotateRuntimeLog(logPath: string): Promise<void> {
  try {
    if ((await stat(logPath)).size < LOG_LIMIT_BYTES) return
  } catch {
    return
  }
  for (let index = LOG_BACKUPS; index >= 1; index -= 1) {
    const target = `${logPath}.${index}`
    await rm(target, { force: true })
    const source = index === 1 ? logPath : `${logPath}.${index - 1}`
    try {
      await rename(source, target)
    } catch {
      // A missing older generation is expected.
    }
  }
}

async function writeRuntimeLog(message: string): Promise<void> {
  try {
    await mkdir(dshHome(), { recursive: true })
    const logPath = path.join(dshHome(), 'desktop.log')
    await rotateRuntimeLog(logPath)
    await appendFile(logPath, `[${new Date().toISOString()}] ${safeRuntimeText(message)}\n`, 'utf8')
  } catch {
    // Logging should never prevent the local runtime from starting.
  }
}

function installProcessCrashHandlers(): void {
  process.on('uncaughtException', (error) => {
    const detail = safeRuntimeText(error instanceof Error ? error.stack ?? error.message : String(error))
    console.error(`[DSH Desktop] uncaught exception: ${detail}`)
    void writeRuntimeLog(`Uncaught exception: ${detail}`)
    // Electron's default is to terminate the whole main process, which would
    // orphan the still-running DSH backend. Surface the failure instead so the
    // user can restart the backend from the menu.
    if (mainWindow && !mainWindow.isDestroyed() && !isQuitting) {
      void mainWindow.loadFile(rendererPath('startup-error.html'), {
        query: { message: `主进程遇到未处理异常：${detail}` }
      })
    }
  })
  process.on('unhandledRejection', (reason) => {
    const detail = safeRuntimeText(reason instanceof Error ? reason.stack ?? reason.message : String(reason))
    console.error(`[DSH Desktop] unhandled rejection: ${detail}`)
    void writeRuntimeLog(`Unhandled rejection: ${detail}`)
  })
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error || !address || typeof address === 'string') {
          reject(error ?? new Error('Unable to allocate a local port.'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

function processEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_HOME: dshHome(),
    ELECTRON_RUN_AS_NODE: '1',
    NO_COLOR: '1'
  }
}

async function waitForServer(port: number, timeoutMs = 45_000, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError = 'The DSH service did not respond.'
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('DSH 启动已中止。')
    try {
      const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1_500) })
      if (response.ok || response.status < 500) return
      lastError = `DSH returned HTTP ${response.status}.`
    } catch (error) {
      if (signal?.aborted) throw new Error('DSH 启动已中止。')
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  throw new Error(`DSH 启动超时：${lastError}`)
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function taskkillTree(pid: number, force = false): Promise<void> {
  return new Promise((resolve) => {
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe')
    const args = ['/pid', String(pid), '/t']
    if (force) args.push('/f')
    const killer = spawn(taskkill, args, { windowsHide: true, stdio: 'ignore' })
    killer.once('error', () => resolve())
    killer.once('close', () => resolve())
  })
}

async function stopDshNow(): Promise<void> {
  if (!dshProcess) return
  const running = dshProcess
  dshProcess = null
  dshPort = null
  intentionalStops.add(running)
  if (running.exitCode !== null || running.signalCode !== null) return

  if (process.platform === 'win32' && running.pid) {
    await taskkillTree(running.pid)
    if (!await waitForChildExit(running, 3_000)) {
      await taskkillTree(running.pid, true)
      await waitForChildExit(running, 2_000)
    }
    return
  }
  running.kill('SIGTERM')
  if (!await waitForChildExit(running, 3_000)) running.kill('SIGKILL')
}

async function startDsh(): Promise<number> {
  if (isQuitting) throw new Error('应用正在退出。')
  if (dshProcess && dshPort) return dshPort
  await mkdir(dshHome(), { recursive: true })
  const port = await availablePort()
  const child = spawn(process.execPath, ['--expose-internals', dshCliPath(), 'web', '--port', String(port)], {
    cwd: app.getPath('documents'),
    env: processEnvironment(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  dshProcess = child
  let startupOutput = ''
  let ready = false
  const abortController = new AbortController()
  const collectOutput = (data: Buffer) => {
    startupOutput = `${startupOutput}${data.toString()}`.slice(-4_000)
  }
  child.stdout?.on('data', collectOutput)
  child.stderr?.on('data', collectOutput)
  const startupFailure = new Promise<never>((_resolve, reject) => {
    child.once('error', (error) => reject(error))
    child.once('exit', (code, signal) => {
      if (!ready && !intentionalStops.has(child)) {
        reject(new Error(`DSH 后端在启动完成前退出（${childExitReason(code, signal)}）。${safeRuntimeText(startupOutput)}`))
      }
    })
  })
  child.once('exit', (code, signal) => {
    if (dshProcess === child) {
      dshProcess = null
      dshPort = null
    }
    if (ready && !isQuitting && !intentionalStops.has(child) && mainWindow && !mainWindow.isDestroyed()) {
      const reason = childExitReason(code, signal)
      const output = safeRuntimeText(startupOutput)
      console.error(`[DSH Desktop] DSH backend exited (${reason}): ${output}`)
      void writeRuntimeLog(`Backend exited (${reason}): ${output}`)
      void mainWindow.loadFile(rendererPath('startup-error.html'), {
        query: { message: `DSH 后端意外退出（${reason}）。${output}` }
      })
    }
  })
  try {
    await Promise.race([waitForServer(port, 45_000, abortController.signal), startupFailure])
    ready = true
    dshPort = port
    return port
  } catch (error) {
    abortController.abort()
    await stopDshNow()
    throw error
  }
}

async function loadDshNow(): Promise<void> {
  if (isQuitting) return
  if (!mainWindow || mainWindow.isDestroyed()) return
  await mainWindow.loadFile(rendererPath('loading.html'))
  try {
    const port = await startDsh()
    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  } catch (error) {
    const message = safeRuntimeText(error instanceof Error ? error.message : String(error))
    console.error(`[DSH Desktop] DSH backend failed to start: ${message}`)
    await writeRuntimeLog(`Backend failed to start: ${message}`)
    await mainWindow.loadFile(rendererPath('startup-error.html'), { query: { message } })
  }
}

function loadDsh(): Promise<void> {
  return enqueueLifecycle(loadDshNow)
}

function restartDsh(): Promise<void> {
  return enqueueLifecycle(async () => {
    if (isQuitting) return
    await stopDshNow()
    await loadDshNow()
  })
}

async function readPluginState(): Promise<PluginState> {
  try {
    const parsed = JSON.parse(await readFile(pluginStatePath(), 'utf8')) as PluginState
    return { installed: Array.isArray(parsed.installed) ? parsed.installed : [] }
  } catch {
    return { installed: [] }
  }
}

async function writePluginState(state: PluginState): Promise<void> {
  await writeFile(pluginStatePath(), JSON.stringify(state, null, 2), 'utf8')
}

function frontmatterValue(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'mi'))
  if (!match) return ''
  const value = match[1].trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1).trim()
  }
  return value
}

async function readSkillRecord(skillPath: string, format: SkillRecord['format']): Promise<SkillRecord> {
  const filePath = format === 'bundle' ? path.join(skillPath, 'SKILL.md') : skillPath
  const source = (await readFile(filePath, 'utf8')).slice(0, 262_144)
  const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? ''
  const name = frontmatterValue(frontmatter, 'name')
  const description = frontmatterValue(frontmatter, 'description')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error(`${path.basename(filePath)} 的 name 必须是小写 kebab-case。`)
  }
  if (!description) throw new Error(`${path.basename(filePath)} 缺少 description。`)
  return { name, description, path: skillPath, format }
}

async function listSkills(): Promise<{ root: string; skills: SkillRecord[] }> {
  const root = skillRoot()
  await mkdir(root, { recursive: true })
  const entries = await readdir(root, { withFileTypes: true })
  const records = await Promise.all(entries.map(async (entry) => {
    try {
      if (entry.isDirectory()) return await readSkillRecord(path.join(root, entry.name), 'bundle')
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        return await readSkillRecord(path.join(root, entry.name), 'markdown')
      }
    } catch {
      // Invalid skills stay on disk for the user to repair, but are not presented as loadable.
    }
    return null
  }))
  return { root, skills: records.filter((record): record is SkillRecord => record !== null).sort((a, b) => a.name.localeCompare(b.name)) }
}

async function copySkillTree(source: string, destination: string): Promise<void> {
  const sourceStat = await lstat(source)
  if (sourceStat.isSymbolicLink()) throw new Error('技能目录不能包含符号链接或目录联接。')
  if (sourceStat.isDirectory()) {
    await mkdir(destination)
    const entries = await readdir(source)
    for (const entry of entries) await copySkillTree(path.join(source, entry), path.join(destination, entry))
    return
  }
  if (!sourceStat.isFile()) throw new Error('技能目录只能包含普通文件和文件夹。')
  await copyFile(source, destination)
}

async function importSkill(event: Electron.IpcMainInvokeEvent): Promise<{ imported: string } | null> {
  requireSkillSurface(event)
  const selected = await dialog.showOpenDialog(mainWindow!, {
    title: '选择包含 SKILL.md 的技能文件夹',
    defaultPath: existsSync(codexSkillRoot()) ? codexSkillRoot() : app.getPath('home'),
    properties: ['openDirectory']
  })
  if (selected.canceled || selected.filePaths.length !== 1) return null
  const source = path.resolve(selected.filePaths[0])
  const record = await readSkillRecord(source, 'bundle')
  const root = skillRoot()
  await mkdir(root, { recursive: true })
  const destination = path.join(root, record.name)
  const relative = path.relative(root, destination)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('技能名称产生了不安全的目标路径。')
  if (existsSync(destination)) throw new Error(`技能 ${record.name} 已存在；请先在技能目录中处理同名版本。`)
  try {
    await copySkillTree(source, destination)
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
  return { imported: record.name }
}

function isValidPackageName(name: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i.test(name)
}

async function runDshCommand(args: string[]): Promise<{ output: string; code: number }> {
  await mkdir(dshHome(), { recursive: true })
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-internals', dshCliPath(), ...args], {
      cwd: app.getPath('documents'),
      env: processEnvironment(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    const collect = (data: Buffer) => { output = `${output}${data.toString()}`.slice(-50_000) }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', reject)
    child.on('close', (code) => resolve({ output: safeRuntimeText(output.trim()), code: code ?? 1 }))
  })
}

function requirePluginWindow(event: Electron.IpcMainInvokeEvent): void {
  if (!pluginsWindow || pluginsWindow.isDestroyed() || event.sender !== pluginsWindow.webContents) {
    throw new Error('This desktop action is only available from Plugin Center.')
  }
}

function requireSkillSurface(event: Electron.IpcMainInvokeEvent): void {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('This desktop action is only available from DSH Settings.')
  }
}

function requireUpdateWindow(event: Electron.IpcMainInvokeEvent): void {
  if (!updatesWindow || updatesWindow.isDestroyed() || event.sender !== updatesWindow.webContents) {
    throw new Error('This desktop action is only available from the update window.')
  }
}

function applyThemeToAuxiliaryWindows(): void {
  for (const window of [pluginsWindow, updatesWindow]) {
    if (!window || window.isDestroyed()) continue
    window.setBackgroundColor(currentTheme === 'dark' ? '#151517' : '#ffffff')
    window.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: currentTheme === 'dark' ? '#f4f5f6' : '#202124',
      height: 36
    })
    window.webContents.send('desktop:theme', currentTheme)
  }
}

async function installPlugin(event: Electron.IpcMainInvokeEvent, rawName: string) {
  requirePluginWindow(event)
  const name = rawName.trim()
  if (!isValidPackageName(name)) throw new Error('请输入有效的 npm 插件包名，例如 @scope/dsh-plugin-example。')
  const result = await runDshCommand(['plugin', '--profile', 'web', 'add', name])
  if (result.code !== 0) throw new Error(result.output || '插件安装失败。')
  const state = await readPluginState()
  if (!state.installed.includes(name)) {
    state.installed.push(name)
    await writePluginState(state)
  }
  await restartDsh()
  return { output: result.output }
}

async function removePlugin(event: Electron.IpcMainInvokeEvent, rawName: string) {
  requirePluginWindow(event)
  const name = rawName.trim()
  const state = await readPluginState()
  if (!state.installed.includes(name)) throw new Error('只能移除由 DSH Desktop 安装的插件。')
  const result = await runDshCommand(['plugin', '--profile', 'web', 'remove', name])
  if (result.code !== 0) throw new Error(result.output || '插件移除失败。')
  state.installed = state.installed.filter((item) => item !== name)
  await writePluginState(state)
  await restartDsh()
  return { output: result.output }
}

function updateConfiguration(): { manifestUrl: string; publicKey: string } | null {
  const manifestUrl = process.env.DSH_DESKTOP_UPDATE_URL?.trim() || desktopPackage.desktopUpdate?.manifestUrl?.trim() || ''
  const publicKey = (process.env.DSH_DESKTOP_UPDATE_PUBLIC_KEY?.trim() || desktopPackage.desktopUpdate?.publicKey?.trim() || '')
    .replace(/\\n/g, '\n')
  return manifestUrl && publicKey ? { manifestUrl, publicKey } : null
}

function publishUpdateState(next: UpdateState): UpdateState {
  updateState = next
  if (updatesWindow && !updatesWindow.isDestroyed()) updatesWindow.webContents.send('updates:status', updateState)
  return updateState
}

async function checkForUpdates(): Promise<UpdateState> {
  if (updateState.phase === 'checking' || updateState.phase === 'downloading') return updateState
  const configuration = updateConfiguration()
  if (!configuration) {
    return publishUpdateState({
      phase: 'unavailable',
      currentVersion: app.getVersion(),
      currentDshVersion,
      detail: '尚未配置签名更新源。'
    })
  }
  publishUpdateState({ phase: 'checking', currentVersion: app.getVersion(), currentDshVersion, detail: '正在验证更新清单…' })
  try {
    const available = await fetchUpdateManifest(configuration.manifestUrl, configuration.publicKey)
    if (compareVersions(available.desktopVersion, app.getVersion()) <= 0) {
      return publishUpdateState({
        phase: 'up-to-date',
        currentVersion: app.getVersion(),
        currentDshVersion,
        detail: `已验证发布版本 ${available.desktopVersion}。`
      })
    }
    return publishUpdateState({
      phase: 'available',
      currentVersion: app.getVersion(),
      currentDshVersion,
      available,
      detail: `发布于 ${new Date(available.publishedAt).toLocaleString('zh-CN')}。`
    })
  } catch (error) {
    const detail = safeRuntimeText(error instanceof Error ? error.message : String(error))
    await writeRuntimeLog(`Update check failed: ${detail}`)
    return publishUpdateState({ phase: 'error', currentVersion: app.getVersion(), currentDshVersion, detail })
  }
}

async function downloadAvailableUpdate(): Promise<UpdateState> {
  if (updateState.phase !== 'available' || !updateState.available) return updateState
  const available = updateState.available
  publishUpdateState({ ...updateState, phase: 'downloading', progress: 0, detail: '正在下载并计算 SHA-256…' })
  try {
    const downloadPath = await downloadUpdate(
      available,
      path.join(app.getPath('temp'), 'dsh-desktop-updates'),
      ({ percent }) => publishUpdateState({
        ...updateState,
        phase: 'downloading',
        available,
        progress: percent,
        detail: `已下载 ${Math.round(percent)}%。`
      })
    )
    return publishUpdateState({
      phase: 'downloaded',
      currentVersion: app.getVersion(),
      currentDshVersion,
      available,
      progress: 100,
      downloadPath,
      detail: '安装包已通过签名清单与 SHA-256 校验，尚未执行。'
    })
  } catch (error) {
    const detail = safeRuntimeText(error instanceof Error ? error.message : String(error))
    await writeRuntimeLog(`Update download failed: ${detail}`)
    return publishUpdateState({
      phase: 'error',
      currentVersion: app.getVersion(),
      currentDshVersion,
      available,
      detail
    })
  }
}

function isRendererFile(url: string, filename?: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return false
    const filePath = path.resolve(fileURLToPath(parsed))
    const rendererRoot = path.resolve(app.getAppPath(), 'src', 'renderer')
    const relative = path.relative(rendererRoot, filePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return false
    return filename === undefined || path.basename(filePath).toLowerCase() === filename.toLowerCase()
  } catch {
    return false
  }
}

function isDshUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && Number(parsed.port) === dshPort
  } catch {
    return false
  }
}

function secureNavigation(window: BrowserWindow, allow: (url: string) => boolean): void {
  const navigate = (event: Electron.Event, url: string) => {
    if (allow(url)) return
    event.preventDefault()
    try {
      if (new URL(url).protocol === 'https:') void shell.openExternal(url)
    } catch {
      // Invalid destinations stay blocked.
    }
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === 'https:') void shell.openExternal(url)
    } catch {
      // Invalid destinations stay blocked.
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', navigate)
  window.webContents.on('will-redirect', navigate)
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

function configureSessionPermissions(): void {
  const allowed = (permission: string, requestingUrl: string) => {
    return permission === 'clipboard-sanitized-write' && (isDshUrl(requestingUrl) || isRendererFile(requestingUrl))
  }
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return allowed(permission, requestingOrigin)
  })
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(allowed(permission, details.requestingUrl))
  })
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    title: PRODUCT_NAME,
    backgroundColor: '#151517',
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#aab5bf',
      height: 36
    },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  secureNavigation(mainWindow, (url) => isRendererFile(url) || isDshUrl(url))
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  void loadDsh()
}

function openPluginCenter(): void {
  if (pluginsWindow && !pluginsWindow.isDestroyed()) {
    pluginsWindow.focus()
    return
  }
  pluginsWindow = new BrowserWindow({
    width: 620,
    height: 620,
    resizable: false,
    title: 'Plugin Center · DSH Desktop',
    backgroundColor: currentTheme === 'dark' ? '#151517' : '#ffffff',
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: currentTheme === 'dark' ? '#f4f5f6' : '#202124',
      height: 36
    },
    parent: mainWindow ?? undefined,
    modal: Boolean(mainWindow),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  secureNavigation(pluginsWindow, (url) => isRendererFile(url, 'plugins.html'))
  pluginsWindow.on('closed', () => { pluginsWindow = null })
  void pluginsWindow.loadFile(rendererPath('plugins.html'), { query: { theme: currentTheme } })
}

function openUpdateWindow(): void {
  if (updatesWindow && !updatesWindow.isDestroyed()) {
    updatesWindow.focus()
    return
  }
  updatesWindow = new BrowserWindow({
    width: 620,
    height: 555,
    minWidth: 560,
    minHeight: 510,
    resizable: true,
    title: '更新 · DSH Desktop',
    backgroundColor: currentTheme === 'dark' ? '#151517' : '#ffffff',
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: currentTheme === 'dark' ? '#f4f5f6' : '#202124',
      height: 36
    },
    parent: mainWindow ?? undefined,
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  secureNavigation(updatesWindow, (url) => isRendererFile(url, 'updates.html'))
  updatesWindow.on('closed', () => { updatesWindow = null })
  void updatesWindow.loadFile(rendererPath('updates.html'), { query: { theme: currentTheme } })
}

function runDesktopMenuAction(action: string): void {
  switch (action) {
    case 'restart': void restartDsh(); break
    case 'quit': app.quit(); break
    case 'plugins': openPluginCenter(); break
    case 'skills': mainWindow?.webContents.send('desktop:open-skills'); break
    case 'plugin-directory': void shell.openPath(path.join(dshHome(), 'profiles', 'web')); break
    case 'skill-directory': void shell.openPath(skillRoot()); break
    case 'documents': void shell.openPath(app.getPath('documents')); break
    case 'updates': openUpdateWindow(); break
    case 'log-file': {
      const logPath = path.join(dshHome(), 'desktop.log')
      void shell.openPath(existsSync(logPath) ? logPath : dshHome())
      break
    }
    case 'docs': void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness/tree/master/docs/user'); break
    case 'plugin-repository': void shell.openExternal('https://github.com/topics/dsh-plugin'); break
    case 'app-data': void shell.openPath(app.getPath('userData')); break
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    installProcessCrashHandlers()
    configureSessionPermissions()
    Menu.setApplicationMenu(null)
    ipcMain.on('window:set-theme-colors', (event, colors: unknown) => {
      if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
      if (!colors || typeof colors !== 'object') return
      const { foreground, theme } = colors as { foreground?: unknown; theme?: unknown }
      if (typeof foreground !== 'string' || !COLOR_PATTERN.test(foreground)) return
      if (theme === 'light' || theme === 'dark') {
        currentTheme = theme
        applyThemeToAuxiliaryWindows()
      }
      mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: foreground, height: 36 })
    })
    ipcMain.on('desktop-menu:action', (event, action: unknown) => {
      if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return
      if (typeof action !== 'string') return
      runDesktopMenuAction(action)
    })
    ipcMain.handle('plugins:list', async (event) => {
      requirePluginWindow(event)
      return readPluginState()
    })
    ipcMain.handle('plugins:install', installPlugin)
    ipcMain.handle('plugins:remove', removePlugin)
    ipcMain.handle('skills:list', async (event) => {
      requireSkillSurface(event)
      return listSkills()
    })
    ipcMain.handle('skills:import', importSkill)
    ipcMain.handle('skills:open-directory', async (event) => {
      requireSkillSurface(event)
      await mkdir(skillRoot(), { recursive: true })
      return shell.openPath(skillRoot())
    })
    ipcMain.handle('skills:reveal', async (event, skillPath: unknown) => {
      requireSkillSurface(event)
      if (typeof skillPath !== 'string') throw new Error('无效的技能路径。')
      const root = path.resolve(skillRoot())
      const target = path.resolve(skillPath)
      const relative = path.relative(root, target)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(target)) {
        throw new Error('技能路径不在 DSH 用户技能目录内。')
      }
      shell.showItemInFolder(target)
    })
    ipcMain.handle('skills:remove', async (event, skillPath: unknown) => {
      requireSkillSurface(event)
      if (typeof skillPath !== 'string') throw new Error('无效的技能路径。')
      const root = path.resolve(skillRoot())
      const target = path.resolve(skillPath)
      const relative = path.relative(root, target)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(target)) {
        throw new Error('技能路径不在 DSH 用户技能目录内。')
      }
      await rm(target, { recursive: true, force: true })
    })
    ipcMain.handle('updates:status', async (event) => {
      requireUpdateWindow(event)
      return updateState
    })
    ipcMain.handle('updates:check', async (event) => {
      requireUpdateWindow(event)
      return checkForUpdates()
    })
    ipcMain.handle('updates:download', async (event) => {
      requireUpdateWindow(event)
      return downloadAvailableUpdate()
    })
    ipcMain.handle('updates:reveal', async (event) => {
      requireUpdateWindow(event)
      if (!updateState.downloadPath || !existsSync(updateState.downloadPath)) {
        return publishUpdateState({
          phase: 'error',
          currentVersion: app.getVersion(),
          currentDshVersion,
          available: updateState.available,
          detail: '已下载的安装包不存在，请重新检查。'
        })
      }
      shell.showItemInFolder(updateState.downloadPath)
      return updateState
    })
    createMainWindow()
    if (process.argv.includes('--open-update-window')) openUpdateWindow()
    if (app.isPackaged && updateConfiguration()) {
      setTimeout(() => {
        void checkForUpdates().then((state) => {
          if (state.phase === 'available') openUpdateWindow()
        })
      }, 12_000)
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  isQuitting = true
  if (quitCleanupStarted || !dshProcess) return
  event.preventDefault()
  quitCleanupStarted = true
  void stopDshNow().finally(() => app.quit())
})
