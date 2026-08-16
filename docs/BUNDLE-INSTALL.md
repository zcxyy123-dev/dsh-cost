# DSH Bundle 插件包安装（推荐方式）

这是本仓库的**官方推荐分享/部署格式**：仓库根目录就是一个 DSH bundle 插件包
（`package.json` 声明 `dsh.bundle` + `dsh.client`），用户用 DSH 自带的插件命令一条
命令安装，**不需要 Cordis 会话、不需要提示词、不需要审批**，且随 DSH 进程常驻，
重启后依然生效。

- 动态插件（`dsh-plugin/usage-display.plugin.json` + Cordis 会话）仍是可用的替代方式，
  见 [DEEPSEEK-DEPLOY.md](DEEPSEEK-DEPLOY.md)。
- 浏览器扩展 / 油猴 / 控制台注入仍是免安装的临时形态，见 README「其他安装形态」。

## 包结构（DSH 插件接口契约）

| 文件 | 作用 |
|---|---|
| `package.json` | 插件包 manifest：`dsh.bundle.patch`（宿主半入口层）、`dsh.client`（浏览器 bundle 声明）、`exports["./client"]` |
| `cordis.patch.yml` | 宿主半的 patch 层：插入 `dsh-cost-usage-display` 插件条目 |
| `lib/host.js` | 宿主半：`/dshu/api/proxy`（官方接口代理，免 CORS）、`/dshu/api/apikey`（宿主凭证解析）；带回环信任栅栏与 URL/头白名单 |
| `client/bundle.js` | 浏览器半：DSH 模块加载器格式（`__ModuleLoader__.load`），运行 `usage-display.js` 核心（右侧第四列 用量/文件 + 回合标注） |

校验命令：`node verify-bundle.js`（产物一致性、包结构、语法），`node test-bundle-host.js`（宿主半单测）。

## 安装

前置：DSH 已以 web profile 运行（`dsh web`），本机有 `pnpm`。

### 方式 A：从 GitHub 安装（分享给别人的标准方式）

```bash
dsh plugin --profile web add github:zcxyy123-dev/dsh-cost
```

### 方式 B：本地目录安装（开发/试用）

在仓库 checkout 目录里执行（`add .` 以当前目录为包）：

```bash
dsh plugin --profile web add .
```

> 提示：如果 profile 尚未初始化，`dsh plugin --profile web ...` 会先按模板初始化
> （web = base + web-app）。Git 托管安装若被 pnpm 的 allowBuilds 拦截（本包没有
> 构建脚本，通常不会），按提示把 `pnpm-workspace.yaml` 的 allowBuilds 键补上即可。

### 安装后

1. **重启 DSH**（bundle 插件在启动时挂载；宿主半随 Loader 生效，浏览器半随
   `__DSH_BOOT__` 清单注入）。
2. 打开 `http://127.0.0.1:3080`，刷新页面。
3. 验收：右侧出现第四列，顶部有 **用量 / 文件** 标签；切换会话有加载遮罩；
   已完成回合底部有输入/输出/费用标注。

## 卸载

```bash
dsh plugin --profile web remove dsh-cost-usage-display
```

重启 DSH 后面板消失、路由移除。宿主半与浏览器半随插件条目一并卸载。

## 验证要点

| 检查 | 方法 |
|---|---|
| 宿主半已挂载 | 浏览器访问 `http://127.0.0.1:3080/dshu/api/apikey`（页面正常应返回 JSON，非 404） |
| 浏览器半已挂载 | DevTools → Network：`/plugins/dsh-cost-usage-display/client.js` 返回 200 |
| 产物一致性 | 仓库内 `node verify-bundle.js` 输出 `Bundle verification passed.` |
| 官方余额 | 面板「官方账户」应自动带出宿主凭证中的 API Key（`DEEPSEEK_API_KEY`）并查询余额 |

## 安全设计（宿主半路由）

- `/dshu/api/proxy` 只转发白名单内的官方 URL（api.deepseek.com / platform.deepseek.com
  的固定路径），只透传 `authorization`（须 Bearer）与 `accept` 头，其余一律丢弃。
- 两个路由都要求回环 Host（防 DNS rebinding）、拒绝跨站 fetch 标记与不匹配的 Origin。
- 凭证只回给同源页面，不落盘、不进日志；面板侧 Key 仅存本机 `localStorage`。

## 常见问题

| 现象 | 处理 |
|---|---|
| 第四列不出现 | 确认 `/plugins/dsh-cost-usage-display/client.js` 200、页面刷新过、DSH 已重启 |
| `/dshu/api/apikey` 404 | 宿主半未挂载：检查 `dsh.profile.bundles` 是否包含本包、DSH 是否重启 |
| 与动态插件同时运行 | 二者会互相检测并跳过重复挂载；建议只保留一种安装方式 |
| 官方余额显示加载失败 | 检查宿主网络能否直连 api.deepseek.com（代理/防火墙） |
