# Agent 部署手册

面向 DeepSeek、Claude 和其他代码 Agent。目标是在不修改 DSH 源码、不重启 3080 服务、
不绕过 Cordis 安全边界的前提下，安装当前发布的用量显示动态插件。

> 快速使用：把 [DEEPSEEK-DEPLOY.md](DEEPSEEK-DEPLOY.md) 中的完整提示词发送给已经处于
> Cordis 会话的 Agent。本页解释每一步为什么必须这样做。

## 1. 发布契约

| 名称 | 值 |
|---|---|
| 仓库 | `https://github.com/zcxyy123-dev/dsh-cost.git` |
| 分支 | `origin/main` |
| 部署文件 | `dsh-plugin/usage-display.plugin.json` |
| JSON `version` 字段 | `2.0.0`（旧版 1.x 一律拒绝） |
| JSON `release` 字段 | `main / embedded-grid-column` |
| 版本标识 | `main / embedded-grid-column` |
| 精确版本 | 部署前 `git rev-parse HEAD` 的完整 SHA |
| 必经校验 | `node dsh-plugin/verify-plugin.js`（必须输出 `Plugin verification passed.`、`Version: 2.0.0`、`Release: main / embedded-grid-column` 三行） |

新版的可见特征是 DSH 主布局右侧新增一个固定宽度的**第四列**，其中有 `用量` 和 `文件`
标签。它还包含加载遮罩和聊天回合的用量标注。以下均不是最新版验收结果：

- 仅覆盖旧 `details` 侧栏的 `main / details-sidebar`。
- 右下角悬浮窗。
- 从聊天记录复制出的、无法校验来源的大 JSON。

## 2. 先检查能力，后操作文件

必须先确认当前会话的 Agent 工具列表同时有：

```text
cordis_define
cordis_run
```

这是实际 DSH 兼容性条件；不要用一个推测的 DSH 版本号替代它。标准模式通常没有这些
工具。缺少任一工具时，Agent 的唯一正确行为是停止，提示用户在 GUI 中打开/新建一个
Cordis 预设会话后重试。

严禁：

- 创建隐藏辅助 Cordis 会话，再通过内部 API 代替用户执行部署。
- 调用 `/api`、WebSocket 或直接写 DSH 存储来模拟 `cordis_define`、`cordis_run`。
- 抓取审批帧或发送审批响应来绕过用户批准。
- 修改 DSH 设置、Agent 预设、sandbox 或权限以取得工具。

## 3. 获取可复现的产物

在仓库根目录执行。命令只读取 Git 元数据和插件文件，唯一可能更新的内容是安全的
fast-forward 合并；开始前工作区必须干净。

```bash
git remote get-url origin
git status --porcelain
git fetch origin main
git merge --ff-only origin/main
git rev-parse HEAD
node --version
node dsh-plugin/verify-plugin.js
```

判定规则：

1. `origin` 必须是本页给出的 GitHub 地址。
2. `git status --porcelain` 必须没有输出；否则停止，绝不能 `reset`、`clean` 或覆盖用户改动。
3. 仅在干净工作区执行 `fetch` 和 `merge --ff-only`。
4. Node.js 建议 v18+；`verify-plugin.js` 必须同时输出 `Plugin verification passed.`、
   `Version: 2.0.0` 和 `Release: main / embedded-grid-column` 三行。
5. 用 JSON 解析器读取 `usage-display.plugin.json`，核对顶层 `version == "2.0.0"`、
   `release == "main / embedded-grid-column"`；只把 `name`、`purpose`、`code.host`、
   `code.client` 传给 `cordis_define`，不要传 `version`/`release` 等额外字段。
6. 任一校验失败时停止。不要手工修补 `usage-display.plugin.json`，应由维护者运行
   `node dsh-plugin/build-plugin.js` 重新生成并再次校验。

## 4. 定义与运行

把 JSON 作为结构化数据读取，而不是把它打印到聊天中：

```js
const plugin = JSON.parse(readCompleteFile('dsh-plugin/usage-display.plugin.json'))
```

`readCompleteFile` 代表 Agent 本地可完整读取文件的能力；任何 Read 工具若截断输出，都
不能再用该输出部署。Agent 必须把以下字段原样传给当前会话的 `cordis_define` 工具：

| 工具字段 | 来源 |
|---|---|
| `kind` | `new` |
| `idPrefix` | `usgdp` |
| `name` | `plugin.name` |
| `purpose` | `plugin.purpose` |
| Host 代码 | `plugin.code.host` |
| Client 代码 | `plugin.code.client` |

成功定义后，**只**使用该次 `cordis_define` 返回的实例标识调用 `cordis_run`。如果已经
有 `usgdp-*` 实例，先报告实例和状态，未经用户明确确认不得停止、卸载或覆盖。

如果 `cordis_run` 产生用户审批请求，Agent 必须等待 GUI 中用户的正常审批。用户拒绝、
超时或未响应时如实报告，不得尝试替代审批。

## 5. 验收清单

运行成功后刷新 DSH 页面一次，选中一个有历史消息的会话：

- [ ] 当前插件的 Host 与 Client 都处于 `running`（如有 `cordis_inspect_self`）。
- [ ] 右侧新增第四列，而非旧的 `details` 侧栏。
- [ ] 第四列能看到 `用量 / 文件` 标签。
- [ ] 切换会话时短暂出现加载遮罩，随后数据更新。
- [ ] 已完成回合底部出现输入、输出和费用标注。
- [ ] 文件标签可读取当前会话工作目录的树和受限文本预览。
- [ ] 停止插件或刷新页面后不会留下额外列、消息标注或仍在运行的刷新定时器。

面板关闭按钮会清理当前页面挂载；需要再次显示时刷新页面，由运行中的动态包重新挂载。

## 6. 可选官方账户数据

动态插件的 Host 半可读取 DSH 解析后的 `DEEPSEEK_API_KEY`（官方余额）与
`OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY`（OpenCode Go 三窗口额度：滚动5h/周/月
的已用 % 与重置时间）。Key 会被 Client 保存到本机该站点的 `localStorage`。平台用量则
要求用户自行填写 `userToken`。

这不是部署所必需的功能。Agent 不得打印、记录、复制到报告或提交 API Key、userToken、
Cookie 或原始官方响应。如果部署环境不允许浏览器本地保存 Key，应先让用户决定是否继续。

## 7. 故障矩阵

| 现象 | 正确处理 |
|---|---|
| 无 Cordis 工具 | 停止；用户切换会话。 |
| Git 工作区脏 | 停止；报告改动路径。 |
| 产物校验失败，或输出缺 `Version: 2.0.0` / `Release: main / embedded-grid-column` | 停止；仓库不是最新版，先让维护者推送，再重新 fetch/校验。 |
| JSON `version`≠`2.0.0` 或 `release`≠`main / embedded-grid-column` | 停止；仓库内容不是目标版本，不部署。 |
| JSON 截断 | 停止；改用完整结构化读取。 |
| 审批等待 | 等待用户 GUI 操作。 |
| 出现 `details` 侧栏 | 当作旧包；核对 SHA、发布标识和 manifest。 |
| 第四列不出现 | 刷新页面；确认 `cordis_run` 成功，检查 Client 状态。 |
| 显示“等待会话数据” | 选中一个会话，等待一次刷新。 |
| 显示“加载失败” | 确认 DSH 在线，检查 Host/Client 运行状态；不要改 DSH 服务。 |
| DSH 重启后消失 | 动态包是进程级；重复第 3-5 节。 |

## 8. 汇报格式

```text
部署结果：成功 / 停止 / 部分完成
仓库：<本地路径>
提交：<git rev-parse HEAD>
版本：2.0.0
发布标识：main / embedded-grid-column
插件校验：通过 / 失败（原因）
Cordis 状态：<define/run/approval/Host/Client>
验收：<逐项结果>
未完成项与下一步：<如有>
```

报告中不应包含凭证、Cookie、完整插件 JSON 或内部审批数据。
