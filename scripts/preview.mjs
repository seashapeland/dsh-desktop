import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isolated = process.argv.includes('--isolated')
const forwardedArgs = process.argv.filter((argument) => argument === '--open-update-window')
const previewRoot = path.join(projectRoot, '.preview-data')
const installedProfile = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'dsh-desktop', 'dsh')
  : ''

if (!isolated && process.platform === 'win32') {
  const tasklist = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe')
  try {
    const running = execFileSync(tasklist, ['/fi', 'IMAGENAME eq DSH Desktop.exe', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (/"DSH Desktop\.exe"/i.test(running)) {
      console.error('请先退出已安装的 DSH Desktop，再运行 npm run preview。')
      console.error('如果只想看界面且不使用正式数据，请运行 npm run preview:safe。')
      process.exit(1)
    }
  } catch {
    // If tasklist is unavailable, Electron's single-instance lock remains the fallback.
  }
}

if (!isolated && (!installedProfile || !existsSync(installedProfile))) {
  console.error('没有找到已安装版的 DSH profile，请改用 npm run preview:safe。')
  process.exit(1)
}

const dshHome = isolated ? path.join(previewRoot, 'dsh') : installedProfile
const electronUserData = path.join(previewRoot, isolated ? 'electron-safe' : 'electron-live')
const electron = path.join(projectRoot, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')

console.log(isolated
  ? `正在使用隔离数据预览：${dshHome}`
  : `正在使用已安装版 profile 预览：${dshHome}`)
console.log('关闭预览窗口即可停止，不会生成 MSI 或修改安装目录。')

const child = spawn(electron, [projectRoot, `--user-data-dir=${electronUserData}`, ...forwardedArgs], {
  cwd: projectRoot,
  env: { ...process.env, DSH_DESKTOP_HOME: dshHome },
  stdio: 'inherit',
  windowsHide: false
})

child.once('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (signal) console.error(`预览被信号 ${signal} 终止。`)
  process.exitCode = code ?? (signal ? 1 : 0)
})
