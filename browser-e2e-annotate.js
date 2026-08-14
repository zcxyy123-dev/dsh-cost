/**
 * 消息标注 E2E：注入核心脚本后，验证聊天区每个已完成回合底部（复制按钮旁）
 * 出现"↑ 输入 X · ↓ 输出 Y · 费用"标注。运行：node browser-e2e-annotate.js
 * 需要 DSH web 在 3080 运行。
 */
const { chromium } = require('./playwright-lib.js')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const URL = 'http://127.0.0.1:3080/'
const CORE = readFileSync(join(__dirname, 'usage-display.js'), 'utf8')

async function main() {
  try {
    const res = await fetch(URL, { method: 'HEAD' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    console.error('3080 未在运行，跳过 e2e:', e.message)
    process.exit(3)
  }

  // 挑一个含 assistant/message 的会话
  const rpc = async (method, payload) => {
    const resp = await fetch(`${URL}api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `e2e-${Date.now()}`, method, payload }),
    })
    const body = await resp.json()
    return body.result && body.result.ok ? body.result.value : null
  }
  const list = await rpc('session.list', {})
  const items = (list && list.items) || []
  let sessionId = ''
  for (const row of [...items].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    const v = await rpc('session.history', { sessionId: row.sessionId, maxMessages: 20 })
    const evs = (v && v.events) || []
    if (evs.some(e => (e.event ? e.event : e).type === 'assistant/message')) { sessionId = row.sessionId; break }
  }
  console.log('session:', sessionId || '(无可用会话)')
  if (!sessionId) process.exit(4)

  let browser
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true })
  } catch (e1) {
    browser = await chromium.launch({ channel: 'chrome', headless: true })
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('body', { timeout: 15000 })
  await page.evaluate((id) => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: id }))
  }, sessionId)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(6000)

  await page.addScriptTag({ content: CORE })

  // 等待标注出现（全量拉取大会话可能需几秒）
  let result = null
  for (let i = 0; i < 60; i++) {
    result = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('[data-turn-tail] .dshu-msg-usage')]
      const tails = [...document.querySelectorAll('[data-turn-tail]')]
      return {
        tailCount: tails.length,
        chipCount: chips.length,
        samples: chips.slice(0, 4).map(c => c.textContent.trim()),
        nextToCopy: chips.every(c => {
          const prev = c.previousElementSibling
          return prev && prev.tagName === 'BUTTON' && (prev.getAttribute('aria-label') === '复制' || prev.getAttribute('aria-label') === 'Copy')
        }),
      }
    })
    if (result.chipCount > 0 && result.chipCount >= result.tailCount * 0.5) break
    await page.waitForTimeout(1000)
  }
  console.log('annotations:', JSON.stringify(result, null, 2))

  const ok = result && result.chipCount > 0
  console.log(`${ok ? 'PASS' : 'FAIL'}  聊天区已完成回合底部出现用量标注（${result ? result.chipCount : 0}/${result ? result.tailCount : 0}）`)
  const chipTextOk = ok && result.samples.every(t => /↑/.test(t) && /↓/.test(t) && /[¥$]/.test(t))
  console.log(`${chipTextOk ? 'PASS' : 'FAIL'}  标注内容含 输入↑ / 输出↓ / 费用`)

  const panelMounted = await page.evaluate(() => !!document.getElementById('dsh-usage-display-host'))
  console.log(`${panelMounted ? 'PASS' : 'FAIL'}  用量面板同时挂载（共用注入）`)

  await page.screenshot({ path: join(__dirname, 'screenshot-annotate.png') })
  console.log('screenshot saved: screenshot-annotate.png')
  await browser.close()
  process.exit(ok && chipTextOk && panelMounted ? 0 : 1)
}

main().catch(e => { console.error('FAIL:', e); process.exit(1) })
