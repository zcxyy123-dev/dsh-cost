/**
 * 官方模块单测：用 mock 的 amount/cost 响应验证聚合逻辑（语义照 CodexBar 解析器）。
 * 运行：node test-official.js
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
}
globalThis.fetch = () => { throw new Error('不应直连') }

const code = readFileSync(join(__dirname, 'usage-display.js'), 'utf8')
;(0, eval)(code)
const api = globalThis.__DSH_USAGE_DISPLAY
const agg = api._internal.aggregateOfficialUsage

// "今天"与"本月"动态生成（聚合逻辑按当前日期判定）
const _now = new Date()
const _today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`
const _yesterday = new Date(_now.getTime() - 86400000)
const _yday = `${_yesterday.getFullYear()}-${String(_yesterday.getMonth() + 1).padStart(2, '0')}-${String(_yesterday.getDate()).padStart(2, '0')}`

// ---- mock：某月 total：v4-flash 命中 100万、未命中 5万、输出 2万、请求 30；days 含今天 ----
const amountPayload = {
  code: 0,
  msg: 'success',
  data: {
    biz_code: 0,
    biz_msg: 'success',
    biz_data: {
      total: [
        {
          model: 'deepseek-v4-flash',
          usage: [
            { type: 'PROMPT_CACHE_HIT_TOKEN', amount: '1000000' },
            { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '50000' },
            { type: 'RESPONSE_TOKEN', amount: '20000' },
            { type: 'REQUEST', amount: '30' },
          ],
        },
      ],
      days: [
        {
          date: _today,
          data: [
            { model: 'deepseek-v4-flash', usage: [{ type: 'PROMPT_CACHE_HIT_TOKEN', amount: '80000' }, { type: 'REQUEST', amount: '3' }] },
          ],
        },
        {
          date: _yday,
          data: [
            { model: 'deepseek-v4-flash', usage: [{ type: 'PROMPT_CACHE_MISS_TOKEN', amount: '5000' }] },
          ],
        },
      ],
    },
  },
}
const costPayload = {
  code: 0,
  msg: 'success',
  data: {
    biz_code: 0,
    biz_msg: 'success',
    biz_data: [
      {
        currency: 'CNY',
        total: [
          { model: 'deepseek-v4-flash', usage: [{ type: 'PROMPT_CACHE_HIT_TOKEN', amount: '2.80' }, { type: 'PROMPT_CACHE_MISS_TOKEN', amount: '7.00' }, { type: 'RESPONSE_TOKEN', amount: '5.60' }] },
        ],
        days: [
          { date: _today, data: [{ model: 'deepseek-v4-flash', usage: [{ type: 'PROMPT_CACHE_HIT_TOKEN', amount: '0.224' }] }] },
          { date: _yday, data: [{ model: 'deepseek-v4-flash', usage: [{ type: 'PROMPT_CACHE_MISS_TOKEN', amount: '0.70' }] }] },
        ],
      },
    ],
  },
}

let failed = 0
const eq = (name, actual, expected) => {
  const ok = typeof expected === 'number' && Number.isFinite(expected)
    ? Math.abs(actual - expected) < 1e-9
    : Object.is(actual, expected)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${actual} ${ok ? '' : `(期望 ${expected})`}`)
  if (!ok) failed += 1
}

const s = agg(amountPayload, costPayload)
console.log('聚合结果:', JSON.stringify(s))
eq('本月 tokens', s.monthTokens, 1000000 + 50000 + 20000)
eq('本月请求', s.monthRequests, 30)
eq('今日 tokens', s.todayTokens, 80000)
eq('今日请求', s.todayRequests, 3)
eq('本月费用', s.monthCost, 2.80 + 7.00 + 5.60)
eq('今日费用', s.todayCost, 0.224)
eq('币种', s.currency, 'CNY')
eq('Top 模型', s.topModel, 'deepseek-v4-flash')
eq('命中 tokens', s.hitTokens, 1000000)
eq('未命中 tokens', s.missTokens, 50000)
eq('输出 tokens', s.outputTokens, 20000)

// 认证失败路径
const auth = agg({ code: 40002, msg: 'Missing Token', data: null }, { code: 40002, msg: 'Missing Token', data: null })
eq('认证失败 → null', auth, null)

// 空数据路径
const empty = agg({ code: 0, data: { biz_code: 0, biz_data: { total: [], days: [] } } }, { code: 0, data: { biz_code: 0, biz_data: [] } })
eq('空数据 monthTokens', empty.monthTokens, 0)
eq('空数据 topModel', empty.topModel, null)

// ==================== OpenCode Go 额度解析（/zen/go/v1/usage） ====================
const norm = api._internal.normalizeOpencodeWindow
const parse = api._internal.parseOpencodeUsage
const isOc = api._internal.isOpencodeKey

// 官方实测形态：percent 0–100 + resetsAt ISO
const w1 = norm('rolling', '滚动 5h', { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' }, 12)
eq('滚动 percent', w1.percent, 9)
eq('滚动 remaining', w1.remaining, 91)
eq('滚动 limit', w1.limit, 12)
eq('滚动 resetAt 解析为时间戳', typeof w1.resetAt, 'number')
eq('滚动 status', w1.status, 'ok')

// 小数 percent（0–1）归一化
const w2 = norm('weekly', '周额度', { percent: 0.42, reset_at: 1760000000 }, 30)
eq('周 percent 小数×100', w2.percent, 42)
eq('周 reset Unix秒→毫秒', w2.resetAt, 1760000000 * 1000)

// used/limit 按比例兜底 + 别名键
const w3 = norm('monthly', '月额度', { used: 50, limit: 100, resetsAt: '' }, 60)
eq('月 used/limit 比例', w3.percent, 50)
eq('月 无 reset', w3.resetAt, null)
eq('月 limit', w3.limit, 60)

// 超界钳制
const w4 = norm('rolling', '滚动 5h', { percent: 120 }, 12)
eq('超界钳制 100', w4.percent, 100)

// 完整响应解析（官方形态 + 别名兼容）
const full = parse({ usage: {
  rolling: { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' },
  weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
  monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
} })
eq('三窗口数量', full.length, 3)
eq('窗口顺序 滚动/周/月', full.map(w => w.key).join(','), 'rolling,weekly,monthly')
eq('窗口1 percent', full[0].percent, 9)
eq('窗口2 percent', full[1].percent, 12)
eq('窗口3 percent', full[2].percent, 6)

// data 顶层兼容 + 别名键
const alt = parse({ data: { '5h': { percent: 5 }, week: { percent: 10 }, month: { percent: 15 } } })
eq('别名键解析', alt.map(w => w.percent).join(','), '5,10,15')

// 无窗口 → 空数组
eq('空响应 → 空数组', parse({}).length, 0)
eq('null 响应 → 空数组', parse(null).length, 0)

// Key 前缀识别
eq('sk-opencode- 识别', isOc('sk-opencode-abc123'), true)
eq('普通 sk- 不识别为 opencode', isOc('sk-abc123'), false)
eq('空串不识别', isOc(''), false)

// 重置倒计时
const cd = api._internal.fmtCountdown(Date.now() + 1000 * 60 * 60 * 3 + 1000 * 60 * 20)
eq('倒计时 3小时20分', cd, '3小时20分')
eq('无重置时间 → 空串', api._internal.fmtCountdown(null), '')

// 提供方自动识别（纯自动，无配置 UI）
eq('无凭证默认 deepseek', api.resolveProvider(), 'deepseek')
storage.set('dshu.opencodeKey', 'sk-opencode-x')
eq('opencode key 存在 → opencode-go', api.resolveProvider(), 'opencode-go')
storage.delete('dshu.opencodeKey')
storage.set('dshu.apiKey', 'sk-opencode-y')
eq('apiKey 是 sk-opencode- → opencode-go', api.resolveProvider(), 'opencode-go')
storage.delete('dshu.apiKey')
eq('独有模型 minimax-m3 → opencode-go', api.resolveProvider('minimax-m3'), 'opencode-go')
eq('独有模型 qwen3.7-plus → opencode-go', api.resolveProvider('qwen3.7-plus'), 'opencode-go')
eq('deepseek-v4-flash 且无 opencode key → deepseek', api.resolveProvider('deepseek-v4-flash'), 'deepseek')
eq('无模型参数 → deepseek', api.resolveProvider(undefined), 'deepseek')

// ---- fetchOpencodeGoUsage：401 路径 + 成功路径（mock fetch；非动态宿主走官方桥） ----
async function runFetchTests() {
  const originalFetch = globalThis.fetch
  try {
    // 401 → 错误信息
    globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => '{}' })
    storage.set('dshu.opencodeKey', 'sk-opencode-test')
    let r = await api.fetchOpencodeUsage()
    eq('401 → error 文案', r && r.error, 'OpenCode Go API Key 无效或已失效')

    // 成功 → 三窗口
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ usage: {
      rolling: { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' },
      weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
      monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
    } }) })
    r = await api.fetchOpencodeUsage()
    eq('成功 → provider', r.provider, 'opencode-go')
    eq('成功 → 窗口数', r.windows.length, 3)
    eq('成功 → 首窗口 percent', r.windows[0].percent, 9)

    // 无 Key → null
    storage.delete('dshu.opencodeKey')
    r = await api.fetchOpencodeUsage()
    eq('无 Key → null', r, null)
  } finally {
    globalThis.fetch = originalFetch
  }
}

runFetchTests().then(() => {
  console.log(failed === 0 ? '\n官方模块单测全部通过 ✅' : `\n${failed} 项失败 ❌`)
  process.exit(failed === 0 ? 0 : 1)
})
