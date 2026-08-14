---
name: dsh-usage-display
description: 为 DeepSeek Harness Web GUI（dsh web）安装/使用/移除用量显示面板（上下文窗口、缓存命中、费用、请求数、累计 tokens）。安装方式：浏览器扩展、Tampermonkey 油猴脚本、控制台粘贴三种。
---

# DSH 用量显示 Skill

用户要求"给 DSH 网页加用量显示 / 查看会话用量 / tokens 统计 / 费用统计"时使用本技能。
产物目录（单一代码源）：仓库根目录（即本 skill 文件所在仓库的根目录，下文以 `<repo>` 代指）

## 快速安装（按推荐顺序）

### 方式 1：Tampermonkey 油猴脚本（最简单，推荐）
1. 浏览器安装 Tampermonkey 扩展。
2. 打开 `userscript/用量显示.user.js`，Tampermonkey 会自动弹出安装页，点"安装"。
3. 刷新 DSH 网页（http://127.0.0.1:3080），右下角出现悬浮面板。

### 方式 2：Chrome/Edge 扩展
1. 浏览器打开 `chrome://extensions`（Edge 是 `edge://extensions`）。
2. 开启右上角"开发者模式"。
3. 点"加载已解压的扩展程序"，选择 `extension/` 目录。
4. 刷新 DSH 网页即可。扩展匹配 `http://127.0.0.1/*` 与 `http://localhost/*` 任意端口。

### 方式 3：控制台粘贴（临时/免安装）
1. 打开 DSH 网页，按 F12 → Console。
2. 粘贴 `console/用量显示-控制台注入.js` 全部内容回车。
3. 刷新页面即移除（或执行 `__DSH_USAGE_DISPLAY.destroy()`）。

## 数据来源与口径

- 全部数据来自页面**同源** API（`POST /api/session.history` 及其 `projections`），无外部网络请求。
- 当前会话 id 读取 `localStorage["dsh.sessions.current"]`（与 GUI 同一存储键）。
- 累计用量、缓存命中率、上下文占用（已用/距压缩/窗口）取自服务端 token-meter 投影
  （`tokenUsage` / `contextPressure`），与宿主计算口径一致。
- 费用为本地估算（与 Reasonix 同款口径）：API/宿主只返回 token 数、从不返回金额，
  所以用价目表 × token 数计算。价目表内置 Reasonix 开源仓库
  （`src/telemetry/stats.ts` 的 `DEEPSEEK_PRICING`）同款：v4-flash/chat/reasoner
  命中 $0.0028/M、未命中 $0.14/M、输出 $0.28/M；v4-pro 命中 $0.003625/M、
  未命中 $0.435/M、输出 $0.87/M。自动识别会话模型（`assistant/message` 的
  `source.model`），默认按人民币显示（USD × 7.14）。以上均可在
  `usage-display.js` 顶部 `CONFIG.pricing` / `CONFIG.currency` / `CONFIG.cnyRate` 修改。

## 面板功能

- 上下文窗口：已用 / 窗口、压缩阈值（默认 80%）、距压缩余量、状态徽标（充足/紧张/到阈值）。
- 会话指标：平均命中率、会话费用、运行时间、请求数、累计 tokens。
- 用量分析：按来源（主模型 / 子代理，调 `subagent.list`）、按类型（输入/输出）切换；
  明细支持输入/输出 与 命中/未命中 双视图。
- 工作区文件：当前会话 cwd 目录树（本地桥 /tree）、文本预览（本地桥 /file，
  500KB/二进制过滤）、📂 打开文件夹与 ↗ 默认程序打开（宿主 RPC `host.openPath`）。
- 官方账户（⚙ 配置）：API Key 直连 `api.deepseek.com/user/balance` 查**真实余额**；
  平台 userToken 查**官方今日/本月费用与用量**（`platform.deepseek.com/api/v0/usage/*`，
  聚合语义照 CodexBar）。凭证只存本机 localStorage、只发官方域名。
- 颜色跟随 DSH 亮/暗主题（--dsw-* 语义变量）。
- 每 5 秒自动刷新（`CONFIG.refreshMs`），官方数据每 60 秒（`CONFIG.officialRefreshMs`）。

## 凭证配置（官方账户）

1. **免粘贴（推荐）**：双击 `setup-key.bat`（或 `node setup-key.js`）——自动读取
   DSH 凭证文件（`~/.dsh/.credentials.yaml`）里的 API Key，启动 127.0.0.1 一次性
   服务，面板数秒内自动导入并关闭服务，官方余额即时显示。
2. 要官方费用：登录 platform.deepseek.com → F12 → Application → Local Storage →
   复制 `userToken` → ⚙ 粘贴保存。
3. 形态能力：余额三种形态都可用（CORS 放行）；官方费用需要扩展版或油猴版
   （平台接口拦截页面直连，由扩展后台 / 油猴 GM_xhr 转发）。控制台版只显示余额。

## 移除

- 油猴：禁用脚本后刷新页面。
- 扩展：扩展页移除后刷新页面。
- 控制台：`__DSH_USAGE_DISPLAY.destroy()` 或刷新页面。

## 重新构建产物（改了核心之后）

```bash
cd <repo>            # <repo> = 仓库根目录
node build.js        # 重新生成油猴/控制台/扩展副本
node verify-artifacts.js   # 验证三个产物可加载且管线正常（需 dsh web 在 3080 运行）
```

## 排查

- 面板不出现：确认页面地址是 `http://127.0.0.1:3080`（或 localhost）；刷新页面。
- 显示"等待会话数据"：页面还没选定会话，等 5 秒自动重试。
- 显示"加载失败"：确认 dsh web 服务在运行；F12 Console 看 `[用量显示]` 调试日志（可设 `CONFIG.debug=true`）。
- 数字对不上：确认面板右上角会话与当前 GUI 选中会话一致（面板跟随 GUI 的当前会话）。
