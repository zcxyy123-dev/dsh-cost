/**
 * 免粘贴全链路 E2E：本地凭证服务（setup-key.js）已启动时，
 * 面板应在数秒内自动导入真实 API Key、调官方 balance 显示真实余额，
 * 并关闭本地服务。
 * 运行：先启动 node setup-key.js，再运行 node browser-e2e-auto.js
 */
const { chromium } = require('./playwright-lib.js')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const CORE = readFileSync(join(__dirname, 'usage-display.js'), 'utf8')
const CRED_URL = 'http://127.0.0.1:3987/credentials'

async function main() {
  // 前置检查：凭证服务必须已启动
  const pre = await fetch(CRED_URL).then(r => r.json()).catch(() => null)
  if (!pre || !pre.apiKey) {
    console.error('请先启动: node setup-key.js')
    process.exit(2)
  }
  console.log('凭证服务就绪（掩码）:', pre.apiKey.slice(0, 6) + '…' + pre.apiKey.slice(-4))

  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('body', { timeout: 15000 })
  await page.waitForTimeout(3000)
  await page.evaluate((sid) => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: sid }))
  }, 'session-eb6b660e-eb5d-42b4-9f18-fb6477fd8e42')
  await page.addScriptTag({ content: CORE })
  await page.waitForTimeout(8000) // 等首次刷新 + 自动探测 + 官方余额

  const state = await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    const body = host ? host.shadowRoot.querySelector('.dshu-body').innerText : ''
    return {
      hasKey: !!localStorage.getItem('dshu.apiKey'),
      keyMasked: localStorage.getItem('dshu.apiKey') ? localStorage.getItem('dshu.apiKey').slice(0, 6) + '…' + localStorage.getItem('dshu.apiKey').slice(-4) : null,
      body,
    }
  })
  console.log('localStorage 已导入 Key:', state.hasKey ? 'PASS (' + state.keyMasked + ')' : 'FAIL')
  const lines = state.body.split('\n')
  const balanceIdx = lines.findIndex(l => l.includes('余额'))
  const balanceValue = balanceIdx >= 0 ? lines[balanceIdx + 1] : null
  console.log('官方余额行:', balanceValue ? `PASS: ${balanceValue}` : 'FAIL: 未找到余额')
  // 无 userToken 时不应出现"本月费用"（平台接口未配置）；区块标题必须存在
  const hasSection = state.body.includes('DeepSeek 直连')
  const noPlatformWithoutToken = !state.body.includes('本月费用') || state.body.includes('平台 Token')
  console.log('官方区块标题:', hasSection ? 'PASS' : 'FAIL')
  console.log('未配 Token 不显示平台费用:', noPlatformWithoutToken ? 'PASS' : 'FAIL')
  const full = state.hasKey && balanceValue !== null && hasSection && noPlatformWithoutToken

  // 桥现在保持运行（同时服务文件浏览），不再自动关闭；断言桥仍可用
  const after = await fetch(CRED_URL).then(r => r.json()).catch(() => null)
  console.log('本地桥保持运行(文件服务):', after && after.apiKey ? 'PASS' : 'FAIL')

  await page.screenshot({ path: join(__dirname, 'screenshot-auto-import.png') })
  await browser.close()
  process.exit(full && state.hasKey && !after ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
