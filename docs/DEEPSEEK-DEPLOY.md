# 给 DeepSeek 的最新版安全部署提示词

这份文档解决两个常见误部署问题：把旧的 `details` 侧栏包当作最新版，以及在没有
Cordis 工具的标准会话中通过隐藏会话、内部 API 或审批绕过强行安装。

> 真实案例（本仓库维护者遇到并修复的）：一次部署会话直接 `git clone` 了 GitHub
> 仓库，而当时仓库 `origin/main` 上还只有旧版 `details-sidebar` 包；本地工作区里
> 的 v2.0.0 新版从未提交，于是部署结果就是"旧版本"。修复方式就是下面这套
> **版本契约 + 逐项门禁**：任何版本、发布标识、校验输出不匹配的包一律不得部署。

## 唯一目标版本

| 项目 | 必须满足的值 |
|---|---|
| GitHub 仓库 | `https://github.com/zcxyy123-dev/dsh-cost.git` |
| 更新通道 | `origin/main`（部署前必须 `git fetch origin main` + `git merge --ff-only origin/main`） |
| 部署文件 | `dsh-plugin/usage-display.plugin.json` |
| JSON `version` 字段 | `2.0.0`（旧版 1.x 一律拒绝） |
| JSON `release` 字段 | `main / embedded-grid-column` |
| 发布标识 | `main / embedded-grid-column`（不是 `details-sidebar`，不是悬浮窗） |
| 当前部署提交 | 更新后 `git rev-parse HEAD` 的完整输出 |
| 产物校验 | `node dsh-plugin/verify-plugin.js` 必须输出 `Plugin verification passed.`、`Version: 2.0.0`、`Release: main / embedded-grid-column` |

"最新版"的界面特征：DSH 主布局右侧新增的**第四列**，顶部有 **`用量`** 和 **`文件`**
标签；切换会话时出现加载遮罩，已完成回合底部出现用量标注。出现旧的 `details` 侧栏或
右下角悬浮窗 = 旧包，必须停止。

本项目不依赖一个可猜测的 DSH 数字版本。实际兼容性门槛是：目标 DSH 会话的工具列表
同时包含 `cordis_define` 和 `cordis_run`。部署前必须以这个能力检查为准。

## 发送前准备

1. 在 DSH 中由用户自己进入一个 Cordis 会话。新建会话时选择 `cordis` 预设，或确认
   该会话的工具面板已显示 `cordis_define` 与 `cordis_run`。
2. 让 DeepSeek 在本地使用仓库克隆或工作目录，不要从聊天记录、截图或旧目录取 JSON。
3. DSH Web GUI 应已运行在 `http://127.0.0.1:3080`；用于校验的 Node.js 建议为 v18 或更高。

标准模式没有上述工具时，下面的提示词会要求 DeepSeek 停止。这是预期安全行为，不是
部署失败。

## 可直接发送的提示词

把下面代码块原样发给**当前已经具备 Cordis 工具的 DeepSeek 会话**：

```text
请将 GitHub 仓库 https://github.com/zcxyy123-dev/dsh-cost.git 的最新版部署为 DSH 动态插件。严格执行以下协议；任一停止条件满足时立即停止并报告，不要自行寻找绕过方式。

目标版本（全部必须满足，任一不满足即停止）：
- 唯一发布通道：origin/main，部署前必须 git fetch origin main 并 git merge --ff-only origin/main。
- 唯一部署文件：dsh-plugin/usage-display.plugin.json。
- 该 JSON 顶层的 version 字段必须严格等于 2.0.0，release 字段必须严格等于 "main / embedded-grid-column"。
- 发布标识必须是：main / embedded-grid-column。旧的 main / details-sidebar 或右下角悬浮窗都不是本次目标。
- 运行 node dsh-plugin/verify-plugin.js，输出必须同时包含三行：Plugin verification passed.、Version: 2.0.0、Release: main / embedded-grid-column。
- 正确验收界面：DSH 右侧新增第四列，顶部有“用量 / 文件”标签、切换会话有加载遮罩、已完成回合底部有用量标注。

安全边界（违反任一条即停止）：
1. 先检查你当前会话的工具列表。只有同时存在 cordis_define 和 cordis_run 才能继续；缺少任一工具时，停止并让我切换到 Cordis 会话。禁止创建隐藏辅助会话，禁止调用 DSH 内部 /api 或 WebSocket 来模拟工具，禁止修改 sandbox/权限，禁止绕过或代替我批准请求。
2. 只读/更新这个仓库；不要修改 DSH 源码、DSH 配置、凭证或现有插件。若发现已有 usgdp-* 实例，只报告名称和状态，未经我明确同意不得 cordis_stop、cordis_undefine 或覆盖它。
3. 绝不从聊天输出手工复制、截断、拼接或改写 code.host/code.client。必须在本地结构化解析完整 JSON 文件，并原样传给 cordis_define。

执行步骤：
1. 找到仓库工作目录。若需要克隆，使用该 GitHub 地址创建新目录；若目录已存在，先确认 origin 指向该地址。
2. 运行 git status --porcelain。只要输出非空就停止报告，不能覆盖或清理已有改动。
3. 在干净工作区运行 git fetch origin main，然后运行 git merge --ff-only origin/main。记录 git rev-parse HEAD 的完整输出。
4. 在仓库根目录运行 node dsh-plugin/verify-plugin.js。只有同时看到 Plugin verification passed.、Version: 2.0.0、Release: main / embedded-grid-column 三行才继续；缺少任一行、输出 Version: 1.x 或 Release 不是 main / embedded-grid-column 时，立即停止，不要部署 JSON。
5. 用 JSON 解析器读取 dsh-plugin/usage-display.plugin.json，先核对顶层 version == "2.0.0" 且 release == "main / embedded-grid-column"（与第 4 步输出一致），再将其中的 name、purpose、code.host、code.client 原样按 cordis_define 的工具 schema 传入；使用 kind: new 和 idPrefix: usgdp。严禁把 JSON 顶层任何其他字段（如 version、release）传给 cordis_define。
6. 仅对 cordis_define 成功返回的实例调用 cordis_run。若 GUI 请求用户批准，等待我在 GUI 正常批准；不要通过任何接口模拟批准。
7. 验收：如有 cordis_inspect_self，确认 Host 与 Client 都是 running；刷新 DSH 页面后检查右侧第四列、用量/文件标签、切换会话后的加载遮罩和已完成回合的用量标注。关闭面板后通过刷新页面重新挂载，不要把旧 details 侧栏当作成功。

最终报告必须包含：仓库路径、git commit（git rev-parse HEAD 完整输出）、verify-plugin 输出（含 Version 与 Release 行）、JSON 的 version/release 字段、cordis_define/cordis_run 返回的实例标识或状态、是否等待用户批准、每项验收结果和未完成项。不得输出 API Key、userToken、Cookie、完整插件代码或内部审批数据。
```

## 停止条件与处理

| 现象 | 正确处理 |
|---|---|
| 当前会话没有 `cordis_define` 或 `cordis_run` | 停止，让用户在 GUI 中换到 Cordis 会话；不能创建隐藏会话。 |
| 仓库有未提交改动 | 停止并报告 `git status`；不能 `reset`、`clean`、覆盖或合并。 |
| `verify-plugin.js` 未同时输出三行（passed / Version: 2.0.0 / Release: main / embedded-grid-column） | 停止；这说明仓库不是最新版（如仍是旧 1.x 包），先让维护者推送并重新 fetch。 |
| JSON 顶层 `version` ≠ `2.0.0` 或 `release` ≠ `main / embedded-grid-column` | 停止；仓库内容不是目标版本。 |
| JSON 校验失败或读取被截断 | 停止；维护者先修复产物并重新校验。 |
| `cordis_run` 等待批准 | 等待用户在 GUI 中批准；不能捕获审批帧或调用内部接口回应。 |
| 页面出现旧的 `details` 侧栏或右下角悬浮窗 | 这是旧发布物，停止并核对提交、version/release 字段和 SHA-256。 |
| DSH 重启后面板消失 | 动态插件是进程级扩展；重复本页的校验和定义/运行步骤。 |

## 数据与权限说明

新版动态包通过 `host.call` 访问受控的会话、子代理、文件树和文件预览 RPC，并通过
Cordis 的 `timer` 服务刷新；它不会使用页面全局 `fetch` 或浏览器定时器绕开运行器边界。

“官方账户”是可选功能。插件会尝试从 DSH 已配置的 `DEEPSEEK_API_KEY` 获取余额，并把
可用 Key 写入本机该站点的浏览器 `localStorage`；OpenCode Go 额度会取
`OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY`（或手动粘贴的 `sk-opencode-…` Key）；
平台用量只有用户手动填入 `userToken` 时才查询。部署者应先确认这一行为符合本机
凭证使用规则，且最终报告不得泄露任何凭证。
