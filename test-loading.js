/**
 * 会话切换监听 + 加载遮罩逻辑的 Node 模拟测试（无 DOM，只验证状态机）。
 * 运行：node test-loading.js
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const storage = new Map()
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
}
globalThis.document = undefined // 阻止自动挂载（init 直接 return）

let pass = 0
function assert(cond, label) {
  if (!cond) throw new Error(`FAIL: ${label}`)
  pass++
  console.log(`PASS  ${label}`)
}

const code = readFileSync(join(__dirname, 'usage-display.js'), 'utf8')
delete globalThis.__DSH_USAGE_DISPLAY
;(0, eval)(code)
const api = globalThis.__DSH_USAGE_DISPLAY
if (!api) throw new Error('__DSH_USAGE_DISPLAY 未暴露')

const SESSION_KEY = 'dsh.sessions.current'
const { checkSessionSwitch, setLoading } = api._internal

// 1) 首次检测：null → 会话A，返回 true 并记录
assert(checkSessionSwitch() === false, '无会话时不触发')
storage.set(SESSION_KEY, JSON.stringify({ sessionId: 'sess-A' }))
assert(checkSessionSwitch() === true, '会话出现（null→A）时触发一次')
assert(checkSessionSwitch() === false, '同一会话不重复触发')

// 2) 切换会话：A → B 触发；连续调用不再触发
storage.set(SESSION_KEY, JSON.stringify({ sessionId: 'sess-B' }))
assert(checkSessionSwitch() === true, '切换会话（A→B）触发')
assert(checkSessionSwitch() === false, '切换后不重复触发')

// 3) 快速连切：直接落到最新值（B→C 只触发一次）
storage.set(SESSION_KEY, JSON.stringify({ sessionId: 'sess-C' }))
assert(checkSessionSwitch() === true, '快速连切（B→C）触发')
assert(checkSessionSwitch() === false, '连切后稳定')

// 4) setLoading 引用计数在无 shadow 时安全（Node 环境不抛错）
setLoading(true)
setLoading(true)
setLoading(false)
setLoading(false)
assert(true, 'setLoading 引用计数无 DOM 安全')

// ---- 加载遮罩显隐状态机（新行为：仅首次/会话切换后第一次请求显示） ----
const traces = []
const { setLoadingTracer, setSessionSwitching, setLastStats } = api._internal
setLoadingTracer((show) => traces.push(show))

// 5) 首次加载（尚无数据）→ 显示遮罩，结束后隐藏
traces.length = 0
setLoading(true)
assert(traces.includes(true), '首次加载（无数据）显示遮罩')
setLoading(false)
assert(traces.includes(false), '首次加载结束隐藏遮罩')

// 6) 会话切换后的第一次请求 → 显示遮罩
traces.length = 0
setSessionSwitching(true)
setLoading(true)
assert(traces.includes(true), '会话切换后的第一次请求显示遮罩')
setLoading(false)
assert(traces.includes(false), '切换后首次加载结束隐藏遮罩')
assert(traces.length === 2, '切换后首次请求恰好显示一次')

// 7) 后续常规刷新 → 静默更新，不显示遮罩
traces.length = 0
setLastStats({ used: 1 })
setSessionSwitching(false)
setLoading(true)
assert(!traces.includes(true), '后续刷新静默更新，不显示遮罩')
setLoading(false)
assert(traces.length === 1 && traces[0] === false, '静默刷新仅收尾隐藏（遮罩本就未显示）')

// 8) 会话切换期间的重叠请求：遮罩保持显示，全部结束后只隐藏一次
traces.length = 0
setSessionSwitching(true)
setLoading(true)
setLoading(true)
assert(traces.includes(true), '切换后重叠请求保持遮罩显示')
setLoading(false)
setLoading(false)
assert(traces.filter((v) => v === false).length === 1, '重叠请求全部结束后只隐藏一次')

console.log(`\n全部 ${pass} 项断言通过 ✅`)
process.exit(0)
