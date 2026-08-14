/**
 * Node 联调测试：加载 usage-display.js 核心，直连本机 DSH 服务（http://127.0.0.1:3080），
 * 验证数据管线与统计计算。运行：node smoke-test.js [sessionId]
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const BASE = 'http://127.0.0.1:3080'
const NATIVE_FETCH = globalThis.fetch // Node 18+ 原生 fetch

// ---- 最小环境垫片：localStorage + 代理 fetch（与浏览器同源语义一致） ----
const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
}
globalThis.fetch = (url, init) => {
  const target = String(url).startsWith('http') ? String(url) : `${BASE}${url}`
  return NATIVE_FETCH(target, init)
}

// ---- 加载被测核心（在全局作用域执行，暴露 __DSH_USAGE_DISPLAY） ----
const code = readFileSync(join(__dirname, 'usage-display.js'), 'utf8')
;(0, eval)(code)

const api = globalThis.__DSH_USAGE_DISPLAY
if (!api) { console.error('FAIL: __DSH_USAGE_DISPLAY 未暴露'); process.exit(1) }

async function run() {
  const sessionId = process.argv[2]
  const sid = sessionId || (await api._internal.resolveSessionId())
  console.log('sessionId:', sid)

  const { events, projections } = await api._internal.fetchSession(sid)
  console.log('events:', events.length, 'hasProjections:', !!projections)
  const values = projections && projections.values ? projections.values : {}
  if (values.tokenUsage) console.log('tokenUsage:', JSON.stringify(values.tokenUsage))
  if (values.contextPressure) console.log('contextPressure:', JSON.stringify(values.contextPressure))
  if (values.contextBreakdown) console.log('contextBreakdown:', JSON.stringify(values.contextBreakdown))
  if (values.sessionStats) console.log('sessionStats:', JSON.stringify(values.sessionStats))

  const subagents = await api._internal.fetchSubagentUsage(sid)
  console.log('subagents:', subagents.length, subagents.map(s => `${s.mode}:${s.sessionId}`).join(', '))

  const stats = api.computeStats({ events, projections, subagents })
  console.log('\n===== 统计结果 =====')
  console.log('上下文窗口 :', api._internal.fmtCompact(stats.contextWindow), `(${api._internal.fmtInt(stats.contextWindow)})`)
  console.log('已用       :', api._internal.fmtCompact(stats.used), `(${stats.usedPct.toFixed(1)}%)`)
  console.log('距压缩     :', api._internal.fmtCompact(stats.untilCompress), `(阈值 ${stats.thresholdPct.toFixed(0)}%)`)
  console.log('平均命中   :', stats.hitRate.toFixed(2) + '%')
  console.log('主模型     :', stats.model || '(未知)')
  console.log('会话费用   :', api._internal.fmtMoney(stats.cost), `(主模型 ${api._internal.fmtMoney(stats.costMain)} / 子代理 ${api._internal.fmtMoney(stats.costSub)})`)
  console.log('运行时间   :', api._internal.fmtDuration(stats.durationMs))
  console.log('请求数     :', api._internal.fmtInt(stats.requests))
  console.log('累计 tokens:', api._internal.fmtInt(stats.totalTokens))
  console.log('输入       :', api._internal.fmtInt(stats.input), '| 输出:', api._internal.fmtInt(stats.output))
  console.log('命中       :', api._internal.fmtInt(stats.hit), '| 未命中:', api._internal.fmtInt(stats.miss))
  console.log('主模型占比 :', stats.mainShare.toFixed(1) + '%')

  // ---- 断言 ----
  const checks = []
  const eq = (name, actual, expected) => checks.push([name, actual === expected, actual, expected])
  if (values.tokenUsage) {
    eq('tokenUsage 输入合计', stats.input, (values.tokenUsage.uncachedInputTokens || 0) + (values.tokenUsage.cacheReadTokens || 0) + (values.tokenUsage.cacheWriteTokens || 0))
    eq('tokenUsage 输出', stats.output, values.tokenUsage.outputTokens || 0)
  }
  if (values.contextPressure) {
    eq('contextWindow', stats.contextWindow, values.contextPressure.contextWindow || 1000000)
  }
  eq('命中+未命中=输入', stats.hit + stats.miss, stats.input)
  eq('请求数>0', stats.requests > 0, true)
  let failed = 0
  for (const [name, ok, actual, expected] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${JSON.stringify(actual)} ${ok ? '' : `(期望 ${JSON.stringify(expected)})`}`)
    if (!ok) failed += 1
  }
  console.log(failed === 0 ? '\n全部断言通过 ✅' : `\n${failed} 项断言失败 ❌`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch((e) => { console.error('运行失败:', e); process.exit(1) })
