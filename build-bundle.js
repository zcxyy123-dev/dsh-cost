'use strict'

/**
 * 生成 DSH bundle 插件包的浏览器端 bundle（client/bundle.js）。
 *
 * 产物契约（DSH client-modules）：
 *   - 经典脚本，加载后必须同步调用 window.__ModuleLoader__.load({ id, factory })；
 *   - id 必须等于 package.json 的 name（dsh-cost）；
 *   - factory(require) 返回 Cordis 插件对象 { name, apply(ctx) }；
 *   - require 只能解析模块表种子（react 等）——本 bundle 不使用任何外部模块。
 *
 * bundle 内的面板逻辑直接复用 usage-display.js 核心（纯 DOM 自包含脚本，
 * 已在扩展/油猴/控制台形态上验证）。bundle 额外提供：
 *   - window.__dshuBridgeFetch：官方接口请求转交宿主 /dshu/api/proxy（免 CORS）；
 *   - localStorage dshu.apiKey 自动预填：宿主 /dshu/api/apikey（宿主凭证）。
 *
 * 用法：node build-bundle.js        （重新生成 client/bundle.js）
 */
const fs = require('node:fs')
const path = require('node:path')

const root = __dirname
const corePath = path.join(root, 'usage-display.js')
const bundlePath = path.join(root, 'client', 'bundle.js')

const PACKAGE_ID = require('./package.json').name

const HEAD = String.raw`/* =====================================================================
 * DSH 用量显示 · Client bundle（DSH 模块加载器格式）
 * 由 build-bundle.js 生成（源：usage-display.js）——不要手工编辑。
 *
 * 加载契约：window.__ModuleLoader__.load({ id, factory })。
 * 面板 = usage-display.js 核心（右侧第四列 用量/文件 + 回合用量标注），
 * 官方接口经宿主 /dshu/api/proxy 转发（免 CORS），API Key 由宿主凭证预填。
 * ===================================================================== */
;(() => {
  const PACKAGE_ID = ${JSON.stringify(PACKAGE_ID)}
  const loader = globalThis.__ModuleLoader__
  if (!loader || typeof loader.load !== 'function') {
    console.error('[dsh-cost] client-modules loader missing; bundle not registered')
    return
  }
  loader.load({
    id: PACKAGE_ID,
    factory(require) {
      /* ---------------- 官方接口桥：页面 fetch → 宿主代理（免 CORS） ---------------- */
      function installBridge() {
        try {
          if (typeof window === 'undefined') return
          if (typeof window.__dshuBridgeFetch === 'function') return // 已有扩展/油猴桥，不覆盖
          const bridge = async (url, init) => {
            try {
              const response = await fetch('/dshu/api/proxy', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  url: String(url),
                  method: (init && init.method) || 'GET',
                  headers: (init && init.headers) || {},
                }),
              })
              const json = await response.json().catch(() => null)
              if (!json) return { ok: false, status: response.status, body: '' }
              return { ok: json.ok === true, status: json.status, body: json.body }
            } catch (error) {
              return { ok: false, status: 0, body: '', error: String(error) }
            }
          }
          bridge.__dshuOwned = true
          window.__dshuBridgeFetch = bridge
        } catch { /* noop */ }
      }

      /* ---------------- API Key 预填/同步：宿主凭证（余额/额度自动查询用） ----------------
       * 同步语义：宿主凭证 = 会话模型路由实际使用的 Key；本地已有旧 Key 但与宿主
       * 不一致（换过 Key / 旧 Key 失效）时以宿主为准覆盖，面板始终查"本会话计费账户"。 */
      function prefillApiKey() {
        try {
          if (typeof localStorage === 'undefined') return
          fetch('/dshu/api/apikey', { cache: 'no-store' })
            .then((response) => response.json())
            .then((json) => {
              if (!json) return
              const sync = (name, value) => {
                if (typeof value !== 'string' || !value) return
                const prev = localStorage.getItem(name)
                if (prev === value) return
                localStorage.setItem(name, value)
              }
              sync('dshu.apiKey', json.apiKey)
              sync('dshu.opencodeKey', json.opencodeGoApiKey || json.opencodeApiKey)
            })
            .catch(() => { /* 宿主路由不可用时静默降级 */ })
        } catch { /* noop */ }
      }

      /* ---------------- 运行核心（usage-display.js） ---------------- */
      function runCore() {
        if (typeof document === 'undefined') return null
        if (globalThis.__DSH_USAGE_DISPLAY) {
          console.warn('[dsh-cost] core already running in this page; skip duplicate mount')
          return null
        }
        try {
          ;
`

const TAIL = String.raw`
          if (globalThis.__DSH_USAGE_DISPLAY && typeof globalThis.__DSH_USAGE_DISPLAY.destroy === 'function') {
            const api = globalThis.__DSH_USAGE_DISPLAY
            return () => {
              try { api.destroy() } catch { /* already disposed */ }
            }
          }
        } catch (error) {
          console.error('[dsh-cost] core failed to start', error)
        }
        return null
      }

      return {
        name: PACKAGE_ID,
        apply(ctx) {
          installBridge()
          prefillApiKey()
          const cleanup = runCore()
          ctx.effect(() => () => {
            if (cleanup) {
              try { cleanup() } catch { /* already disposed */ }
            }
            try {
              if (globalThis.__dshuBridgeFetch && globalThis.__dshuBridgeFetch.__dshuOwned) {
                delete globalThis.__dshuBridgeFetch
              }
            } catch { /* noop */ }
          }, 'dsh-cost.cleanup')
        },
      }
    },
  })
})()
`

function buildBundle() {
  const core = fs.readFileSync(corePath, 'utf8')
  return `${HEAD}${core}\n${TAIL}`
}

function writeBundle() {
  fs.mkdirSync(path.dirname(bundlePath), { recursive: true })
  const bundle = buildBundle()
  fs.writeFileSync(bundlePath, bundle, 'utf8')
  return bundle
}

module.exports = { buildBundle, writeBundle, corePath, bundlePath }

if (require.main === module) {
  const bundle = writeBundle()
  console.log(`written ${bundlePath} (${bundle.length} B, core ${fs.statSync(corePath).size} B)`)
}
