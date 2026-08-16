---
name: dsh-usage-display
description: 为 DeepSeek Harness Web GUI 安装、验收或移除 DSH 用量显示面板；动态插件最新版为 main / embedded-grid-column。
---

# DSH 用量显示 Skill

## 版本契约

- 唯一最新版：`origin/main` 的 `dsh-plugin/usage-display.plugin.json`。
- 发布标识：`main / embedded-grid-column`。
- 机器校验：`node dsh-plugin/verify-plugin.js` 必须通过。
- 验收界面：DSH 右侧新增第四列，顶部有 `用量 / 文件` 标签；另有加载遮罩和回合用量标注。
- `details` 侧栏和右下角悬浮窗不是当前动态插件版本。

## 动态插件路线

1. 先确认当前会话工具列表同时有 `cordis_define`、`cordis_run`。
2. 缺少任一工具时停止，让用户切换到 Cordis 预设会话；不要创建隐藏会话、调用内部
   `/api` 或 WebSocket、修改权限、截取审批或代替用户批准。
3. 在干净仓库中 `git fetch origin main`、`git merge --ff-only origin/main`，记录
   `git rev-parse HEAD`。
4. 运行 `node dsh-plugin/verify-plugin.js`。
5. 结构化读取完整 `dsh-plugin/usage-display.plugin.json`，原样用 `name`、`purpose`、
   `code.host`、`code.client` 调用 `cordis_define(kind: new, idPrefix: usgdp)`，再用返回实例
   调用 `cordis_run`。
6. 等待 GUI 审批后，刷新页面并按第四列验收。关闭面板后刷新页面重新挂载。

完整提示词：[docs/DEEPSEEK-DEPLOY.md](../docs/DEEPSEEK-DEPLOY.md)

## 浏览器路线

根目录 `usage-display.js` 是其他形态的核心：

- Chrome/Edge：加载 `extension/`，刷新 `http://127.0.0.1:3080`。
- Tampermonkey：安装 `userscript/用量显示.user.js`，刷新页面。
- 临时试用：在 DevTools Console 执行 `console/用量显示-控制台注入.js`。

这些形态也应看到第四列。它们不能替代动态插件的 Cordis 工具检查。

## 数据与凭证

会话、子代理、文件和官方数据来自受控 DSH 服务。动态 Client 通过 `host.call` 和
Cordis `timer` 服务运行，不使用全局网络或定时器绕过运行器。官方余额可读取 DSH 已配置
的 `DEEPSEEK_API_KEY` 并保存到当前站点 `localStorage`；平台用量需要用户手动填写
`userToken`。不要在报告或日志中输出凭证。

## 构建与测试

```bash
node build.js
node dsh-plugin/build-plugin.js
node dsh-plugin/verify-plugin.js
node dsh-plugin/test-client-build.js
node dsh-plugin/test-host-half.js
node test-loading.js
node test-annotate.js
node test-official.js
```

## 移除与排障

- 动态插件：用户确认后执行 `cordis_stop`，需要永久删除再执行 `cordis_undefine`。
- 浏览器形态：禁用/移除脚本或扩展后刷新页面。
- 无面板：检查 DSH 在线、`cordis_run` 成功、Client 状态和页面刷新。
- 旧侧栏：停止使用该包，核对 `origin/main`、提交 SHA、发布标识和校验输出。
