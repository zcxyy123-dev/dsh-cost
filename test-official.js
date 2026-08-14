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

console.log(failed === 0 ? '\n官方模块单测全部通过 ✅' : `\n${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
