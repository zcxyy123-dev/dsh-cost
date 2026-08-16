# DSH 用量显示

在 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Web GUI 中显示当前会话的用量信息：上下文窗口、token、缓存命中率、费用、请求数和工作区文件。

项目是独立分发的 JavaScript 产物，不修改 DSH 源码，不需要构建 DSH。

## 功能

- **用量面板**：上下文占用、压缩阈值、会话指标、来源/类型分析和输入输出明细。
- **回合标注**：每个已完成回合底部显示输入 token、输出 token 和费用；悬停可查看完整明细。
- **文件视图**：浏览当前会话工作区，展开目录、预览文本文件或打开文件路径。
- **主题跟随**：自动跟随 DSH 的亮色和暗色主题。
- **官方账户**：可选显示 DeepSeek API 余额和平台用量。

## 截图

### 用量面板

[![用量面板](https://cdn.jsdelivr.net/gh/zcxyy123-dev/dsh-cost@49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-panel.png)](https://github.com/zcxyy123-dev/dsh-cost/blob/49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-panel.png)

### 文件视图

[![文件视图](https://cdn.jsdelivr.net/gh/zcxyy123-dev/dsh-cost@49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-files.png)](https://github.com/zcxyy123-dev/dsh-cost/blob/49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-files.png)

### 回合标注

[![回合标注](https://cdn.jsdelivr.net/gh/zcxyy123-dev/dsh-cost@49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-annotate.png)](https://github.com/zcxyy123-dev/dsh-cost/blob/49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-annotate.png)

### 暗色主题

[![暗色主题](https://cdn.jsdelivr.net/gh/zcxyy123-dev/dsh-cost@49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-theme-dark.png)](https://github.com/zcxyy123-dev/dsh-cost/blob/49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-theme-dark.png)

### 亮色主题

[![亮色主题](https://cdn.jsdelivr.net/gh/zcxyy123-dev/dsh-cost@49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-theme-light.png)](https://github.com/zcxyy123-dev/dsh-cost/blob/49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-theme-light.png)

### 自动导入凭证

[![自动导入](https://cdn.jsdelivr.net/gh/zcxyy123-dev/dsh-cost@49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-auto-import.png)](https://github.com/zcxyy123-dev/dsh-cost/blob/49e709a5b7e091048494358723bbdb41d6f388be/docs/screenshots/screenshot-auto-import.png)

## 快速开始

前提：DSH Web GUI 已运行在 `http://127.0.0.1:3080`。

### 方式一：DSH 动态插件

这是最适合 Agent 的方式。将 [`dsh-plugin/usage-display.plugin.json`](dsh-plugin/usage-display.plugin.json) 的内容交给当前 DSH 会话中的 Agent，让 Agent 使用 `cordis_define` 定义插件，再用 `cordis_run` 激活。

完整操作和验收步骤见 [`docs/AGENT-GUIDE.md`](docs/AGENT-GUIDE.md)；插件源码和安装说明见 [`dsh-plugin/install.md`](dsh-plugin/install.md)。

### 方式二：浏览器扩展

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”，选择“加载已解压的扩展程序”。
3. 选择本项目的 `extension/` 目录，然后刷新 DSH 页面。

### 方式三：Tampermonkey 或控制台

- Tampermonkey：安装 [`userscript/用量显示.user.js`](userscript/用量显示.user.js)，然后刷新页面。
- 控制台：打开 [`console/用量显示-控制台注入.js`](console/用量显示-控制台注入.js)，复制全部内容到 DSH 的 DevTools Console 执行。

安装后，面板会出现在 DSH 右侧；切换会话时会自动刷新数据。

## 官方账户（可选）

- 激活宿主桥后，面板会自动读取 DSH 的凭证并查询余额。
- 没有宿主桥时，可运行 `node setup-key.js`，它只监听本机 `127.0.0.1:3987`，为面板提供凭证和文件浏览服务。
- 平台今日/本月用量需要在面板设置中填写 `userToken`；余额只需要 API Key。
- 完成后可关闭 `setup-key.js` 服务，不要把 API Key 或 `userToken` 写入 README、日志或提交。

## 数据口径

- 会话数据来自 DSH 同源 API：`session.history`、`subagent.list` 和 `subagent.history`。
- token、上下文和缓存命中率使用 DSH 宿主的投影数据。
- 单会话费用是根据内置价目表的本地估算；官方余额来自 DeepSeek 官方接口。

## 配置与构建

编辑 [`usage-display.js`](usage-display.js) 顶部的 `CONFIG`，可调整价格、货币、汇率、上下文窗口、刷新间隔和消息标注开关。

修改核心代码后重新生成分发产物：

```bash
node build.js
node verify-artifacts.js
```

## 开发与测试

```bash
node check-integrity.js
node test-loading.js
node test-annotate.js
node test-official.js
```

需要本地凭证桥的测试先运行 `node setup-key.js`；需要 DSH Web GUI 的 E2E 测试要求 `http://127.0.0.1:3080` 在线。`browser-e2e-*.js` 是可选的浏览器验证脚本。

## 项目结构

```text
usage-display.js                 核心面板和聊天标注
dsh-plugin/                      DSH 动态插件源码与 manifest
extension/                       Chrome/Edge 扩展
userscript/                      Tampermonkey 脚本
console/                         控制台注入脚本
docs/screenshots/                README 截图
setup-key.js                     本地凭证与文件桥
build.js                         生成分发产物
verify-artifacts.js              验证分发产物
docs/AGENT-GUIDE.md              Agent 完整部署手册
```

## 隐私与安全

- 不收集分析数据，不向第三方服务发送遥测。
- 普通用量数据只读取 DSH 同源 API；官方余额和平台用量只请求 DeepSeek 官方域名。
- 凭证只保存在当前浏览器会话、浏览器 `localStorage` 或本机回环桥中。
- 文件预览限制为不超过 500 KB，并限制文本长度；二进制文件不会直接预览。
- 通过注入脚本安装时，可执行 `window.__DSH_USAGE_DISPLAY.destroy()` 卸载面板，或直接刷新页面。

## License

[MIT](LICENSE)
