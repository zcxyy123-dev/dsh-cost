# 用量显示 · DSH 动态插件（可分享）

把用量显示面板做成 DSH 原生插件：在 Web GUI 右下角悬浮显示**当前选中会话**的用量，
颜色跟随 DSH 主题，数据全部来自 DSH 宿主自身服务（会话投影、会话查询、子代理、
fs、shell），**不修改 DSH 仓库、无需重启服务、无需构建工具链**。

## 文件

| 文件 | 说明 |
|---|---|
| `usage-display.plugin.json` | **分享物**：`{ name, purpose, code: { host, client } }`，即 cordis_define 的输入 |
| `host-half.js` | Host 半源码（可读版，改完跑 `node build-plugin.js` 重新生成 JSON） |
| `client-half.js` | Client 半源码（可读版） |
| `build-plugin.js` | 由两个半源码重新生成 JSON 的构建脚本 |

## 安装（任何 DSH 会话，一句话）

把 `usage-display.plugin.json` 交给当前会话的 Agent，说：

> 读取 `usage-display.plugin.json`，用它的 `code.host` / `code.client` 调用
> `cordis_define`（kind: new，idPrefix 用 `usgdp`），然后 `cordis_run` 激活。

Agent 会自动完成定义与激活。激活后页面右下角出现面板（若页面未刷新，
等 Client 半加载完成即可；必要时刷新一次页面）。

## 手动安装（无 Agent 时）

1. 打开 DSH Web GUI（`http://127.0.0.1:3080`），任一会话中粘贴 `usage-display.plugin.json` 内容。
2. 请 Agent 按上面的话术执行；或自己对照 JSON 内容调用 `cordis_define` / `cordis_run` 工具。

## 卸载 / 停用

- 临时停用：会话里让 Agent 执行 `cordis_stop`。
- 永久移除：`cordis_undefine`。

## 特性

- **上下文**：窗口 / 已用（`contextPressure.projectedTokens`）/ 压缩阈值 / 距压缩，进度条随占用变色。
- **会话指标**：平均命中率、会话费用（Reasonix 同款价目表，本地估算）、运行时间、请求数（`sessionStats.steps`）、累计 tokens、主模型。
- **用量分析**：按来源（主模型 / 子代理）与按类型（输入 / 输出）双视图。
- **明细**：输入/输出、命中/未命中。
- **工作区文件**：当前会话 cwd 目录树（点击展开，≤6 层直觉深度由 fs 列表控制）、文本预览（≤500KB / 2 万字符）、系统打开（`workspaces.openPath`）。
- **官方账户**（自动）：API Key 由 Host 半**自动获取**——直读宿主凭证
  `DEEPSEEK_API_KEY`（与模型路由同一份 `.credentials.yaml`，含环境变量/`.env` 回退），
  面板加载后自动填充并查询官方余额，无需粘贴、无需本地桥；平台 userToken 可手动
  填入查官方费用——均由宿主 curl 直连官方域名（页面 CORS 不影响），凭证只存本次
  页面会话内存。⚙ 面板内有"↻ 重新自动获取"按钮。
- 跟随 GUI 选中的会话；每 5 秒刷新子代理用量；会话投影由宿主实时推送；可拖拽、可折叠、主题跟随。

## 注意

- 动态插件是**进程级临时扩展**：DSH 重启后需要重新安装（重新执行上述安装步骤即可，代码都在 JSON 里）。
- 面板不收集任何数据：请求只发往 DSH 宿主（127.0.0.1）与 DeepSeek 官方域名。
