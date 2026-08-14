/**
 * 官方模块浏览器 E2E：真实 GUI 页面注入核心后验证
 *   1. 无凭证 → 显示"未配置凭证"
 *   2. 设置弹层可打开/保存/清除
 *   3. 假 API Key → 余额区块显示"无效"（直连官方 401，走 CORS 放行路径）
 *   4. 桥协议：注入模拟 content 桥后，官方请求改走桥并成功回传
 * 运行：node browser-e2e-official.js
 */
const { chromium } = require('./playwright-lib.js')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const CORE = readFileSync(join(__dirname, 'usage-display.js'), 'utf8')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('body', { timeout: 15000 })
  await page.waitForTimeout(3000)
  await page.evaluate((sid) => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: sid }))
  }, 'session-eb6b660e-eb5d-42b4-9f18-fb6477fd8e42')
  await page.addScriptTag({ content: CORE })
  await page.waitForTimeout(4000)

  const bodyText = () => page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    return host ? host.shadowRoot.querySelector('.dshu-body').innerText : ''
  })

  // 1. 无凭证
  let text = await bodyText()
  console.log('无凭证显示未配置:', text.includes('未配置凭证') ? 'PASS' : 'FAIL')

  // 2. 打开设置弹层
  const settingsOpened = await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    const shadow = host.shadowRoot
    const gear = [...shadow.querySelectorAll('.dshu-btn')].find(b => b.textContent === '⚙')
    gear.click()
    return !!shadow.querySelector('.dshu-settings')
  })
  console.log('设置弹层打开:', settingsOpened ? 'PASS' : 'FAIL')

  // 3. 填假 Key → 保存 → 余额应显示"无效"
  await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    const shadow = host.shadowRoot
    const input = shadow.querySelector('.dshu-field-bar input')
    input.value = 'sk-fake-key-for-e2e-test'
    const save = [...shadow.querySelectorAll('.dshu-btn')].find(b => b.textContent === '保存')
    save.click()
  })
  await page.waitForTimeout(6000) // 等官方请求（直连 401）完成
  text = await bodyText()
  console.log('假Key显示无效:', text.includes('无效') || text.includes('查询失败') ? `PASS (${text.match(/余额[^】]*/)?.[0]})` : `FAIL (${text.slice(0, 200)})`)

  // 4. 桥协议：注入模拟桥 + 模拟 content 监听，验证官方请求走桥
  const bridgeWorks = await page.evaluate(() => {
    return new Promise((resolve) => {
      // 模拟 content script 监听并回传 mock 结果
      window.addEventListener('dshu:official:req', (e) => {
        const d = e.detail
        window.dispatchEvent(new CustomEvent('dshu:official:res', {
          detail: { id: d.id, result: { ok: true, status: 200, body: JSON.stringify({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '5.71', granted_balance: '0.00', topped_up_balance: '5.71' }] }) } },
        }))
      })
      // 手动注入桥（与 extension/bridge.js 相同协议）
      const bridge = (url, init) => new Promise((res2, rej2) => {
        const id = 't-' + Date.now()
        const handler = (ev) => { if (ev.detail.id === id) { window.removeEventListener('dshu:official:res', handler); res2(ev.detail.result) } }
        window.addEventListener('dshu:official:res', handler)
        window.dispatchEvent(new CustomEvent('dshu:official:req', { detail: { id, url, init } }))
      })
      window.__dshuBridgeFetch = bridge
      // 手动走核心的官方余额函数
      window.__DSH_USAGE_DISPLAY.fetchBalance()
        .then((b) => resolve(b ? `PASS 余额=${b.total} ${b.currency}` : 'FAIL 返回空'))
        .catch((e) => resolve('FAIL ' + e.message))
    })
  })
  console.log('桥协议余额:', bridgeWorks)

  // 5. 清除凭证
  await page.evaluate(() => {
    localStorage.removeItem('dshu.apiKey')
    localStorage.removeItem('dshu.platformToken')
  })
  await browser.close()
  process.exit(0)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
