/**
 * 用量显示 · 宿主内建桥（仅 Host 半，无 Client 半 → 激活无需批准）
 *
 * 在 DSH webServer（127.0.0.1:3080）注册同源路由，让注入脚本（扩展/油猴/控制台）
 * 无需本地桥即可：列目录、读文件预览、取宿主凭证 API Key。
 *
 *   GET /dshu/ping          → { ok: true }
 *   GET /dshu/tree?path=…   → { path, entries: [{name, path, dir, size}] }（≤500 项）
 *   GET /dshu/file?path=…   → { path, content, size, truncated }（≤500KB / 预览 ≤2 万字符）
 *   GET /dshu/credentials   → { apiKey, opencodeGoApiKey, source }
 *                            （DEEPSEEK_API_KEY + OPENCODE_GO_API_KEY/OPENCODE_API_KEY，
 *                              宿主凭证；?name=XXX 可单独取指定凭证名）
 *
 * 安全：仅监听本机回环；路径必须为绝对路径且不含 .. 段；文件读取有大小上限；
 * 凭证只发给同源页面（与扩展存 localStorage 同信任域）。
 *
 * 重新激活（DSH 重启后路由会随动态插件消失，任一会话里对 Agent 说）：
 *   "读取 dsh-plugin/host-bridge.js，用其内容调用 cordis_define（idPrefix dshub），
 *    然后 cordis_run 激活。"
 * 本文件内容即 cordis_define 的 code.host 字符串。
 */
return {
  apply(ctx) {
    function sendJson(res, status, body) {
      const text = JSON.stringify(body)
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(text)
    }
    function errText(error) {
      return error instanceof Error ? error.message : String(error)
    }
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
    function isAbsolutePath(p) {
      if (typeof p !== 'string' || p.length === 0) return false
      if (p.startsWith('/')) return true
      return /^[A-Za-z]:[\\/]/.test(p)
    }
    function hasDotDot(p) {
      return String(p).split(/[\\/]/).includes('..')
    }

    const webServer = ctx.get('webServer')
    if (webServer === undefined) return

    webServer.register({ kind: 'exact', path: '/dshu/ping', handler: (_req, res) => {
      sendJson(res, 200, { ok: true })
    } })

    webServer.register({ kind: 'exact', path: '/dshu/tree', handler: async (req, res) => {
      const params = queryParams(req.url)
      const path = params.path || ''
      if (!isAbsolutePath(path) || hasDotDot(path)) {
        return sendJson(res, 400, { error: 'path 必须为绝对路径' })
      }
      const fs = ctx.get('fs')
      if (fs === undefined) return sendJson(res, 503, { error: '宿主 fs 服务不可用' })
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
        sendJson(res, 400, { error: errText(error) })
      }
    } })

    webServer.register({ kind: 'exact', path: '/dshu/file', handler: async (req, res) => {
      const params = queryParams(req.url)
      const path = params.path || ''
      if (!isAbsolutePath(path) || hasDotDot(path)) {
        return sendJson(res, 400, { error: 'path 必须为绝对路径' })
      }
      const fs = ctx.get('fs')
      if (fs === undefined) return sendJson(res, 503, { error: '宿主 fs 服务不可用' })
      try {
        const target = await fs.resolve(path)
        let size = null
        try {
          const info = await fs.stat(target)
          if (info && typeof info.size === 'number') size = info.size
        } catch { size = null }
        if (size !== null && size > 512 * 1024) {
          return sendJson(res, 400, { error: `文件 ${(size / 1024).toFixed(0)}KB 超过 500KB，不预览` })
        }
        const text = await fs.readText(target)
        sendJson(res, 200, {
          path,
          size,
          content: String(text).slice(0, 20000),
          truncated: String(text).length > 20000,
        })
      } catch (error) {
        sendJson(res, 400, { error: errText(error) })
      }
    } })

    webServer.register({ kind: 'exact', path: '/dshu/credentials', handler: async (req, res) => {
      const creds = ctx.get('credentials')
      if (creds === undefined) return sendJson(res, 503, { error: '宿主凭证服务不可用' })
      const params = queryParams(req.url)
      const resolveCred = async (name) => {
        try {
          const resolved = await creds.resolve(name)
          return resolved && typeof resolved.value === 'string' && resolved.value.length > 0
            ? { value: resolved.value, source: typeof resolved.source === 'string' ? resolved.source : 'file' }
            : null
        } catch {
          return null
        }
      }
      // 指定凭证名（?name=XXX）：只返回该凭证
      if (params.name) {
        const hit = await resolveCred(params.name)
        return sendJson(res, 200, {
          apiKey: hit ? hit.value : null,
          source: hit ? hit.source : null,
          name: params.name,
        })
      }
      // 默认：DeepSeek Key + OpenCode Go Key（opencode-go 提供方的凭证名同 pi-ai 目录）
      const deepseek = await resolveCred('DEEPSEEK_API_KEY')
      const opencodeGo = await resolveCred('OPENCODE_GO_API_KEY') || await resolveCred('OPENCODE_API_KEY')
      return sendJson(res, 200, {
        apiKey: deepseek ? deepseek.value : null,
        opencodeGoApiKey: opencodeGo ? opencodeGo.value : null,
        source: deepseek ? deepseek.source : (opencodeGo ? opencodeGo.source : null),
      })
    } })
  },
}
