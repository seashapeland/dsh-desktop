# dsh-deepseek-balance

在 DSH 里直接查看你的 DeepSeek API 用量与余额，不用再打开 platform.deepseek.com。

这是一个标准的 DSH 双端（host + client）插件，兼容官方 `dsh web`（浏览器方式）和任何按官方机制加载插件的桌面封装。它新增一个 **设置 → DeepSeek 用量** 页面，布局复刻官方 platform.deepseek.com 的「用量信息」模板：

- **充值余额**（真实数据，带货币符号与可用状态徽标；如有赠送余额会一并显示）
- **累计消费金额 / 消费金额 / API 请求次数 / Tokens** 行
- **按模型的用量卡片**（消费金额 / 请求次数 / Tokens）
- 「所有日期均按 GMT+8 时间显示，数据可能有 5 分钟延迟」说明
- 最后更新时间、手动刷新按钮（打开页面时每 60 秒自动刷新）
- 「前往 platform.deepseek.com 查看用量」「余额与充值」链接

> ⚠️ **用量数据的限制**：DeepSeek 官方目前**没有**按 API Key 查询用量明细（累计消费、请求次数、Tokens）的接口——这些数字只能在 platform.deepseek.com 网页上看到。因此累计消费/请求次数/Tokens 行会显示「—」并提示官方未开放，点击按钮跳转官方页面查看。插件内置了对候选用量接口的探测（`/user/usage`、`/dashboard/billing/usage`、`/v1/dashboard/billing/usage`），**一旦官方开放接口，本页面会自动显示真实数据**，无需升级。

## 工作原理

```
浏览器（客户端 bundle）                       宿主进程（host 插件）
┌────────────────────────────┐  same-origin  ┌───────────────────────────────┐
│ 设置 → DeepSeek 用量 页面    │ ── fetch ───▶ │ GET /dsh-deepseek-balance/    │
│ (settings.section 槽点)     │ ◀── JSON ──── │     api/balance               │
│                            │               │ GET /dsh-deepseek-balance/    │
│                            │               │     api/usage（探测，可能 404）│
└────────────────────────────┘               │    ↓ ctx.credentials.resolve  │
                                             │    ↓ GET api.deepseek.com/…    │
                                             └───────────────────────────────┘
```

- **API Key 复用 DSH 凭据域**：优先读取你在 **设置 → 模型** 里配置的 `DEEPSEEK_API_KEY`（存储于 `$DSH_HOME/.credentials.yaml`），其次是环境变量 `DEEPSEEK_API_KEY` 或 `.env`。你不需要把 Key 填第二次，Key 也不会出现在浏览器侧或任何响应里。
- **无 CORS 问题**：浏览器只请求 DSH 自己的本地路由，由宿主进程去访问 `api.deepseek.com`。
- **不泄露 Key**：host 路由从不把 Key 返回给客户端，只返回余额/用量数据或错误码。
- **设置导航图标**：DSH 设置面板只为内置分区（模型/角色/插件）分配专属图标，第三方分区一律显示齿轮（与「通用」相同）。本插件注入一条样式规则，给「DeepSeek 用量」导航项换上用量柱状图标，且用结构性选择器定位（始终最后一个导航项），DSH 升级后若结构变化只会退回齿轮，不会出错。

## 安装

要求：DSH（`dsh` CLI）可用。下面的命令会初始化/使用 `web` profile（存在 `$DSH_HOME/profiles/web`）。

### 从 npm 发布安装

```bash
dsh plugin --profile web add dsh-deepseek-balance
```

安装后重启 dsh，然后在界面左下角 **设置 → DeepSeek 用量** 查看。

> `dsh plugin ... add` 在 profile 目录里执行 `pnpm add`，所以需要本机装有 pnpm（corepack 里自带：`corepack enable pnpm`）。

### 从本地目录 / Git 安装

```bash
dsh plugin --profile web add /path/to/dsh-deepseek-balance
# 或
dsh plugin --profile web add https://github.com/you/dsh-deepseek-balance.git
```

### 桌面封装（无 pnpm 时的手动安装）

如果封装环境没有 pnpm（例如 DSH Desktop），可以用仓库里的一键脚本（会自动备份 `package.json`）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop.ps1
# 自定义 profile / DSH 数据目录：
powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop.ps1 -Profile web -DshHome "D:\my-dsh-home"
```

脚本会做两件事：把包复制到 `$DSH_HOME/profiles/node_modules/dsh-deepseek-balance/`（与 DSH 安装的 flat fallback 目录同级，Node 的父目录查找会找到它），并把 `"dsh-deepseek-balance"` 追加到 `dsh.profile.bundles` 末尾。手动做也一样：

1. 把本包复制到 `$DSH_HOME/profiles/node_modules/dsh-deepseek-balance/`。
2. 编辑 `$DSH_HOME/profiles/web/package.json`，把 `"dsh-deepseek-balance"` 追加到 `dsh.profile.bundles` 列表末尾：

   ```json
   "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-deepseek-balance"] } }
   ```

3. 重启 dsh / 桌面应用。

**卸载**：从 `dsh.profile.bundles` 移除该项（或恢复脚本备份的 `package.json.dsh-balance.bak`），删除 `profiles/node_modules/dsh-deepseek-balance/` 文件夹，重启。

`dsh.profile.bundles` 会按顺序应用每个包的 `cordis.patch.yml`，本包的 patch 只插入一行 loader 条目（host 半区），同一行上的 `dsh.client` 声明同时让浏览器拿到客户端 bundle。

## 如何分享给别人

这是一个标准 DSH 插件包，别人拿到后按上面「安装」任意一种方式装进自己的 profile 即可。有四种分发途径：

### ① 直接拷目录 / 一键脚本（最省事，推荐先这样）

把整个仓库（或只拷 `package.json`、`cordis.patch.yml`、`lib/`、`README.md`）发给别人：

- 官方 `dsh web`（有 pnpm）：`dsh plugin --profile web add /path/to/dsh-deepseek-balance`
- DSH Desktop 等无 pnpm 的封装：让对方运行 `scripts/install-desktop.ps1`（见「桌面封装」一节）

### ② 打包成 tarball 发文件

```bash
cd dsh-deepseek-balance
npm pack            # 生成 dsh-deepseek-balance-0.2.0.tgz
```

对方拿到 tgz 后：

```bash
dsh plugin --profile web add ./dsh-deepseek-balance-0.2.0.tgz   # 有 pnpm 的官方 dsh
# 桌面封装：解压后运行 scripts/install-desktop.ps1
```

### ③ Git 仓库

推送到 GitHub 后：`dsh plugin --profile web add https://github.com/<你>/dsh-deepseek-balance.git`（git 安装的插件首次需要按提示在 profile 的 `pnpm-workspace.yaml` 里允许构建脚本）。

### ④ 发布到 npm（可选，注意命名）

`dsh plugin --profile web add dsh-deepseek-balance` 需要这个名字在 npm 上可用。**注意：npm 上已存在同名的另一个插件**（`dsh-deepseek-balance@0.1.0`，一个 shell.overlay 余额徽章，与本品功能不同），所以直接发布会被拒绝。二选一：

- **用 npm scope**（推荐）：把包名改成 `@<你的用户名>/dsh-deepseek-balance` 后发布，对方用 `dsh plugin --profile web add @<你的用户名>/dsh-deepseek-balance` 安装；
- **换一个全局唯一的名字**，例如 `dsh-deepseek-usage`。

改名时一共要同步 3 处（客户端 bundle 的 id 必须等于包名，否则浏览器侧不加载）：

| 位置 | 内容 |
|---|---|
| `package.json` | `"name"` |
| `cordis.patch.yml` | 插入行的 `name:` |
| `lib/client.js` | `window.__ModuleLoader__.load({ id: "<包名>" })` |

（本地路由前缀 `/dsh-deepseek-balance/...` 与包名无关，可保持不变；桌面端手动安装时，fallback 目录名和 `dsh.profile.bundles` 里的字符串也要跟着新包名改。）

发布命令：`npm login && npm publish`（发布前记得 `npm run check` 自测）。

### 兼容性提示

- 插件面向 DSH `0.1.0-rc.x`（`dsh` npm 包）的 web profile，使用官方槽点 `settings.section` 与宿主服务 `webServer`/`credentials`；其他大版本 DSH 如遇不兼容，优先升级 DSH。
- 用量明细（累计消费/请求次数/Tokens）依赖 DeepSeek 官方是否开放按 API Key 的用量接口，目前不可用，页面会显示「—」并引导到官方网页（见上文说明）。

## 配置

插件默认无需配置。如需要覆盖，在 profile 的 `cordis.patch.yml`（用户层）里按 id 覆盖：

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: deepseek-balance
  config:
    baseUrl: https://api.deepseek.com   # 上游 API 地址
    apiKeyRef: DEEPSEEK_API_KEY          # 使用的凭据引用（环境变量名）
    route: /dsh-deepseek-balance         # 本地路由前缀
```

## 本地开发

```bash
cd plugins/dsh-deepseek-balance
npm run check          # 语法检查 host 与 client 两个文件
```

- `lib/index.js` — host 半区（cordis 插件，注册本地路由并代理余额请求）。
- `lib/client.js` — 客户端 bundle（`window.__ModuleLoader__.load` 格式，注册 `settings.section` 页面）。
- `cordis.patch.yml` — bundle patch：把 host 行插入 loader 树。

### 调试

- 路由测试：启动 dsh web 后访问 `http://127.0.0.1:<port>/dsh-deepseek-balance/api/balance`，会返回 JSON（`ok:false` 的 `NO_KEY` / `UPSTREAM` / `NETWORK`，或 `ok:true` 的余额数据）。
- 客户端 bundle 只在浏览器里执行；`settings.section` 是官方槽点，DSH 自身的设置页也用同一机制（如「插件」页面）。

## 常见问题

- **页面显示“尚未配置 API Key”**：去 **设置 → 模型** 填好 DeepSeek API Key，或设置环境变量 `DEEPSEEK_API_KEY` 后重启。
- **页面显示“DeepSeek API 返回错误”**：通常是 Key 无效（401）或余额不足（402），详情会显示在页面里。
- **桌面封装里点“前往 platform.deepseek.com”没反应**：有些 Electron 封装会拦截新窗口；这是桌面壳的策略，浏览器方式（官方 `dsh web`）不受影响。

## License

MIT
