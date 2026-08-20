import { contextBridge, ipcRenderer } from 'electron'

type SampledColor = {
  luminance: number
}

type RgbaColor = {
  red: number
  green: number
  blue: number
  alpha: number
}

type DesktopTheme = 'light' | 'dark'

type DesktopMenuItem = {
  label?: string
  action?: string
  shortcut?: string
  separator?: boolean
  disabled?: boolean
}

type DesktopMenuGroup = {
  label: string
  items: DesktopMenuItem[]
}

const TITLE_BAR_HEIGHT = 36
let receivedTheme: DesktopTheme | null = null
const DESKTOP_MENUS: DesktopMenuGroup[] = [
  {
    label: 'DSH Desktop',
    items: [
      { label: '重启 DSH 后端', action: 'restart' },
      { separator: true },
      { label: '退出', action: 'quit' }
    ]
  },
  {
    label: '插件',
    items: [
      { label: '打开插件中心…', action: 'plugins', shortcut: 'Ctrl+Shift+P' },
      { separator: true },
      { label: '查看 DSH 插件目录', action: 'plugin-directory' }
    ]
  },
  {
    label: '技能',
    items: [
      { label: '打开技能中心…', action: 'skills', shortcut: 'Ctrl+Shift+K' },
      { separator: true },
      { label: '打开用户技能目录', action: 'skill-directory' }
    ]
  },
  {
    label: '工作区',
    items: [
      { label: '打开文档目录', action: 'documents' },
      { label: '请在 DSH 内选择工作区', disabled: true }
    ]
  },
  {
    label: '帮助',
    items: [
      { label: '检查更新…', action: 'updates', shortcut: 'Ctrl+Shift+U' },
      { separator: true },
      { label: '打开桌面日志', action: 'log-file' },
      { label: 'DSH 使用文档', action: 'docs' },
      { label: 'DSH 插件仓库', action: 'plugin-repository' },
      { label: '打开应用数据目录', action: 'app-data' }
    ]
  }
]

function rgbaColor(value: string): RgbaColor | null {
  const channels = value.match(/[\d.]+/g)?.map(Number)
  if (!channels || channels.length < 3) return null
  const [red, green, blue, alpha = 1] = channels
  if (![red, green, blue, alpha].every(Number.isFinite)) return null
  return {
    red: Math.max(0, Math.min(255, red)),
    green: Math.max(0, Math.min(255, green)),
    blue: Math.max(0, Math.min(255, blue)),
    alpha: Math.max(0, Math.min(1, alpha))
  }
}

function colorLuminance(rgb: number[]): number {
  const linear = rgb.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function titleBarBackground(): SampledColor {
  const x = Math.max(0, window.innerWidth - 190)
  const y = Math.min(18, Math.max(0, window.innerHeight - 1))
  let element = document.elementFromPoint(x, y)
  let remaining = 1
  const composed = [0, 0, 0]
  while (element) {
    const color = rgbaColor(getComputedStyle(element).backgroundColor)
    if (color && color.alpha > 0) {
      const contribution = color.alpha * remaining
      composed[0] += color.red * contribution
      composed[1] += color.green * contribution
      composed[2] += color.blue * contribution
      remaining *= 1 - color.alpha
      if (remaining < 0.01) break
    }
    element = element.parentElement
  }
  // The BrowserWindow startup surface is Harness dark; it fills only the
  // still-transparent remainder after compositing modal backdrops and theme layers.
  composed[0] += 21 * remaining
  composed[1] += 21 * remaining
  composed[2] += 23 * remaining
  return { luminance: colorLuminance(composed) }
}

function configuredTheme(): DesktopTheme {
  if (receivedTheme) return receivedTheme
  if (document.body?.hasAttribute('data-ds-dark-theme')) return 'dark'
  const queryTheme = new URLSearchParams(window.location.search).get('theme')
  if (queryTheme === 'light' || queryTheme === 'dark') return queryTheme
  if (window.location.protocol === 'http:') return 'light'
  const file = window.location.pathname.toLowerCase()
  if (file.endsWith('/loading.html') || file.endsWith('/startup-error.html')) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyLocalTheme(theme: DesktopTheme): void {
  document.documentElement.dataset.desktopTheme = theme
  const titleBar = document.querySelector<HTMLElement>('#dsh-desktop-titlebar')
  if (titleBar) titleBar.dataset.theme = theme
}

function isMainSurface(): boolean {
  if (window.location.protocol === 'http:') return true
  const file = window.location.pathname.toLowerCase()
  return file.endsWith('/loading.html') || file.endsWith('/startup-error.html')
}

function injectDesktopMenu(): void {
  if (!isMainSurface() || document.querySelector('#dsh-desktop-titlebar')) return

  const layoutStyle = document.createElement('style')
  layoutStyle.id = 'dsh-desktop-layout'
  if (document.querySelector('#root')) {
    layoutStyle.textContent = `
      html, body { overflow: hidden !important; }
      body { box-sizing: border-box !important; height: 100% !important; padding-top: ${TITLE_BAR_HEIGHT}px !important; }
      #root { height: 100% !important; margin: 0 !important; }
    `
  } else {
    layoutStyle.textContent = `body { box-sizing: border-box !important; min-height: 100vh !important; padding-top: ${TITLE_BAR_HEIGHT}px !important; }`
  }
  document.head.append(layoutStyle)

  const host = document.createElement('div')
  host.id = 'dsh-desktop-titlebar'
  host.dataset.theme = configuredTheme()
  const shadow = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = `
    :host {
      --desktop-surface: #ffffff;
      --desktop-menu-surface: #ffffff;
      --desktop-label: #202124;
      --desktop-muted: #6f7378;
      --desktop-hover: rgba(15, 17, 21, .055);
      --desktop-border: rgba(15, 17, 21, .09);
      position: fixed;
      inset: 0 0 auto 0;
      z-index: 900;
      display: block;
      height: ${TITLE_BAR_HEIGHT}px;
      color: var(--dsw-alias-label-primary, var(--desktop-label));
      font: 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      user-select: none;
    }
    :host([data-theme="dark"]) {
      --desktop-surface: #151517;
      --desktop-menu-surface: #232325;
      --desktop-label: #f4f5f6;
      --desktop-muted: #a5a8ad;
      --desktop-hover: rgba(255, 255, 255, .08);
      --desktop-border: rgba(255, 255, 255, .08);
    }
    * { box-sizing: border-box; }
    .bar {
      display: flex;
      align-items: center;
      height: 100%;
      padding: 0 144px 0 6px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, var(--desktop-border));
      background: var(--dsw-alias-bg-base, var(--desktop-surface));
      -webkit-app-region: drag;
      transition: background-color .16s ease, border-color .16s ease, color .16s ease;
    }
    .group { position: relative; height: 100%; display: flex; align-items: center; -webkit-app-region: no-drag; }
    .trigger {
      height: 28px;
      margin: 0 1px;
      padding: 0 9px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--dsw-alias-label-secondary, var(--desktop-muted));
      font: inherit;
      cursor: default;
      outline: none;
    }
    .trigger:hover, .trigger[aria-expanded="true"], .trigger:focus-visible {
      color: var(--dsw-alias-label-primary, var(--desktop-label));
      background: var(--dsw-alias-interactive-bg-hover, var(--desktop-hover));
    }
    .menu {
      position: absolute;
      top: 31px;
      left: 1px;
      min-width: 218px;
      padding: 5px;
      border: 1px solid var(--dsw-alias-border-inverted, var(--desktop-border));
      border-radius: 10px;
      background: var(--dsw-specific-menu, var(--desktop-menu-surface));
      box-shadow: 0 12px 32px rgba(0, 0, 0, .14), 0 1px 3px rgba(0, 0, 0, .08);
      opacity: 0;
      visibility: hidden;
      transform: translateY(-3px);
      transition: opacity .12s ease, transform .12s ease, visibility .12s;
    }
    .group[data-open="true"] .menu { opacity: 1; visibility: visible; transform: translateY(0); }
    .item {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 32px;
      gap: 18px;
      padding: 0 9px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--dsw-alias-label-primary, var(--desktop-label));
      font: inherit;
      text-align: left;
      cursor: default;
      outline: none;
    }
    .item:not(:disabled):hover, .item:not(:disabled):focus-visible { background: var(--dsw-alias-interactive-bg-hover, var(--desktop-hover)); }
    .item:disabled { color: var(--dsw-alias-label-dimmed, var(--desktop-muted)); opacity: .58; }
    .item-label { flex: 1; white-space: nowrap; }
    .shortcut { color: var(--dsw-alias-label-tertiary, var(--desktop-muted)); font-size: 11px; }
    .separator { height: 1px; margin: 4px 3px; background: var(--dsw-alias-border-l1, var(--desktop-border)); }
    .drag-space { flex: 1; height: 100%; }
    @media (prefers-reduced-motion: reduce) { .bar, .menu { transition: none; } }
  `
  const bar = document.createElement('div')
  bar.className = 'bar'

  const closeMenus = () => {
    shadow.querySelectorAll<HTMLElement>('.group[data-open="true"]').forEach((group) => {
      group.dataset.open = 'false'
      group.querySelector('button')?.setAttribute('aria-expanded', 'false')
    })
  }

  for (const groupDefinition of DESKTOP_MENUS) {
    const group = document.createElement('div')
    group.className = 'group'
    group.dataset.open = 'false'
    const trigger = document.createElement('button')
    trigger.className = 'trigger'
    trigger.type = 'button'
    trigger.textContent = groupDefinition.label
    trigger.setAttribute('aria-haspopup', 'menu')
    trigger.setAttribute('aria-expanded', 'false')
    const menu = document.createElement('div')
    menu.className = 'menu'
    menu.setAttribute('role', 'menu')

    for (const itemDefinition of groupDefinition.items) {
      if (itemDefinition.separator) {
        const separator = document.createElement('div')
        separator.className = 'separator'
        separator.setAttribute('role', 'separator')
        menu.append(separator)
        continue
      }
      const item = document.createElement('button')
      item.className = 'item'
      item.type = 'button'
      item.disabled = Boolean(itemDefinition.disabled)
      item.setAttribute('role', 'menuitem')
      const label = document.createElement('span')
      label.className = 'item-label'
      label.textContent = itemDefinition.label ?? ''
      item.append(label)
      if (itemDefinition.shortcut) {
        const shortcut = document.createElement('span')
        shortcut.className = 'shortcut'
        shortcut.textContent = itemDefinition.shortcut
        item.append(shortcut)
      }
      if (itemDefinition.action) {
        item.addEventListener('click', () => {
          closeMenus()
          ipcRenderer.send('desktop-menu:action', itemDefinition.action)
        })
      }
      menu.append(item)
    }

    trigger.addEventListener('click', () => {
      const opening = group.dataset.open !== 'true'
      closeMenus()
      group.dataset.open = String(opening)
      trigger.setAttribute('aria-expanded', String(opening))
      if (opening) menu.querySelector<HTMLButtonElement>('.item:not(:disabled)')?.focus()
    })
    trigger.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return
      event.preventDefault()
      closeMenus()
      group.dataset.open = 'true'
      trigger.setAttribute('aria-expanded', 'true')
      menu.querySelector<HTMLButtonElement>('.item:not(:disabled)')?.focus()
    })
    group.append(trigger, menu)
    bar.append(group)
  }

  const dragSpace = document.createElement('div')
  dragSpace.className = 'drag-space'
  bar.append(dragSpace)
  shadow.append(style, bar)
  document.body.append(host)

  document.addEventListener('pointerdown', (event) => {
    if (event.composedPath().includes(host)) return
    closeMenus()
  })
  window.addEventListener('blur', closeMenus)
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenus()
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
      event.preventDefault()
      ipcRenderer.send('desktop-menu:action', 'plugins')
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'u') {
      event.preventDefault()
      ipcRenderer.send('desktop-menu:action', 'updates')
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      ipcRenderer.send('desktop-menu:action', 'skills')
    }
  })
}

const SETTINGS_NAV_LIST = '.VOzbGW_navList'
const SETTINGS_NAV_CELL = 'VOzbGW_navCell'
const SETTINGS_NAV_ACTIVE = 'VOzbGW_active'
const SETTINGS_NAV_ICON = 'VOzbGW_navIcon'
const SETTINGS_NAV_LABEL = 'VOzbGW_navLabel'
const SETTINGS_OPTIONS = '.VOzbGW_options'

function skillIcon(): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('class', SETTINGS_NAV_ICON)
  icon.setAttribute('width', '16')
  icon.setAttribute('height', '16')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M12 2.75l1.45 4.18 4.18 1.45-4.18 1.45L12 14l-1.45-4.17-4.18-1.45 4.18-1.45L12 2.75zm6.25 9.5.85 2.4 2.4.85-2.4.85-.85 2.4-.85-2.4-2.4-.85 2.4-.85.85-2.4zM7 14.5l.95 2.55L10.5 18l-2.55.95L7 21.5l-.95-2.55L3.5 18l2.55-.95L7 14.5z')
  path.setAttribute('fill', 'currentColor')
  icon.append(path)
  return icon
}

function ensureSkillSettingsStyle(): void {
  if (document.querySelector('#dsh-desktop-skills-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-desktop-skills-style'
  style.textContent = `
    #dsh-desktop-skills-section { max-width:720px; color:var(--dsw-alias-label-primary); flex-direction:column; gap:0; display:flex; }
    .dsh-skills-heading { align-items:flex-start; justify-content:space-between; gap:16px; padding:0 0 18px; border-bottom:1px solid var(--dsw-alias-border-l2); display:flex; }
    .dsh-skills-heading h2 { margin:0 0 4px; font-size:18px; font-weight:600; line-height:26px; }
    .dsh-skills-heading p,.dsh-skills-note,.dsh-skills-empty { color:var(--dsw-alias-label-tertiary); margin:0; font-size:13px; line-height:20px; }
    .dsh-skills-actions { flex:none; align-items:center; gap:8px; display:flex; }
    .dsh-skills-button { box-sizing:border-box; height:32px; color:var(--dsw-alias-label-primary); font:inherit; cursor:pointer; background:transparent; border:1px solid var(--dsw-alias-border-l2); border-radius:16px; align-items:center; padding:0 12px; font-size:13px; line-height:20px; display:inline-flex; }
    .dsh-skills-button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
    .dsh-skills-button.primary { color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-button-primary-fill); border-color:transparent; }
    .dsh-skills-button.primary:hover:not(:disabled) { background:var(--dsw-alias-button-primary-hover); }
    .dsh-skills-button:disabled { cursor:default; opacity:.45; }
    .dsh-skills-note { padding:14px 0; border-bottom:1px solid var(--dsw-alias-border-l2); }
    .dsh-skills-path { color:var(--dsw-alias-label-dimmed); margin-top:3px; font-family:var(--ds-font-family-code); font-size:11px; overflow-wrap:anywhere; display:block; }
    .dsh-skills-list { list-style:none; margin:0; padding:0; }
    .dsh-skills-row { min-height:68px; align-items:center; grid-template-columns:minmax(0,1fr) auto auto; gap:18px; padding:12px 0; border-bottom:1px solid var(--dsw-alias-border-l2); display:grid; }
    .dsh-skills-name { margin:0 0 3px; font-family:var(--ds-font-family-code); font-size:14px; font-weight:500; line-height:22px; }
    .dsh-skills-description { color:var(--dsw-alias-label-tertiary); margin:0; font-size:12px; line-height:18px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
    .dsh-skills-row .dsh-skills-button { height:28px; border-radius:14px; padding:0 10px; font-size:12px; }
    .dsh-skills-empty { padding:26px 0; text-align:center; border-bottom:1px solid var(--dsw-alias-border-l2); }
    .dsh-skills-status { min-height:18px; color:var(--dsw-alias-state-success-primary); margin:12px 0 0; font-size:12px; line-height:18px; }
    .dsh-skills-status.error { color:var(--dsw-alias-state-error-primary); }
  `
  document.head.append(style)
}

async function populateSkillSettings(section: HTMLElement): Promise<void> {
  const list = section.querySelector<HTMLUListElement>('.dsh-skills-list')!
  const root = section.querySelector<HTMLElement>('.dsh-skills-path')!
  const status = section.querySelector<HTMLElement>('.dsh-skills-status')!
  const state = await ipcRenderer.invoke('skills:list') as { root: string; skills: Array<{ name: string; description: string; path: string }> }
  root.textContent = state.root
  list.replaceChildren()
  if (state.skills.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'dsh-skills-empty'
    empty.textContent = '还没有用户技能。导入一个包含 SKILL.md 的文件夹即可开始。'
    list.append(empty)
    return
  }
  for (const skill of state.skills) {
    const row = document.createElement('li')
    row.className = 'dsh-skills-row'
    const copy = document.createElement('div')
    const name = document.createElement('p')
    name.className = 'dsh-skills-name'
    name.textContent = skill.name
    const description = document.createElement('p')
    description.className = 'dsh-skills-description'
    description.textContent = skill.description
    const reveal = document.createElement('button')
    reveal.type = 'button'
    reveal.className = 'dsh-skills-button'
    reveal.textContent = '查看文件'
    reveal.addEventListener('click', () => {
      void ipcRenderer.invoke('skills:reveal', skill.path).catch((error) => {
        status.textContent = error instanceof Error ? error.message : String(error)
        status.className = 'dsh-skills-status error'
      })
    })
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'dsh-skills-button'
    remove.textContent = '删除'
    remove.addEventListener('click', () => {
      if (!window.confirm(`删除技能 ${skill.name}？\n\n将从磁盘删除整个技能文件夹，且无法撤销。`)) return
      remove.disabled = true
      remove.textContent = '删除中…'
      void ipcRenderer.invoke('skills:remove', skill.path).then(() => {
        status.textContent = `${skill.name} 已删除。`
        status.className = 'dsh-skills-status'
        return populateSkillSettings(section)
      }).catch((error) => {
        status.textContent = error instanceof Error ? error.message : String(error)
        status.className = 'dsh-skills-status error'
      }).finally(() => {
        remove.disabled = false
        remove.textContent = '删除'
      })
    })
    copy.append(name, description)
    row.append(copy, reveal, remove)
    list.append(row)
  }
}

function createSkillSettingsSection(): HTMLElement {
  const section = document.createElement('section')
  section.id = 'dsh-desktop-skills-section'
  const heading = document.createElement('div')
  heading.className = 'dsh-skills-heading'
  const copy = document.createElement('div')
  const title = document.createElement('h2')
  title.textContent = '技能'
  const intro = document.createElement('p')
  intro.textContent = '管理 DSH 原生的本地 SKILL.md。'
  const actions = document.createElement('div')
  actions.className = 'dsh-skills-actions'
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'dsh-skills-button'
  open.textContent = '打开目录'
  const importButton = document.createElement('button')
  importButton.type = 'button'
  importButton.className = 'dsh-skills-button primary'
  importButton.textContent = '导入技能'
  const note = document.createElement('p')
  note.className = 'dsh-skills-note'
  note.append('DSH 会自动发现用户技能，并在新对话中按名称或任务描述加载。')
  const path = document.createElement('span')
  path.className = 'dsh-skills-path'
  note.append(path)
  const list = document.createElement('ul')
  list.className = 'dsh-skills-list'
  const status = document.createElement('p')
  status.className = 'dsh-skills-status'
  status.setAttribute('aria-live', 'polite')
  open.addEventListener('click', () => {
    void ipcRenderer.invoke('skills:open-directory').catch((error) => {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.className = 'dsh-skills-status error'
    })
  })
  importButton.addEventListener('click', () => {
    importButton.disabled = true
    importButton.textContent = '正在导入…'
    status.textContent = ''
    void ipcRenderer.invoke('skills:import').then((result: { imported: string } | null) => {
      if (!result) return
      status.textContent = `${result.imported} 已导入，DSH 会自动发现它。`
      status.className = 'dsh-skills-status'
      return populateSkillSettings(section)
    }).catch((error) => {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.className = 'dsh-skills-status error'
    }).finally(() => {
      importButton.disabled = false
      importButton.textContent = '导入技能'
    })
  })
  copy.append(title, intro)
  actions.append(open, importButton)
  heading.append(copy, actions)
  section.append(heading, note, list, status)
  return section
}

function showSkillSettings(navList: HTMLElement, options: HTMLElement, button: HTMLButtonElement): void {
  for (const navButton of navList.querySelectorAll<HTMLButtonElement>('button')) {
    navButton.classList.remove(SETTINGS_NAV_ACTIVE)
    navButton.removeAttribute('aria-current')
  }
  button.classList.add(SETTINGS_NAV_ACTIVE)
  button.setAttribute('aria-current', 'true')
  for (const child of [...options.children]) {
    if ((child as HTMLElement).id === 'dsh-desktop-skills-section') continue
    ;(child as HTMLElement).dataset.dshDesktopHidden = 'true'
    ;(child as HTMLElement).style.display = 'none'
  }
  let section = options.querySelector<HTMLElement>('#dsh-desktop-skills-section')
  if (!section) {
    section = createSkillSettingsSection()
    options.append(section)
  }
  section.style.display = 'flex'
  void populateSkillSettings(section).catch((error) => {
    const status = section!.querySelector<HTMLElement>('.dsh-skills-status')!
    status.textContent = error instanceof Error ? error.message : String(error)
    status.className = 'dsh-skills-status error'
  })
}

function restoreOfficialSettings(options: HTMLElement): void {
  const skillButton = options.closest<HTMLElement>('[role="dialog"]')?.querySelector<HTMLButtonElement>('#dsh-desktop-skills-nav')
  skillButton?.classList.remove(SETTINGS_NAV_ACTIVE)
  skillButton?.removeAttribute('aria-current')
  options.querySelector<HTMLElement>('#dsh-desktop-skills-section')?.remove()
  for (const child of options.querySelectorAll<HTMLElement>('[data-dsh-desktop-hidden="true"]')) {
    child.style.removeProperty('display')
    delete child.dataset.dshDesktopHidden
  }
}

function injectSkillSettings(): void {
  if (window.location.protocol !== 'http:') return
  // The whole DSH app is observed for DOM changes; bail out with a single
  // cheap lookup until a settings dialog actually exists.
  if (!document.querySelector('[role="dialog"]')) return
  const navList = document.querySelector<HTMLElement>(SETTINGS_NAV_LIST)
  const panel = navList?.closest<HTMLElement>('[role="dialog"]')
  const options = panel?.querySelector<HTMLElement>(SETTINGS_OPTIONS)
  if (!navList || !options || navList.querySelector('#dsh-desktop-skills-nav')) return
  ensureSkillSettingsStyle()
  const button = document.createElement('button')
  button.id = 'dsh-desktop-skills-nav'
  button.type = 'button'
  button.className = SETTINGS_NAV_CELL
  const label = document.createElement('span')
  label.className = SETTINGS_NAV_LABEL
  label.textContent = '技能'
  button.append(skillIcon(), label)
  button.addEventListener('click', () => showSkillSettings(navList, options, button))
  for (const officialButton of navList.querySelectorAll<HTMLButtonElement>('button')) {
    if (officialButton === button) continue
    officialButton.addEventListener('click', () => restoreOfficialSettings(options))
  }
  navList.append(button)
}

function openSkillsInSettings(): void {
  const existing = document.querySelector<HTMLButtonElement>('#dsh-desktop-skills-nav')
  if (existing) {
    existing.click()
    return
  }
  const settingsTrigger = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"], button')].find((button) => /^(设置|settings)$/i.test(button.textContent?.trim() ?? ''))
  settingsTrigger?.click()
  let attempts = 0
  const timer = window.setInterval(() => {
    injectSkillSettings()
    const button = document.querySelector<HTMLButtonElement>('#dsh-desktop-skills-nav')
    if (button) {
      window.clearInterval(timer)
      button.click()
    } else if (++attempts >= 20) window.clearInterval(timer)
  }, 50)
}

let lastTitleBarColors = ''
let titleBarFrame = 0

function reportTitleBarColors(): void {
  cancelAnimationFrame(titleBarFrame)
  titleBarFrame = requestAnimationFrame(() => {
    const background = titleBarBackground()
    const foreground = background.luminance > 0.42 ? '#202124' : '#f4f5f6'
    const theme = configuredTheme()
    applyLocalTheme(theme)
    const serialized = `${foreground}:${theme}`
    if (serialized === lastTitleBarColors) return
    lastTitleBarColors = serialized
    ipcRenderer.send('window:set-theme-colors', { foreground, theme })
  })
}

window.addEventListener('DOMContentLoaded', () => {
  applyLocalTheme(configuredTheme())
  injectDesktopMenu()
  injectSkillSettings()
  reportTitleBarColors()
  const observer = new MutationObserver(reportTitleBarColors)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme', 'data-ds-dark-theme'] })
  if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme', 'data-ds-dark-theme'] })
  if (document.body) new MutationObserver(injectSkillSettings).observe(document.body, { childList: true, subtree: true })
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reportTitleBarColors)
  window.addEventListener('resize', reportTitleBarColors)
  window.setInterval(reportTitleBarColors, 3000)
})

ipcRenderer.on('desktop:theme', (_event, theme: unknown) => {
  if (theme === 'light' || theme === 'dark') {
    receivedTheme = theme
    applyLocalTheme(theme)
  }
})

ipcRenderer.on('desktop:open-skills', openSkillsInSettings)

if (window.location.protocol === 'file:') {
  if (window.location.pathname.toLowerCase().endsWith('/plugins.html')) {
    contextBridge.exposeInMainWorld('desktopPlugins', {
      list: () => ipcRenderer.invoke('plugins:list'),
      install: (name: string) => ipcRenderer.invoke('plugins:install', name),
      remove: (name: string) => ipcRenderer.invoke('plugins:remove', name)
    })
  }
  if (window.location.pathname.toLowerCase().endsWith('/updates.html')) {
    contextBridge.exposeInMainWorld('desktopUpdater', {
      status: () => ipcRenderer.invoke('updates:status'),
      check: () => ipcRenderer.invoke('updates:check'),
      download: () => ipcRenderer.invoke('updates:download'),
      install: () => ipcRenderer.invoke('updates:install'),
      reveal: () => ipcRenderer.invoke('updates:reveal'),
      onStatus: (listener: (state: unknown) => void) => {
        ipcRenderer.on('updates:status', (_event, state) => listener(state))
      }
    })
  }
}
