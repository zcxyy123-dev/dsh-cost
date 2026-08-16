/**
 * 用量显示 · DSH 动态插件 — Host 半（code.host 的函数体）
 *
 * 通过 harness.handle 向 Client 半提供四个 JSON RPC：
 *   meta      { sessionId } → { firstTs, model }            会话首事件时间 + 主模型
 *   subagents { sessionId } → [{ id, label, tokenUsage }]   直接子代理用量（投影折叠）
 *   tree      { path }      → { path, entries:[{name,type,size}] }
 *   file      { path }      → { path, content, truncated }  （≤500KB，预览 ≤2 万字符）
 *   official  { apiKey?, userToken? } → { balance?, usage? } 官方余额 / 平台费用（curl）
 *
 * 全部数据来自 DSH 宿主自身的服务（sessionQuery / subagents / sessionProjectionCache
 * / fs / shell），无页面抓取；失败一律优雅降级为 null / 空数组 / { error }。
 * 本文件内容即 cordis_define 的 code.host 字符串。
 */
return {
  apply(ctx) {
    const PRICING = {
      'deepseek-v4-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
      'deepseek-v4-pro': { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
      'deepseek-chat': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
      'deepseek-reasoner': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
      fallback: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    }

    function parseJsonSafe(text) {
      try { return JSON.parse(text) } catch { return null }
    }

    function errText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    // The browser half receives only the narrow data shapes below. Keep one
    // short-lived immutable session snapshot while it walks history pages so
    // a large session is not replayed once for every page.
    const historyCache = new Map()
    const HISTORY_CACHE_MS = 3000
    const MAX_CACHED_SESSIONS = 12
    const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

    function sessionIdFrom(args, key = 'sessionId') {
      return args && typeof args[key] === 'string' ? args[key] : ''
    }

    function timestamp(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string') {
        const parsed = Date.parse(value)
        return Number.isFinite(parsed) ? parsed : 0
      }
      return 0
    }

    function pageHistory(events, beforeSeq, requestedMax) {
      const window = beforeSeq === undefined
        ? events.slice()
        : events.filter((event) => typeof event.seq === 'number' && event.seq < beforeSeq)
      const maxMessages = Math.max(1, Math.min(200, Number(requestedMax) || 50))
      let count = 0
      let cut
      for (let i = window.length - 1; i >= 0; i--) {
        const event = window[i]
        if (!event || !MESSAGE_TYPES.has(event.type)) continue
        count += 1
        const sources = Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs : []
        const groupStart = sources.length > 0 ? Math.min(event.seq, ...sources) : event.seq
        if (count >= maxMessages) {
          cut = groupStart
          break
        }
      }
      const page = cut === undefined
        ? window
        : window.filter((event) => typeof event.seq === 'number' && event.seq >= cut)
      return { events: page, hasMore: cut !== undefined && cut > 0 }
    }

    async function sessionSnapshot(sessionId, beforeSeq) {
      const query = ctx.get('sessionQuery')
      if (query === undefined) throw new Error('sessionQuery service is unavailable')
      const cached = historyCache.get(sessionId)
      if (cached && (beforeSeq !== undefined || Date.now() - cached.at < HISTORY_CACHE_MS)) return cached.snapshot
      const snapshot = await query.readSession(sessionId)
      historyCache.delete(sessionId)
      historyCache.set(sessionId, { at: Date.now(), snapshot })
      while (historyCache.size > MAX_CACHED_SESSIONS) historyCache.delete(historyCache.keys().next().value)
      return snapshot
    }

    async function projectionSnapshot(sessionId) {
      const cache = ctx.get('sessionProjectionCache')
      if (cache === undefined) return { values: {} }
      try {
        const snapshot = await cache.coldSnapshot(sessionId)
        return snapshot && snapshot.values ? snapshot : { values: {} }
      } catch {
        return { values: {} }
      }
    }

    harness.handle('session.list', async () => {
      const query = ctx.get('sessionQuery')
      if (query === undefined) return { items: [] }
      const records = await query.listSessions()
      const items = []
      for (const record of records || []) {
        const header = record && (record.header || record.session || {})
        const sessionId = typeof header.id === 'string'
          ? header.id
          : record && typeof record.id === 'string' ? record.id : ''
        if (!sessionId) continue
        items.push({
          sessionId,
          cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
          updatedAt: timestamp(header.updatedAt || header.lastUpdatedAt || header.createdAt),
        })
      }
      return { items }
    })

    harness.handle('session.history', async (args) => {
      const sessionId = sessionIdFrom(args)
      if (!sessionId) throw new Error('session.history requires sessionId')
      const beforeSeq = args && typeof args.beforeSeq === 'number' ? args.beforeSeq : undefined
      const maxMessages = args && typeof args.maxMessages === 'number' ? args.maxMessages : undefined
      const snapshot = await sessionSnapshot(sessionId, beforeSeq)
      const page = pageHistory(Array.isArray(snapshot.events) ? snapshot.events : [], beforeSeq, maxMessages)
      const out = {
        events: page.events.map((event) => ({ event })),
        hasMore: page.hasMore,
      }
      if (beforeSeq === undefined) out.projections = await projectionSnapshot(sessionId)
      return out
    })

    harness.handle('subagent.list', async (args) => {
      const parentSessionId = sessionIdFrom(args, 'parentSessionId')
      if (!parentSessionId) return { entries: [] }
      const subagents = ctx.get('subagents')
      if (subagents === undefined) return { entries: [] }
      const children = await subagents.listChildren(parentSessionId)
      return {
        entries: (children || [])
          .filter((entry) => entry && entry.kind === 'child')
          .slice(0, 40)
          .map((entry) => ({
            sessionId: entry.id,
            mode: entry.mode || 'one-shot',
            label: entry.label || null,
          })),
      }
    })

    harness.handle('subagent.history', async (args) => {
      const parentSessionId = sessionIdFrom(args, 'parentSessionId')
      const childSessionId = sessionIdFrom(args, 'childSessionId')
      if (!parentSessionId || !childSessionId) throw new Error('subagent.history requires parentSessionId and childSessionId')
      const subagents = ctx.get('subagents')
      if (subagents === undefined) throw new Error('subagents service is unavailable')
      const children = await subagents.listChildren(parentSessionId)
      const child = (children || []).find((entry) => entry && entry.kind === 'child' && entry.id === childSessionId)
      if (!child) throw new Error('requested subagent is not a direct child of this session')
      return { events: [], projections: await projectionSnapshot(childSessionId) }
    })

    /** 会话首事件时间 + 主模型（最后一个 assistant/message 的 source.model）。 */
    harness.handle('meta', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
      const out = { firstTs: null, lastTs: null, model: null }
      if (!sessionId) return out
      const query = ctx.get('sessionQuery')
      if (query === undefined) return out
      let records = []
      try { records = await query.listEvents(sessionId) } catch { records = [] }
      if (!Array.isArray(records) || records.length === 0) return out
      const first = records[0]
      const last = records[records.length - 1]
      out.firstTs = typeof first.time === 'number' ? first.time : null
      out.lastTs = typeof last.time === 'number' ? last.time : null
      // 主模型：从后往前找最后一个 assistant/message，读单个事件取 source.model
      try {
        for (let i = records.length - 1; i >= 0; i--) {
          if (records[i].type !== 'assistant/message') continue
          const win = await query.readEvent({ sessionId, seq: records[i].seq })
          const msg = win && win.target && win.target.data && win.target.data.message
          const source = msg && msg.source
          if (source && typeof source.model === 'string') {
            out.model = source.model
            break
          }
        }
      } catch { /* 模型探测失败不阻塞面板 */ }
      return out
    })

    /** 直接子代理用量汇总（sessionProjectionCache.coldSnapshot 冷读，零整日志加载）。 */
    harness.handle('subagents', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
      if (!sessionId) return []
      const subs = ctx.get('subagents')
      const cache = ctx.get('sessionProjectionCache')
      if (subs === undefined || cache === undefined) return []
      let entries = []
      try { entries = await subs.listChildren(sessionId) } catch { return [] }
      const out = []
      for (const entry of entries) {
        if (entry.kind !== 'child') continue
        const id = entry.id
        let tokenUsage = null
        try {
          const snap = await cache.coldSnapshot(id)
          tokenUsage = (snap && snap.values && snap.values.tokenUsage) || null
        } catch { tokenUsage = null }
        out.push({
          id,
          label: entry.label || (entry.mode === 'one-shot' ? '一次性' : '子代理'),
          tokenUsage,
        })
        if (out.length >= 40) break
      }
      return out
    })

    /** 会话冷读投影（会话不在线/列表无实时投影时回退用）。 */
    harness.handle('cold', async (args) => {
      const sessionId = args && typeof args.sessionId === 'string' ? args.sessionId : ''
      if (!sessionId) return {}
      const cache = ctx.get('sessionProjectionCache')
      if (cache === undefined) return {}
      try {
        const snap = await cache.coldSnapshot(sessionId)
        return (snap && snap.values) || {}
      } catch { return {} }
    })

    /** 列一个目录（≤500 项，含每项完整路径）。 */
    harness.handle('tree', async (args) => {
      const path = args && typeof args.path === 'string' ? args.path : ''
      if (!path) return { error: '缺少路径' }
      const fs = ctx.get('fs')
      if (fs === undefined) return { error: '宿主 fs 服务不可用' }
      try {
        const target = await fs.resolve(path)
        const entries = await fs.listDir(target)
        const rows = Array.isArray(entries) ? entries.slice(0, 500) : []
        const sep = path.includes('\\') ? '\\' : '/'
        return {
          path,
          entries: rows.map((e) => {
            const name = typeof e.name === 'string' ? e.name : String(e.name)
            return {
              name,
              path: `${path}${sep}${name}`,
              type: e.type === 'directory' ? 'dir' : 'file',
              size: typeof e.size === 'number' ? e.size : null,
            }
          }),
        }
      } catch (error) {
        return { error: errText(error) }
      }
    })

    /** 文本预览（≤500KB，最多 2 万字符）。 */
    harness.handle('file', async (args) => {
      const path = args && typeof args.path === 'string' ? args.path : ''
      if (!path) return { error: '缺少路径' }
      const fs = ctx.get('fs')
      if (fs === undefined) return { error: '宿主 fs 服务不可用' }
      try {
        const target = await fs.resolve(path)
        let size = null
        try {
          const info = await fs.stat(target)
          if (info && typeof info.size === 'number') size = info.size
        } catch { size = null }
        if (size !== null && size > 512 * 1024) {
          return { error: `文件 ${(size / 1024).toFixed(0)}KB 超过 500KB，不预览` }
        }
        const text = await fs.readText(target)
        return {
          path,
          size,
          content: String(text).slice(0, 20000),
          truncated: String(text).length > 20000,
        }
      } catch (error) {
        return { error: errText(error) }
      }
    })

    /** 官方余额 / 平台费用。本地 curl 直连官方域名（含 Authorization 头）。 */
    harness.handle('official', async (args) => {
      const apiKey = args && typeof args.apiKey === 'string' ? args.apiKey.trim() : ''
      const userToken = args && typeof args.userToken === 'string' ? args.userToken.trim() : ''
      const shell = ctx.get('shell')
      if (shell === undefined) {
        return { error: '宿主 shell 服务不可用（无法直连官方接口）' }
      }
      const runCurl = async (url, token) => {
        const command = `curl.exe -sS --max-time 15 -H "Accept: application/json" -H "Authorization: Bearer ${token}" "${url}"`
        const spec = shell.resolve({ command, timeoutMs: 20000, stdoutMaxBytes: 2 * 1024 * 1024 })
        const result = await shell.run(spec)
        let text = ''
        if (result && result.stdout) text = typeof result.stdout === 'string' ? result.stdout : (result.stdout.text || '')
        if (!text) {
          // curl.exe 不存在等场景回退 curl（非 Windows）
          const spec2 = shell.resolve({
            command: `curl -sS --max-time 15 -H "Accept: application/json" -H "Authorization: Bearer ${token}" "${url}"`,
            timeoutMs: 20000,
            stdoutMaxBytes: 2 * 1024 * 1024,
          })
          const result2 = await shell.run(spec2)
          if (result2 && result2.stdout) text = typeof result2.stdout === 'string' ? result2.stdout : (result2.stdout.text || '')
        }
        return text
      }
      const out = { balance: null, usage: null }

      // 余额：api.deepseek.com/user/balance（公开接口 + API Key 鉴权）
      if (apiKey) {
        try {
          const body = await runCurl('https://api.deepseek.com/user/balance', apiKey)
          const json = parseJsonSafe(body)
          if (!json || !Array.isArray(json.balance_infos)) {
            out.balance = { error: '接口返回异常（API Key 无效？）' }
          } else {
            const infos = json.balance_infos.filter((i) => i && i.total_balance !== undefined)
            if (infos.length === 0) {
              out.balance = { error: '接口未返回余额信息' }
            } else {
              const primary = infos.reduce((a, b) => (Number(b.total_balance) > Number(a.total_balance) ? b : a))
              out.balance = {
                available: json.is_available !== false,
                currency: primary.currency || 'CNY',
                total: Number(primary.total_balance) || 0,
                granted: Number(primary.granted_balance) || 0,
                toppedUp: Number(primary.topped_up_balance) || 0,
              }
            }
          }
        } catch (error) {
          out.balance = { error: `余额请求失败：${errText(error)}` }
        }
      }

      // 平台费用/用量：platform.deepseek.com（userToken 鉴权，页面直连被 CORS 拦，
      // 宿主 curl 不受限）。聚合语义照 CodexBar 的 DeepSeekUsageCostParser。
      if (userToken) {
        try {
          const now = new Date()
          const query = `?month=${now.getMonth() + 1}&year=${now.getFullYear()}`
          const [amountBody, costBody] = await Promise.all([
            runCurl(`https://platform.deepseek.com/api/v0/usage/amount${query}`, userToken),
            runCurl(`https://platform.deepseek.com/api/v0/usage/cost${query}`, userToken),
          ])
          const amountPayload = parseJsonSafe(amountBody)
          const costPayload = parseJsonSafe(costBody)
          const authFailed = (amountPayload && (amountPayload.code === 40002 || amountPayload.code === 40003))
            || (costPayload && (costPayload.code === 40002 || costPayload.code === 40003))
          if (authFailed) {
            out.usage = { error: '平台 Token 无效或已过期' }
          } else {
            out.usage = aggregateOfficialUsage(amountPayload, costPayload)
          }
        } catch (error) {
          out.usage = { error: `平台用量请求失败：${errText(error)}` }
        }
      }
      return out
    })

    /** 自动获取宿主凭证里的 DeepSeek API Key（DEEPSEEK_API_KEY，与模型路由同一凭证）。 */
    harness.handle('apikey', async () => {
      const creds = ctx.get('credentials')
      if (creds === undefined) return { apiKey: null, source: null }
      try {
        const resolved = await creds.resolve('DEEPSEEK_API_KEY')
        if (resolved && typeof resolved.value === 'string' && resolved.value.length > 0) {
          return { apiKey: resolved.value, source: typeof resolved.source === 'string' ? resolved.source : 'file' }
        }
      } catch { /* 凭证服务不可用时静默降级 */ }
      return { apiKey: null, source: null }
    })

    /** 聚合 amount/cost 两个响应 → 官方用量摘要。 */
    function aggregateOfficialUsage(amountPayload, costPayload) {
      const aData = amountPayload && amountPayload.data ? amountPayload.data.biz_data : null
      const cData = costPayload && costPayload.data ? costPayload.data.biz_data : null
      if (!aData) return null
      const now = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const monthPrefix = today.slice(0, 7)
      const fold = (items, parse) => {
        const out = { hit: 0, miss: 0, output: 0, request: 0 }
        for (const item of items || []) {
          const t = typeof item.type === 'string' ? item.type.toUpperCase() : ''
          const amount = parse(item.amount)
          if (t === 'PROMPT_CACHE_HIT_TOKEN') out.hit += amount
          else if (t === 'PROMPT_CACHE_MISS_TOKEN') out.miss += amount
          else if (t === 'RESPONSE_TOKEN') out.output += amount
          else if (t === 'REQUEST') out.request += amount
        }
        return out
      }
      const month = { hit: 0, miss: 0, output: 0, request: 0 }
      const day = { hit: 0, miss: 0, output: 0, request: 0 }
      let topModel = null
      let topModelTokens = -1
      const modelTokens = {}
      const totals = aData.total || []
      const hasTotals = totals.length > 0
      for (const m of totals) {
        if (!m || !m.model) continue
        const folded = fold(m.usage, (v) => Math.max(0, parseInt(v, 10) || 0))
        modelTokens[m.model] = (modelTokens[m.model] || 0) + folded.hit + folded.miss + folded.output
        month.hit += folded.hit; month.miss += folded.miss
        month.output += folded.output; month.request += folded.request
      }
      for (const d of aData.days || []) {
        if (!d || !d.date) continue
        const isToday = d.date === today
        if (hasTotals && !isToday) continue
        const isThisMonth = d.date.startsWith(monthPrefix)
        for (const m of d.data || []) {
          if (!m || !m.model) continue
          const folded = fold(m.usage, (v) => Math.max(0, parseInt(v, 10) || 0))
          if (isThisMonth && !hasTotals) {
            month.hit += folded.hit; month.miss += folded.miss
            month.output += folded.output; month.request += folded.request
            modelTokens[m.model] = (modelTokens[m.model] || 0) + folded.hit + folded.miss + folded.output
          }
          if (isToday) {
            day.hit += folded.hit; day.miss += folded.miss
            day.output += folded.output; day.request += folded.request
          }
        }
      }
      for (const model of Object.keys(modelTokens)) {
        if (modelTokens[model] > topModelTokens) {
          topModelTokens = modelTokens[model]
          topModel = model
        }
      }
      let currency = 'CNY'
      let monthCost
      let todayCost
      if (Array.isArray(cData) && cData.length > 0) {
        const c0 = cData[0]
        if (typeof c0.currency === 'string' && c0.currency) currency = c0.currency
        const parseCost = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
        const costMonth = { hit: 0, miss: 0, output: 0 }
        const costDay = { hit: 0, miss: 0, output: 0 }
        const costTotals = c0.total || []
        const hasCostTotals = costTotals.length > 0
        for (const m of costTotals) {
          if (!m || !m.model) continue
          const folded = fold(m.usage, parseCost)
          costMonth.hit += folded.hit; costMonth.miss += folded.miss; costMonth.output += folded.output
        }
        for (const d of c0.days || []) {
          if (!d || !d.date) continue
          const isToday = d.date === today
          if (hasCostTotals && !isToday) continue
          const isThisMonth = d.date.startsWith(monthPrefix)
          for (const m of d.data || []) {
            if (!m || !m.model) continue
            const folded = fold(m.usage, parseCost)
            if (isThisMonth && !hasCostTotals) {
              costMonth.hit += folded.hit; costMonth.miss += folded.miss; costMonth.output += folded.output
            }
            if (isToday) {
              costDay.hit += folded.hit; costDay.miss += folded.miss; costDay.output += folded.output
            }
          }
        }
        monthCost = costMonth.hit + costMonth.miss + costMonth.output
        todayCost = costDay.hit + costDay.miss + costDay.output
      }
      return {
        currency,
        monthTokens: month.hit + month.miss + month.output,
        monthRequests: month.request,
        todayTokens: day.hit + day.miss + day.output,
        todayRequests: day.request,
        monthCost: monthCost !== undefined ? monthCost : null,
        todayCost: todayCost !== undefined ? todayCost : null,
        hitTokens: month.hit,
        missTokens: month.miss,
        outputTokens: month.output,
        topModel,
      }
    }
  },
}
