# DSH Desktop

一个面向 Windows 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 桌面封装。它不复刻 DSH 的 Agent 或插件系统，而是在 Electron 中启动官方 `dsh web` profile，因此模型设置、会话、配置层和社区插件仍由 DSH 原生机制负责。

## 用户体验

- 双击 Windows 安装后的快捷方式即可启动，无需手动开终端或浏览器。
- DSH 后端只监听本机随机端口，并在应用退出时关闭。
- DSH 数据和 `web` profile 存在 Windows 应用数据目录，更新桌面壳不会清除它们。
- **插件 → Plugin Center** 使用官方的 `dsh plugin --profile web add <npm-package>` 命令安装插件；安装完成自动重启运行时。

首次启动后，仍需在 DSH 界面的 **Settings → Models** 填入模型提供商凭据，并在 DSH 内选择工作区。

默认情况下，DSH profile 存在 `%APPDATA%\\dsh-desktop\\dsh`。若希望把模型凭据、会话和插件放到其他磁盘，可在启动前设置 `DSH_DESKTOP_HOME` 为目标文件夹路径。

## 本地开发

要求：Node.js 22+。

```powershell
npm install
npm start
```

### 不安装预览最新版

先完全退出已安装的 DSH Desktop，然后在项目目录运行：

```powershell
npm run preview
```

该命令会先编译最新源码，再用项目内的 Electron 启动，同时复用 `%APPDATA%\dsh-desktop\dsh` 中的正式 DSH profile；它不会生成 MSI，也不会改写安装目录。若只想安全查看界面而不读取正式 profile，可运行 `npm run preview:safe`，其数据保存在项目内的 `.preview-data`。

`release\win-unpacked` 只在 electron-builder 成功执行时更新，普通的 `npm run build` 不会刷新其中的 `app.asar` 或依赖。中途取消打包后，该目录还可能混有旧版本与未完成产物，因此不应将里面的 EXE 当作开发预览入口。

## 构建 Windows 安装包

```powershell
npm run dist:win
```

生成的 `.msi` 安装包位于 `release/`。它使用 Windows Installer（WiX），会显示传统安装向导并允许选择安装目录；安装包内含 Electron 和 DSH npm 依赖，最终用户不需要单独安装 Node.js 或手动执行 `npx`。

## 插件兼容性

DSH Desktop 保留 DSH 的 profile 分层，而不是另造一个桌面插件 API。这样，未来遵循 DSH `dsh-plugin` 约定、可通过 npm 安装的插件，可以直接安装到同一个 `web` profile 中。插件的功能、权限与配置仍以插件作者和 DSH 当前版本的兼容性为准。

## 桌面端更新

帮助菜单中的 **检查更新** 使用独立的桌面端发布清单，而不是在用户电脑上直接运行 `npm update`。发布清单必须经过 Ed25519 签名；其中的 MSI 还必须通过声明大小和 SHA-256 校验。只有完成 DSH 依赖闭包、启动、profile 和插件兼容性测试的版本才应进入该清单。

当前仓库有意将 `desktopUpdate.manifestUrl` 和 `desktopUpdate.publicKey` 留空，因此开发版本会显示“更新服务尚未启用”。正式发布前由发布环境写入 HTTPS 清单地址和公钥，也可以分别通过 `DSH_DESKTOP_UPDATE_URL` 与 `DSH_DESKTOP_UPDATE_PUBLIC_KEY` 测试。当前阶段只下载并验证 MSI，不会自动执行；后续安装助手应在备份 profile、关闭完整 DSH 进程树并保留当前 `INSTALLDIR` 后再调用 Windows Installer。

## 安全边界

- Electron renderer 启用 sandbox、context isolation，并禁用 Node integration。
- 主窗口只允许本地 DSH 随机端口和内置 renderer 页面；新窗口、WebView、跨站导航与非必要浏览器权限会被拦截。
- npm 插件与 DSH 后端拥有相同的本机权限，插件中心会在安装前明确提示并要求确认来源。
- `desktop.log` 会轮转，并对常见 API Key、Bearer Token、密码和 secret 字段进行脱敏。
