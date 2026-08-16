# 用量显示动态插件

## 版本

当前唯一可部署版本：**`main / embedded-grid-column`（v2.0.0）**。旧版 1.x
（`main / details-sidebar`）一律不部署。

部署产物 `usage-display.plugin.json` 顶层必须带有版本标识字段：

| 字段 | 必须等于 |
|---|---|
| `version` | `2.0.0` |
| `release` | `main / embedded-grid-column` |

它由 `usage-display.js` 生成一个受 Cordis 保护的 Client，再与 `host-half.js` 打包成
`usage-display.plugin.json`。正确界面是 DSH 右侧新增第四列，包含 `用量 / 文件` 标签、
加载遮罩和回合用量标注；不是旧 `details` 侧栏，也不是右下角浮窗。

## 文件

| 文件 | 作用 |
|---|---|
| `usage-display.plugin.json` | 唯一可交给 `cordis_define` 的完整部署产物。 |
| `host-half.js` | 受控会话、子代理、文件和官方账户 RPC。 |
| `build-client.js` | 从根目录 `usage-display.js` 生成 Cordis Client 包装层。 |
| `client-half.js` | 自动生成；不要手工编辑。 |
| `release.js` | 发布标识的单一来源。 |
| `verify-plugin.js` | 校验源码、生成产物和新版 UI 特征。 |

## 安装前校验

```bash
node dsh-plugin/verify-plugin.js
```

仅当输出包含以下三行时才可部署：

```text
Plugin verification passed.
Version: 2.0.0
Release: main / embedded-grid-column
```

当前 DSH Agent 会话还必须同时有 `cordis_define` 与 `cordis_run`。没有这些工具的标准模式
不能安装此包，也不能用内部 API、隐藏会话或权限绕过代替。

## 安装

将 `usage-display.plugin.json` 以**完整结构化 JSON**交给当前 Cordis 会话中的 Agent，并要求：

1. 原样读取 `name`、`purpose`、`code.host`、`code.client`。
2. 调用 `cordis_define`，使用 `kind: new` 和 `idPrefix: usgdp`。
3. 只对定义结果返回的实例调用 `cordis_run`。
4. 需要批准时等待用户在 GUI 中批准。

不要把大型 `code` 字段从聊天输出复制出来；读取被截断时必须停止。已有 `usgdp-*` 实例时，
先报告，未经用户确认不得停止或覆盖。

完整可复制提示词和故障矩阵见 [../docs/DEEPSEEK-DEPLOY.md](../docs/DEEPSEEK-DEPLOY.md)。

## 验收与移除

刷新 DSH 页面后检查第四列、`用量 / 文件`、会话切换加载遮罩和回合标注。关闭面板后刷新页面
可重新挂载。

- 临时停用：让 Cordis 会话执行 `cordis_stop`。
- 永久移除：在用户确认后执行 `cordis_undefine`。

动态插件是进程级扩展；DSH 重启后需要重新安装。

## 维护者构建

```bash
node dsh-plugin/build-plugin.js
node dsh-plugin/verify-plugin.js
node dsh-plugin/test-client-build.js
node dsh-plugin/test-host-half.js
```
