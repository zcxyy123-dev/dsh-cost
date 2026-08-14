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

console.log(`\n全部 ${pass} 项断言通过 ✅`)
process.exit(0)
