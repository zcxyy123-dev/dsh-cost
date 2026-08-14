/**
 * Playwright 解析器（browser-e2e-*.js / sample-theme.js / cors-probe.js 共用）
 * ================================================================
 * 这些 E2E 脚本需要 Playwright + 系统 Edge/Chrome。本模块按以下顺序解析
 * playwright 包的位置，避免硬编码机器路径：
 *
 *   1. 环境变量 PLAYWRIGHT_PATH    —— 指向任意含 playwright 包的目录/路径
 *   2. 本仓库 node_modules          —— 仓库内执行 `npm i -D playwright` 后可用
 *   3. 环境变量 DSH_HARNESS_DIR     —— 指向 DSH 仓库根目录（自动用其
 *                                      apps/web/node_modules/playwright，与 DSH 共用同一份）
 *
 * 都找不到时抛出带指引的错误，而不是静默崩溃。
 */
const fs = require('node:fs')
const path = require('node:path')

function resolvePlaywrightModule() {
  const tryResolve = (p) => {
    try { return require.resolve(p) } catch { return null }
  }

  // 1) 环境变量显式指定
  const env = process.env.PLAYWRIGHT_PATH
  if (env) {
    const r = tryResolve(env)
    if (r) return r
  }

  // 2) 本仓库 node_modules（npm i -D playwright）
  const local = tryResolve('playwright')
  if (local) return local

  // 3) DSH 仓库 apps/web/node_modules/playwright
  const roots = []
  if (process.env.DSH_HARNESS_DIR) roots.push(process.env.DSH_HARNESS_DIR)
  for (const root of roots) {
    const p = path.join(root, 'apps', 'web', 'node_modules', 'playwright')
    if (fs.existsSync(p)) return p
  }

  throw new Error(
    '未找到 playwright 包。任选一种方式：\n' +
    '  1) 在本仓库目录执行: npm i -D playwright（首次还需 npx playwright install msedge 或安装 Chrome）\n' +
    '  2) 设置环境变量 PLAYWRIGHT_PATH 指向已有的 playwright 包目录\n' +
    '  3) 本机若有 DSH 仓库，设置环境变量 DSH_HARNESS_DIR 指向其根目录（自动复用其 apps/web/node_modules/playwright）'
  )
}

module.exports = { chromium: require(resolvePlaywrightModule()).chromium }
