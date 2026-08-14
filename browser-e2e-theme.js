/**
 * 主题跟随 E2E：验证面板颜色跟随 DSH 亮/暗主题（body[data-ds-dark-theme]）。
 * 断言：切换主题后，面板背景/文字色的 computed style 随之变化，且
 * 变量解析值等于 DSH 页面的语义变量值（证明走的是 DSH 变量而非 fallback）。
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
  await page.addScriptTag({ content: CORE })
  await page.waitForTimeout(5000)

  const sample = async (theme) => {
    return page.evaluate((t) => {
      document.body.removeAttribute('data-ds-dark-theme')
      if (t === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
      const host = document.getElementById('dsh-usage-display-host')
      const shadow = host.shadowRoot
      const panel = shadow.querySelector('.dshu-panel')
      const cell = shadow.querySelector('.dshu-cell')
      const cs = getComputedStyle(panel)
      const cc = getComputedStyle(cell)
      const bodyVars = getComputedStyle(document.body)
      return {
        theme: t,
        panelBg: cs.backgroundColor,
        panelText: cs.color,
        panelBorder: cs.borderTopColor,
        cellBg: cc.backgroundColor,
        dswSidebar: bodyVars.getPropertyValue('--dsw-specific-sidebar-fill').trim() || '(未定义)',
        dswInput: bodyVars.getPropertyValue('--dsw-specific-input-major').trim() || '(未定义)',
      }
    }, theme)
  }

  const dark = await sample('dark')
  const light = await sample('light')
  console.log('暗色:', JSON.stringify(dark))
  console.log('亮色:', JSON.stringify(light))

  // 面板底必须与 DSH 侧边栏同色（像素级一致），cell 底与输入框同色
  const darkMatch = dark.panelBg === dark.dswSidebar && dark.cellBg === dark.dswInput
  const lightMatch = light.panelBg === light.dswSidebar && light.cellBg === light.dswInput
  const followsTheme = dark.panelBg !== light.panelBg
  console.log('暗色: 面板底=侧边栏底, cell=输入框底:', darkMatch ? 'PASS' : 'FAIL')
  console.log('亮色: 面板底=侧边栏底, cell=输入框底:', lightMatch ? 'PASS' : 'FAIL')
  console.log('面板颜色随主题变化:', followsTheme ? 'PASS' : 'FAIL')

  await page.screenshot({ path: join(__dirname, 'screenshot-theme-dark.png') })
  // 亮色截图
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(__dirname, 'screenshot-theme-light.png') })
  await browser.close()
  process.exit(darkMatch && lightMatch && followsTheme ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
