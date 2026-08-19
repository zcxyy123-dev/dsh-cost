'use strict'

/**
 * DSH 用量显示 · Host 半（bundle 插件包格式）
 * ========================================================
 * 这是 `dsh plugin --profile web add <本包>` 安装的宿主侧插件（随 DSH 启动常驻，
 * 进程重启后依然存在，不需要 Cordis 会话或审批）。
 *
 * 向页面里的 Client bundle 提供受控的同源路由（全部经回环信任栅栏）：
 *
 *   POST /dshu/api/proxy      官方接口代理（CORS 豁免，URL/头白名单）。
 *   GET  /dshu/api/apikey     宿主凭证解析（DEEPSEEK_API_KEY + OpenCode Go）。
 *   GET  /dshu/credentials    同上（client 探测路径，alias）。
 *   GET  /dshu/ping           连通性探测（目录树/预览默认无需本地桥的保证）。
 *   GET  /dshu/tree?path=…    列目录（工作区文件树，≤500 项/目录）。
 *   GET  /dshu/file?path=…    受限文本预览（≤500KB，预览 ≤2 万字符）。
 *
 * 文件系统数据面走 DSH 官方 ctx.fs 服务（FileSystem seam，dsh-fs-sandbox），
 * 与 Agent 的 read/list 同一套沙箱与路径解析语义：目录树/预览开箱即用，
 * 不再需要单独激活 dshub-1 动态插件，也不需要 setup-key.bat 本地桥。
 * 官方接口代理与凭证仍走 Node 内置能力，任何环境下行为一致。
 */

const OFFICIAL_URL_PREFIXES = [
  'https://api.deepseek.com/user/balance',
  'https://platform.deepseek.com/api/v0/usage/amount',
  'https://platform.deepseek.com/api/v0/usage/cost',
  'https://opencode.ai/zen/go/v1/usage',
]

/** 代理请求体大小上限（官方请求只需 URL + 少量头）。 */
const MAX_BODY_BYTES = 16 * 1024

/** 回环主机名校验（与 DSH 自身的 isTrustedApiRequest 同语义的简化镜像）。 */
function isLoopbackHostname(name) {
  const host = String(name).replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '::1' || host === '127.0.0.1'
    || host.startsWith('127.') || host.startsWith('::ffff:127.')
}

/**
 * 信任栅栏：Host 头必须指向本机回环地址（防 DNS rebinding），拒绝跨站
 * fetch 标记，拒绝与 Host 不一致的 Origin。与 DSH /api 通道同一套防线。
 */
function isTrustedRequest(req) {
  const host = req.headers && req.headers.host
  if (typeof host !== 'string' || host.length === 0) return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== hostUrl.host) return false
    } catch {
      return false
    }
  }
  return true
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

function sendError(res, status, message) {
  sendJson(res, status, { ok: false, error: message })
}

/** 读取请求体（带大小上限）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 官方接口代理：URL 白名单 + 头白名单 + 宿主进程内转发。 */
async function handleProxy(req, res) {
  if (req.method !== 'POST') {
    sendError(res, 405, 'method not allowed')
    return
  }
  let payload
  try {
    payload = JSON.parse(await readBody(req))
  } catch {
    sendError(res, 400, 'invalid JSON body')
    return
  }
  const url = typeof payload.url === 'string' ? payload.url : ''
  if (!OFFICIAL_URL_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    sendError(res, 403, 'url not allowed')
    return
  }
  const method = typeof payload.method === 'string' && payload.method.toUpperCase() === 'GET' ? 'GET' : 'GET'
  const headers = {}
  if (payload.headers && typeof payload.headers === 'object') {
    const authorization = payload.headers.authorization || payload.headers.Authorization
    if (typeof authorization === 'string' && /^Bearer\s+\S+$/.test(authorization)) {
      headers.authorization = authorization
    }
    const accept = payload.headers.accept || payload.headers.Accept
    if (typeof accept === 'string') headers.accept = accept
  }
  try {
    const response = await fetch(url, {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
    })
    const body = await response.text()
    sendJson(res, 200, { ok: response.ok, status: response.status, body })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendJson(res, 502, { ok: false, status: 0, body: '', error: message })
  }
}

/**
 * 从宿主凭证解析 DeepSeek API Key 与 OpenCode Go Key（只回同源页面，
 * 用于余额/额度自动查询）。
 */
async function handleApiKey(req, res, ctx) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'method not allowed')
    return
  }
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.resolve !== 'function') {
    sendJson(res, 200, { apiKey: null, opencodeGoApiKey: null, source: null })
    return
  }
  const out = { apiKey: null, opencodeGoApiKey: null, source: null }
  const absorb = async (name) => {
    try {
      const resolved = await credentials.resolve(name)
      if (resolved && typeof resolved.value === 'string' && resolved.value.length > 0) {
        return {
          value: resolved.value,
          source: typeof resolved.source === 'string' ? resolved.source : 'file',
        }
      }
    } catch {
      /* 凭证服务不可用时静默降级 */
    }
    return null
  }
  const deepseek = await absorb('DEEPSEEK_API_KEY')
  if (deepseek) {
    out.apiKey = deepseek.value
    out.source = deepseek.source
  }
  const opencodeGo = await absorb('OPENCODE_GO_API_KEY') || await absorb('OPENCODE_API_KEY')
  if (opencodeGo) {
    out.opencodeGoApiKey = opencodeGo.value
    if (!out.source) out.source = opencodeGo.source
  }
  sendJson(res, 200, out)
}

/* ---------------------- 工作区文件：目录树 / 文本预览 ----------------------
 * 走 DSH 官方 ctx.fs 服务（FileSystem seam），与 Agent 的 read/list 同一语义：
 *   - fs.resolve(path)          → 稳定 FsTarget（相对路径以工作区为基准）
 *   - fs.listDir(target)        → 直接子项（name/type/size）
 *   - fs.stat(target)           → 元数据（size/type）
 *   - fs.readText(target)       → 全文 UTF-8
 * 上限照 Reasonix file-read 安全设计：树每目录 ≤500 项、预览 ≤500KB、≤2 万字符。
 * 沙箱/权限错误由 fs 服务抛错并原样透传给页面（FS_* code 保留在 message 中）。
 */

/** 查询参数解析（仅读取，不做任何副作用）。 */
function queryParams(rawUrl) {
  const q = String(rawUrl || '').split('?')[1] || ''
  const out = {}
  for (const pair of q.split('&')) {
    if (!pair) continue
    const i = pair.indexOf('=')
    const k = i === -1 ? pair : pair.slice(0, i)
    const v = i === -1 ? '' : pair.slice(i + 1)
    try { out[decodeURIComponent(k)] = decodeURIComponent(v) } catch { /* 忽略非法编码 */ }
  }
  return out
}

/** 路径必须为绝对路径（Windows 盘符或 / 开头）且不含 .. 段。 */
function isSafePath(p) {
  if (typeof p !== 'string' || p.length === 0) return false
  if (p.startsWith('/')) return true
  if (!/^[A-Za-z]:[\\/]/.test(p)) return false
  return !String(p).split(/[\\/]/).includes('..')
}

/** 连通性探测：目录树/预览默认可用（CLI 常驻，无需手动激活）。 */
async function handlePing(req, res) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'method not allowed')
    return
  }
  sendJson(res, 200, { ok: true })
}

/** 列一个目录（≤500 项，含每项完整路径）。 */
async function handleTree(req, res, ctx) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'method not allowed')
    return
  }
  const path = queryParams(req.url).path || ''
  if (!isSafePath(path)) {
    sendError(res, 400, 'path 必须为绝对路径且不含 .. 段')
    return
  }
  const fs = ctx.get('fs')
  if (fs === undefined || typeof fs.resolve !== 'function') {
    sendError(res, 503, '宿主 fs 服务不可用')
    return
  }
  try {
    const target = await fs.resolve(path)
    const entries = await fs.listDir(target)
    const rows = Array.isArray(entries) ? entries.slice(0, 500) : []
    const sep = path.includes('\\') ? '\\' : '/'
    sendJson(res, 200, {
      path,
      entries: rows.map((e) => {
        const name = typeof e.name === 'string' ? e.name : String(e.name)
        return {
          name,
          path: `${path}${sep}${name}`,
          dir: e.type === 'directory',
          size: typeof e.size === 'number' ? e.size : null,
        }
      }),
    })
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : String(error))
  }
}

/** 文本预览（≤500KB，最多 2 万字符）。 */
async function handleFile(req, res, ctx) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'method not allowed')
    return
  }
  const path = queryParams(req.url).path || ''
  if (!isSafePath(path)) {
    sendError(res, 400, 'path 必须为绝对路径且不含 .. 段')
    return
  }
  const fs = ctx.get('fs')
  if (fs === undefined || typeof fs.resolve !== 'function') {
    sendError(res, 503, '宿主 fs 服务不可用')
    return
  }
  try {
    const target = await fs.resolve(path)
    let size = null
    try {
      const info = await fs.stat(target)
      if (info && typeof info.size === 'number') size = info.size
    } catch { size = null }
    if (size !== null && size > 512 * 1024) {
      sendError(res, 400, `文件 ${(size / 1024).toFixed(0)}KB 超过 500KB，不预览`)
      return
    }
    const text = await fs.readText(target)
    sendJson(res, 200, {
      path,
      size,
      content: String(text).slice(0, 20000),
      truncated: String(text).length > 20000,
    })
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : String(error))
  }
}

function makeRoute(path, handler) {
  return {
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!isTrustedRequest(req)) {
        sendError(res, 403, 'forbidden')
        return
      }
      try {
        await handler(req, res)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendError(res, 500, message)
      }
    },
  }
}

module.exports = {
  name: 'dsh-cost',
  inject: ['webServer'],
  apply(ctx) {
    const routes = [
      makeRoute('/dshu/api/proxy', (req, res) => handleProxy(req, res)),
      makeRoute('/dshu/api/apikey', (req, res) => handleApiKey(req, res, ctx)),
      // 文件系统管理：目录树/预览/凭证/连通性（官方插件协议，随 DSH 常驻）
      makeRoute('/dshu/credentials', (req, res) => handleApiKey(req, res, ctx)),
      makeRoute('/dshu/ping', (req, res) => handlePing(req, res)),
      makeRoute('/dshu/tree', (req, res) => handleTree(req, res, ctx)),
      makeRoute('/dshu/file', (req, res) => handleFile(req, res, ctx)),
    ]
    for (const route of routes) {
      ctx.effect(
        () => {
          try {
            return ctx.webServer.register(route)
          } catch (error) {
            // 同名路由已由其他插件（如动态插件 dshub-1）注册：跳过而非让本
            // 插件整体失败。DSH webServer 对重复 (kind, path) 直接 throw；
            // 二者功能等价（同为宿主 fs 服务），共存时谁先注册谁生效。
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[dsh-cost] route ${route.path} already registered by another plugin, skipping (${message})`)
            return () => {}
          }
        },
        `dsh-cost: route ${route.path}`,
      )
    }
  },
}
