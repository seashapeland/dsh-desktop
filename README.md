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

## 自带插件

仓库的 `plugins/` 目录包含可独立发布的标准 DSH 插件：

- [`plugins/dsh-deepseek-balance`](plugins/dsh-deepseek-balance/README.md) — 复刻官方「用量信息」模板的 DeepSeek 用量页（充值余额、累计消费/请求次数/Tokens、按模型明细、一键跳转官方页面），复用「设置 → 模型」里配置的 `DEEPSEEK_API_KEY`，无需填第二次。不依赖桌面壳，官方 `dsh web` 同样可用。

## 桌面端更新

帮助菜单中的 **检查更新** 会分别检查 npm 上的官方 DSH 版本和独立的桌面端发布清单，而不是在用户电脑上直接运行 `npm update`。官方 DSH 有新版本时只会提示等待桌面端兼容验证；桌面端发布清单必须经过 Ed25519 签名，其中的 MSI 还必须通过声明大小和 SHA-256 校验。只有完成 DSH 依赖闭包、启动、profile 和插件兼容性测试的版本才应进入该清单。

正式版本固定从 `seashapeland/dsh-desktop` 的 GitHub Releases 获取签名更新清单；开发时也可以分别通过 `DSH_DESKTOP_UPDATE_URL` 与 `DSH_DESKTOP_UPDATE_PUBLIC_KEY` 覆盖更新源。下载的 MSI 通过全部校验后，用户可以在更新窗口中明确点击 **启动安装**；应用不会静默执行未经确认的安装包。

DSH 的生产依赖安装在独立的 `runtime/node_modules`，打包时原样复制到 `resources/dsh-runtime`。这是为了保留官方插件大量使用的 peer dependency，避免 electron-builder 只按桌面应用依赖图裁剪后出现开发环境可用、安装包缺包的问题。`npm run runtime:verify` 会检查版本一致性、peer 闭包和关键启动包；`npm run dist:win` 还会在生成 MSI 后实际启动一次打包后的 DSH 并等待 HTTP 200。

维护者升级官方 DSH 时运行 `npm run update:dsh`。该命令会查询 npm 最新版本（也可传入具体版本）、同步开发与生产 runtime、生成锁文件、安装 peer、应用 Windows 目录选择器补丁并验证依赖。完成兼容测试后递增桌面端版本并打包即可。用户电脑不会直接执行 npm；发布端仍需为每个兼容版本生成签名 MSI，这让桌面壳、原生依赖和 DSH 插件 API 保持同一套经过测试的组合。

### GitHub Releases 发布通道

`.github/workflows/release.yml` 在 Windows runner 上重建并启动验证 MSI，随后用仓库 Secret `DSH_DESKTOP_UPDATE_PRIVATE_KEY` 签署 `update.json`，最后将 MSI 和清单上传到正式 GitHub Release。客户端使用固定地址 `https://github.com/<owner>/<repository>/releases/latest/download/update.json`，因此发布新版本后不需要修改旧客户端。

首次启用时需要一个公开 GitHub 仓库（私有 Release 资产无法被未登录的桌面客户端直接下载），并将本机 `.release-secrets/update-private-key.pem` 的完整内容写入同名 Actions Secret。`build/update-public-key.pem` 可以提交，它不包含签名能力。推送与 `package.json` 版本一致的 `v<version>` 标签，或从 Actions 手动运行 **Release signed Windows update** 即可发布。不要重新生成或提交私钥；若需要轮换密钥，应先发布同时信任新旧公钥的过渡版本。

## 安全边界

- Electron renderer 启用 sandbox、context isolation，并禁用 Node integration。
- 主窗口只允许本地 DSH 随机端口和内置 renderer 页面；新窗口、WebView、跨站导航与非必要浏览器权限会被拦截。
- npm 插件与 DSH 后端拥有相同的本机权限，插件中心会在安装前明确提示并要求确认来源。
- `desktop.log` 会轮转，并对常见 API Key、Bearer Token、密码和 secret 字段进行脱敏。
