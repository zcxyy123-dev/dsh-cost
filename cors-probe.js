/**
 * CORS 实测：从 127.0.0.1:3080 页面上下文直连 DeepSeek 官方端点，看浏览器是否放行。
 * 决定官方账户模块的传输方案（页面直连 vs 扩展后台代理）。
 */
const { chromium } = require('./playwright-lib.js')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(3000)

  const result = await page.evaluate(async () => {
    const probe = async (name, url, init) => {
      try {
        const r = await fetch(url, init)
        const text = await r.text()
        return { name, ok: true, status: r.status, cors: r.headers.get('access-control-allow-origin'), body: text.slice(0, 160) }
      } catch (e) {
        return { name, ok: false, error: String(e).slice(0, 160) }
      }
    }
    const out = []
    out.push(await probe('balance(无Key)', 'https://api.deepseek.com/user/balance', { headers: { Accept: 'application/json' } }))
    out.push(await probe('balance(Bearer假Key)', 'https://api.deepseek.com/user/balance', { headers: { Accept: 'application/json', Authorization: 'Bearer sk-test-cors-probe' } }))
    out.push(await probe('platform amount(无Token)', 'https://platform.deepseek.com/api/v0/usage/amount?month=8&year=2026', { headers: { Accept: 'application/json' } }))
    out.push(await probe('platform cost(假Token)', 'https://platform.deepseek.com/api/v0/usage/cost?month=8&year=2026', { headers: { Accept: 'application/json', Authorization: 'Bearer fake-token-probe' } }))
    return out
  })
  console.log(JSON.stringify(result, null, 2))
  await browser.close()
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
