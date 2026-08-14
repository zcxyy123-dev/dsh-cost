/**
 * 错误路径回归 E2E：会话加载失败时应优雅显示"加载失败"，绝不能抛
 * ReferenceError 之类的未捕获异常（回归 #renderError 丢失事故）。
 * 运行：node browser-e2e-error.js
 */
const { chromium } = require('./playwright-lib.js')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const CORE = readFileSync(join(__dirname, 'usage-display.js'), 'utf8')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e)))

  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('body', { timeout: 15000 })
  await page.waitForTimeout(3000)
  // 指向一个不存在的会话 → session.history 必然失败 → 走 catch/renderError 分支
  await page.evaluate(() => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-does-not-exist-0000' }))
  })
  await page.addScriptTag({ content: CORE })
  await page.waitForTimeout(6000)

  const state = await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    return host ? host.shadowRoot.querySelector('.dshu-body').innerText : '<no panel>'
  })
  console.log('面板错误路径显示:', state.includes('加载失败') ? `PASS: ${state.slice(0, 80)}` : 'FAIL: ' + state.slice(0, 120))
  console.log('未捕获页面异常:', pageErrors.length === 0 ? 'PASS（零异常）' : 'FAIL: ' + pageErrors.join(' | '))

  // 恢复正常会话，确认面板还能自愈
  await page.evaluate(() => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 'session-eb6b660e-eb5d-42b4-9f18-fb6477fd8e42' }))
  })
  await page.waitForTimeout(7000)
  const healed = await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    return host ? host.shadowRoot.querySelector('.dshu-body').innerText.includes('上下文窗口') : false
  })
  console.log('恢复会话后自愈:', healed ? 'PASS' : 'FAIL')

  await browser.close()
  process.exit(pageErrors.length === 0 && healed ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
