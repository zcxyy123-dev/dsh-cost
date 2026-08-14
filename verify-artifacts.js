/**
 * 产物验证：确认三个打包形态（油猴/控制台/扩展副本）内的核心代码均可加载、
 * 且能对线上 DSH 完成完整数据管线。运行：node verify-artifacts.js [sessionId]
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const BASE = 'http://127.0.0.1:3080'
const NATIVE_FETCH = globalThis.fetch

const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
}
globalThis.fetch = (url, init) => NATIVE_FETCH(String(url).startsWith('http') ? String(url) : `${BASE}${url}`, init)

function load(label, file) {
  const code = readFileSync(file, 'utf8')
  delete globalThis.__DSH_USAGE_DISPLAY
  ;(0, eval)(code)
  const api = globalThis.__DSH_USAGE_DISPLAY
  if (!api) throw new Error(`${label}: __DSH_USAGE_DISPLAY 未暴露`)
  console.log(`PASS  ${label}: 核心加载成功（${file}）`)
  return api
}

async function run() {
  const files = [
    ['油猴脚本', join(__dirname, 'userscript', '用量显示.user.js')],
    ['控制台注入版', join(__dirname, 'console', '用量显示-控制台注入.js')],
    ['扩展副本', join(__dirname, 'extension', 'usage-display.js')],
  ]
  const apis = files.map(([label, file]) => load(label, file))

  // 用油猴版核心跑一次完整管线
  const api = apis[0]
  const sessionId = process.argv[2] || (await api._internal.resolveSessionId())
  console.log('管线 sessionId:', sessionId)
  const { events, projections } = await api._internal.fetchSession(sessionId)
  const subagents = await api._internal.fetchSubagentUsage(sessionId)
  const stats = api.computeStats({ events, projections, subagents })
  console.log(`PASS  完整管线: events=${events.length} 请求=${stats.requests} 累计=${stats.totalTokens} 命中率=${stats.hitRate.toFixed(2)}% 费用=${stats.cost.toFixed(4)} 已用=${stats.usedPct.toFixed(1)}% 运行=${stats.durationMs}ms`)
  if (stats.totalTokens <= 0 || stats.requests <= 0) throw new Error('统计结果异常')
  console.log('\n产物验证全部通过 ✅')
  process.exit(0)
}

run().catch((e) => { console.error('FAIL:', e); process.exit(1) })
