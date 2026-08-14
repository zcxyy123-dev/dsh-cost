/**
 * 消息标注（每条回合底部用量/费用）逻辑的 Node 单元测试。
 * 用合成事件验证 mergeTurnSteps / turnTotals：聚合、去重、模型、费用、增量并入。
 * 运行：node test-annotate.js
 */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}
globalThis.document = undefined // 阻止自动挂载

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
const { mergeTurnSteps, turnTotals } = api._internal

// --- 合成事件 ---
const ev = (type, turn, step, extra) => ({ event: { type, data: { turn, step, ...extra } } })
const msgEv = (turn, step, usage, model) => ev('assistant/message', turn, step, {
  usage,
  message: { role: 'assistant', source: model ? { model } : {} },
})
const chunkEv = (turn, step, usage) => ev('assistant/chunk', turn, step, {
  chunk: { type: 'usage', usage },
})

// 回合 1：两步（message 带 usage + model；第二步只有 chunk usage）
const turn1Step1 = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 300, cacheWriteTokens: 0, reasoningTokens: 50 }
const turn1Step2 = { inputTokens: 500, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
// 回合 2：单步（message 与 chunk 同 step，message 应覆盖 chunk）
const turn2Usage = { inputTokens: 800, outputTokens: 300, cacheReadTokens: 100, cacheWriteTokens: 50, reasoningTokens: 10 }

const events = [
  msgEv(1, 1, turn1Step1, 'deepseek-v4-flash'),
  chunkEv(1, 2, turn1Step2),
  chunkEv(2, 1, { inputTokens: 999, outputTokens: 999, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  msgEv(2, 1, turn2Usage, 'deepseek-v4-pro'),
]

const steps = new Map()
mergeTurnSteps(steps, events)
assert(steps.size === 3, '3 个 turn:step 键被记录')

// --- 回合 1 汇总 ---
const t1 = turnTotals(steps, 1)
assert(t1 !== null, '回合 1 有汇总')
assert(t1.input === 1000 + 300 + 500, '回合 1 输入 = uncached + cacheRead + cacheWrite（跨步求和）')
assert(t1.output === 200 + 100, '回合 1 输出跨步求和')
assert(t1.hit === 300 && t1.miss === 1000 + 500, '回合 1 命中/未命中拆分正确')
assert(t1.reasoning === 50, '回合 1 推理 token 记录')
assert(t1.model === 'deepseek-v4-flash', '回合 1 模型取自 message.source.model')
// 费用：flash 价目 hit 0.0028 / miss 0.14 / output 0.28，CNY ×7.14
const expectCost = ((300 * 0.0028 + 1500 * 0.14 + 300 * 0.28) / 1e6) * 7.14
assert(Math.abs(t1.cost - expectCost) < 1e-9, `回合 1 费用按价目表计算（${t1.cost.toFixed(6)} ≈ ${expectCost.toFixed(6)}）`)

// --- 回合 2：message 覆盖 chunk（同 step 后者优先） ---
const t2 = turnTotals(steps, 2)
assert(t2 !== null, '回合 2 有汇总')
assert(t2.input === 800 + 100 + 50, '回合 2 输入取 message 用量（覆盖 chunk 的 999）')
assert(t2.output === 300, '回合 2 输出取 message 用量')
assert(t2.model === 'deepseek-v4-pro', '回合 2 模型 = deepseek-v4-pro')

// --- 增量并入：新回合/新步骤追加 ---
mergeTurnSteps(steps, [chunkEv(3, 1, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })])
const t3 = turnTotals(steps, 3)
assert(t3 !== null && t3.input === 10 && t3.output === 5, '增量并入新回合步骤')

// --- 无用量回合 / 未知回合 ---
assert(turnTotals(steps, 99) === null, '无数据的回合返回 null')

console.log(`\n全部 ${pass} 项断言通过 ✅`)
process.exit(0)
