'use strict'

/**
 * DSH 用量显示 · Host 半（bundle 插件包格式）
 * ========================================================
 * 这是 `dsh plugin --profile web add <本包>` 安装的宿主侧插件（随 DSH 启动常驻，
 * 进程重启后依然存在，不需要 Cordis 会话或审批）。
 *
 * 提供两个受限的本地路由给页面里的 Client bundle 使用：
 *
 *   POST /dshu/api/proxy  官方接口代理。页面直接请求 api.deepseek.com /
 *                        platform.deepseek.com 会被 CORS 拦截，本路由在宿主进程
 *                        内转发（Node 原生 fetch），只放行白名单 URL 和
 *                        authorization/accept 头，并做回环信任栅栏（防 DNS
 *                        rebinding 与跨站调用）。
 *   GET  /dshu/api/apikey 从宿主凭证解析 DEEPSEEK_API_KEY，供面板自动填充余额
 *                        查询；凭证只回给同源页面，不落盘、不进日志。
 *
 * 不注入 shell/fs 等敏感服务：数据面全部走 Node 内置能力，任何环境下行为一致。
 */

const OFFICIAL_URL_PREFIXES = [
  'https://api.deepseek.com/user/balance',
  'https://platform.deepseek.com/api/v0/usage/amount',
  'https://platform.deepseek.com/api/v0/usage/cost',
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

/** 从宿主凭证解析 DeepSeek API Key（只回同源页面，用于余额自动查询）。 */
async function handleApiKey(req, res, ctx) {
  if (req.method !== 'GET') {
    sendError(res, 405, 'method not allowed')
    return
  }
  const credentials = ctx.get('credentials')
  if (credentials === undefined || typeof credentials.resolve !== 'function') {
    sendJson(res, 200, { apiKey: null, source: null })
    return
  }
  try {
    const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
    if (resolved && typeof resolved.value === 'string' && resolved.value.length > 0) {
      sendJson(res, 200, {
        apiKey: resolved.value,
        source: typeof resolved.source === 'string' ? resolved.source : 'file',
      })
      return
    }
  } catch {
    /* 凭证服务不可用时静默降级 */
  }
  sendJson(res, 200, { apiKey: null, source: null })
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
  name: 'dsh-cost-usage-display',
  inject: ['webServer'],
  apply(ctx) {
    const routes = [
      makeRoute('/dshu/api/proxy', (req, res) => handleProxy(req, res)),
      makeRoute('/dshu/api/apikey', (req, res) => handleApiKey(req, res, ctx)),
    ]
    for (const route of routes) {
      ctx.effect(
        () => ctx.webServer.register(route),
        `dsh-cost-usage-display: route ${route.path}`,
      )
    }
  },
}
