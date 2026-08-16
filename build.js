/**
 * 构建脚本：从 usage-display.js 单一代码源生成三种交付形态。
 * 运行：node build.js
 *   - userscript/用量显示.user.js        （Tampermonkey/暴力猴）
 *   - console/用量显示-控制台注入.js       （浏览器控制台粘贴版）
 *   - extension/usage-display.js        （扩展用副本，content.js 注入页面）
 */
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const ROOT = __dirname
const core = readFileSync(join(ROOT, 'usage-display.js'), 'utf8')
const VERSION = '2.0.0'

mkdirSync(join(ROOT, 'userscript'), { recursive: true })
mkdirSync(join(ROOT, 'console'), { recursive: true })
mkdirSync(join(ROOT, 'extension'), { recursive: true })

// ---------- 1. Tampermonkey 油猴脚本 ----------
// 油猴版额外注入 GM_xhr 桥：绕过页面 CORS，直连 DeepSeek 官方（余额+平台费用全可用）
const GM_BRIDGE = `
/* 油猴 GM_xhr 桥：官方请求绕过页面 CORS（需 @grant GM_xmlhttpRequest，脚本头已声明） */
;(function installGmBridge() {
  const gm = (typeof GM_xmlhttpRequest === 'function') ? GM_xmlhttpRequest : undefined
  if (!gm || typeof window === 'undefined') return
  const bridge = (url, init) => new Promise((resolve, reject) => {
    gm({
      method: (init && init.method) || 'GET',
      url,
      headers: (init && init.headers) || {},
      data: (init && init.body) || undefined,
      timeout: 15000,
      onload: (r) => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, body: r.responseText }),
      onerror: () => reject(new Error('GM_xhr network error')),
      ontimeout: () => reject(new Error('GM_xhr timeout')),
    })
  })
  try { window.__dshuBridgeFetch = bridge } catch { /* noop */ }
  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.__dshuBridgeFetch = bridge } catch { /* noop */ }
})()
`

const userscript = `// ==UserScript==
// @name         DSH 用量显示
// @namespace    dsh-usage-display
// @version      ${VERSION}
// @description  在 DeepSeek Harness Web GUI 右侧列嵌入显示会话用量：上下文窗口/缓存命中/费用/请求数/累计 tokens；[用量|文件] 视图切换；支持 API Key 直连官方余额、平台 Token 官方费用（数据仅发往 DeepSeek 官方域名）
// @author       local
// @match        http://127.0.0.1:3080/*
// @match        http://localhost:3080/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      api.deepseek.com
// @connect      platform.deepseek.com
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/* =====================================================================
 * DSH 用量显示 v${VERSION}（由 usage-display.js 构建生成，勿直接修改本文件）
 * 卸载：控制台执行 __DSH_USAGE_DISPLAY.destroy()，或禁用本脚本后刷新页面。
 * ===================================================================== */
${GM_BRIDGE}
${core}
`

// ---------- 2. 控制台粘贴版 ----------
const consoleVersion = `/* =====================================================================
 * DSH 用量显示 v${VERSION} — 控制台注入版
 * =====================================================================
 * 用法：打开 DeepSeek Harness Web GUI（http://127.0.0.1:3080），按 F12
 * 打开开发者工具，把本文件全部内容粘贴到 Console 回车即可。
 * 卸载：执行 __DSH_USAGE_DISPLAY.destroy()，或刷新页面。
 * 说明：读取页面同源 session.history 数据，嵌入页面右侧列（grid 第 4 列），
 *       [用量|文件] 视图切换，每 5 秒自动刷新（可在 CONFIG.refreshMs 修改）。
 * ===================================================================== */
${core}
`

// ---------- 3. 扩展副本 ----------
const extensionCopy = `/* DSH 用量显示 v${VERSION} — Chrome/Edge MV3 扩展用副本（由 usage-display.js 构建生成） */
${core}
`

writeFileSync(join(ROOT, 'userscript', '用量显示.user.js'), userscript, 'utf8')
writeFileSync(join(ROOT, 'console', '用量显示-控制台注入.js'), consoleVersion, 'utf8')
writeFileSync(join(ROOT, 'extension', 'usage-display.js'), extensionCopy, 'utf8')

console.log('build ok:')
console.log('  userscript/用量显示.user.js')
console.log('  console/用量显示-控制台注入.js')
console.log('  extension/usage-display.js')
