# DSH 用量显示

为 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web GUI 显示当前会话的
上下文占用、缓存命中率、token、费用估算、请求数、文件视图和回合用量标注。项目独立
分发，不修改或重启 DSH 源码服务。

## 安装方式

**推荐：Bundle 插件包（DSH 官方插件接口，一条命令安装，重启常驻）**

本仓库根目录就是标准 DSH bundle 插件包，安装：

```bash
dsh plugin --profile web add github:zcxyy123-dev/dsh-cost
```

重启 DSH 并刷新页面即可。详细说明、卸载与验证见 [Bundle 安装文档](docs/BUNDLE-INSTALL.md)。

**备选：动态插件（Cordis 会话部署）**：见 [DeepSeek 安全部署提示词](docs/DEEPSEEK-DEPLOY.md)。

**临时形态**：Chrome/Edge 扩展（`extension/`）、Tampermonkey（`userscript/`）、
控制台注入（`console/`）——无需安装命令，见下方「其他安装形态」。

## 最新版定义

**唯一受支持的动态插件版本是 `main / embedded-grid-column`（v2.0.0）。**

| 项目 | 正确值 |
|---|---|
| GitHub 仓库 | `https://github.com/zcxyy123-dev/dsh-cost.git` |
| 代码来源 | 干净工作区中的 `origin/main` |
| 部署产物 | `dsh-plugin/usage-display.plugin.json` |
| JSON `version` 字段 | `2.0.0`（旧版 1.x 一律拒绝） |
| JSON `release` 字段 | `main / embedded-grid-column` |
| 构建来源 | `usage-display.js` + `dsh-plugin/host-half.js` + `dsh-plugin/build-client.js` |
| 发布校验 | `node dsh-plugin/verify-plugin.js`（必须输出 passed / `Version: 2.0.0` / `Release: main / embedded-grid-column`） |
| 界面验收 | DSH 右侧新增第四列，带 `用量 / 文件` 标签、加载遮罩和回合用量标注 |

不要部署旧的 `main / details-sidebar` 包。旧包会占用 DSH `details` 侧栏；本仓库当前
目标既不是那个侧栏，也不是右下角悬浮窗。看到第四列才是正确的最新版。

实际部署提交必须由 `git rev-parse HEAD` 记录。发布标识描述界面形态，提交 SHA 才是可
复现的精确版本。

## 给 DeepSeek 部署

请直接使用 [DeepSeek 安全部署提示词](docs/DEEPSEEK-DEPLOY.md)。它要求 Agent 依次检查：

1. 当前会话是否已经有 `cordis_define` 和 `cordis_run`。
2. 本地仓库是否干净且已 fast-forward 到 `origin/main`。
3. 动态插件 JSON 是否通过确定性校验（`version: 2.0.0`、`release: main / embedded-grid-column`）。
4. 用户是否正常批准 `cordis_run`。
5. 界面是否为第四列而不是旧 `details` 侧栏。

标准模式缺少 Cordis 工具时必须停止，让用户切换到 Cordis 会话。禁止创建隐藏辅助会话、
调用 DSH 内部 API/WebSocket、修改权限边界或绕过用户审批。完整操作、验收和故障矩阵见
[Agent 部署手册](docs/AGENT-GUIDE.md)。

## 前置条件

- DSH Web GUI 已在 `http://127.0.0.1:3080` 运行。
- 要安装动态插件的 DSH 会话同时提供 `cordis_define` 和 `cordis_run`。
- Node.js v18+ 用于本地构建与校验；已构建的 JSON 本身不要求用户安装 Node.js。

## 功能

- 上下文窗口、压缩阈值、缓存命中率、费用估算、请求数和累计 token。
- `用量 / 文件` 双视图，支持当前工作区文件树和受限文本预览。
- 已完成聊天回合底部的输入、输出和费用标注。
- 跟随 DSH 亮暗主题；切换会话时显示加载遮罩并刷新数据。
- 可选读取 DeepSeek 官方余额和平台用量；**OpenCode Go（opencode-go 提供方）
  三窗口额度**：滚动5h / 周 / 月 的已用百分比、剩余与重置倒计时
  （`GET https://opencode.ai/zen/go/v1/usage`，Bearer Key；Key 自动取自宿主凭证
  `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY` 或 ⚙ 手动粘贴 `sk-opencode-…`）。
- **计费去向自动识别**：官方账户区块顶部显示"本会话计费"的商家、模型与所用 Key
  （掩码，如 `OPENCODE_GO_API_KEY ···Wles`）。判据以会话事件 `source.provider`
  （tokens 实际计费的提供方）为权威，其次按模型/Key 形态兜底；空白会话回退宿主
  默认模型路由（`agent-default-model`）。面板展示的每个余额/额度数字旁都标注了
  所用 Key 的掩码，一眼可辨"这是哪一个 Key 的哪一个商家"。
- **凭证与宿主自动对齐**：本地 `localStorage` 里的 Key 每 30 秒与宿主凭证比对，
  换 Key / 旧 Key 失效时自动以宿主为准覆盖（宿主凭证 = 本会话模型路由实际使用的
  Key），余额/额度始终查询"本会话真正计费的账户"。

## 其他安装形态

不需要 Cordis 工具时，可用浏览器端产物：

- Chrome/Edge：加载 `extension/` 目录后刷新 DSH 页面。
- Tampermonkey：安装 `userscript/用量显示.user.js`。
- 临时试用：在 DSH DevTools Console 执行 `console/用量显示-控制台注入.js`。

这些形态同样使用 `usage-display.js` 的第四列核心。动态插件是进程级扩展，DSH 重启后需
按上面的部署流程重新定义并运行。

## 构建与校验

修改核心或动态插件后，在仓库根目录运行：

```bash
node build.js
node dsh-plugin/build-plugin.js
node dsh-plugin/verify-plugin.js
node dsh-plugin/test-client-build.js
node dsh-plugin/test-host-half.js
```

修改核心后还需重新生成 bundle 插件包并校验：

```bash
node build-bundle.js
node verify-bundle.js
node test-bundle-host.js
```

常规核心测试：

```bash
node test-loading.js
node test-annotate.js
node test-official.js
```

`check-integrity.js` 是函数引用完整性检查（已修复误报，`node check-integrity.js` 应输出
`PASS 无缺失函数引用`）；动态插件的权威校验是 `dsh-plugin/verify-plugin.js`。

## 数据与凭证

会话与文件数据通过受控 DSH 服务读取。动态插件 Client 只通过 `host.call` 和 Cordis
`timer` 服务工作，不使用页面全局网络或定时器来绕开运行器限制。

官方余额功能会尝试解析 DSH 已配置的 `DEEPSEEK_API_KEY`，并将可用 Key 存入本机该站点
的浏览器 `localStorage`；OpenCode Go 额度会用 `OPENCODE_GO_API_KEY` /
`OPENCODE_API_KEY`（或手动粘贴的 `sk-opencode-…` Key）。平台用量需要用户手动填入
`userToken`。不要将任一凭证写入 Issue、聊天记录、日志或提交。

## 目录

```text
usage-display.js                  第四列核心和回合标注
package.json                      bundle 插件包 manifest（dsh.bundle / dsh.client）
cordis.patch.yml                  bundle 宿主半插件入口层
lib/host.js                       bundle 宿主半（官方接口代理 / 凭证解析）
client/bundle.js                  bundle 浏览器半（DSH 模块加载器格式，生成物）
build-bundle.js                   client/bundle.js 生成器
verify-bundle.js                  bundle 包结构校验
test-bundle-host.js               bundle 宿主半单测
dsh-plugin/usage-display.plugin.json  动态插件可部署 JSON
docs/DEEPSEEK-DEPLOY.md           动态插件部署提示词
docs/BUNDLE-INSTALL.md            bundle 插件包安装文档
docs/AGENT-GUIDE.md               完整部署与验收手册
```

## License

[MIT](LICENSE)
