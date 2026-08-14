/**
 * 采样 DSH 真实组件色值：在真实 GUI 页面读取侧边栏/主区/输入框/卡片等
 * 实际渲染颜色，用于校准用量面板的语义变量映射。
 */
const { chromium } = require('./playwright-lib.js')

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('body', { timeout: 15000 })
  await page.waitForTimeout(5000)

  const sample = await page.evaluate(() => {
    const css = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, radius: cs.borderRadius }
    }
    const find = (predicate) => {
      const all = [...document.querySelectorAll('*')]
      const el = all.find(predicate)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { tag: el.tagName, cls: String(el.className).slice(0, 60), bg: cs.backgroundColor, color: cs.color }
    }
    const out = {}
    out.body = css('body')
    // 侧边栏：找包含"会话"/"Search"文本的最左侧容器
    const sidebar = find((el) => {
      if (el.children.length > 20) return false
      const t = el.textContent || ''
      return (t.includes('Search sessions') || t.includes('搜索会话')) && t.length < 120
    })
    out.sidebar = sidebar
    // 聊天区背景：body 的直接子级大面积元素
    const main = find((el) => {
      const r = el.getBoundingClientRect()
      const t = el.textContent || ''
      return r.width > 600 && r.height > 400 && t.length > 200 && el.children.length < 15
    })
    out.mainArea = main
    // 输入框
    out.input = css('textarea, [contenteditable="true"], input[type="text"]')
    // 按钮
    out.button = css('button')
    // 滚动容器/卡片
    out.card = find((el) => {
      const cs = getComputedStyle(el)
      return cs.borderRadius === '8px' && (el.textContent || '').length > 50 && el.children.length < 10
    })
    // 变量实际值
    const b = getComputedStyle(document.body)
    out.vars = {}
    for (const v of ['--dsw-alias-bg-base', '--dsw-alias-bg-overlay', '--dsw-alias-bg-module-platform', '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner', '--dsw-specific-menu', '--dsw-specific-sidebar-fill', '--dsw-specific-input-major', '--dsw-alias-button-floating-fill', '--dsw-alias-bg-layer-3', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-1']) {
      out.vars[v] = b.getPropertyValue(v).trim()
    }
    return out
  })
  console.log(JSON.stringify(sample, null, 2))
  await browser.close()
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
