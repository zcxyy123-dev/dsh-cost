/**
 * 浏览器端到端验证（可选）：用 Playwright + 系统 Edge/Chrome 打开 DSH 网页，
 * 注入核心脚本，验证"嵌入右侧列"布局 + [用量|文件] 视图切换 + 卸载恢复，并截图。
 * 运行：node browser-e2e.js [sessionId]
 * 需要 DSH web 正在 3080 端口运行。
 */
const { chromium } = require('./playwright-lib.js')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const URL = 'http://127.0.0.1:3080/'
const CORE = readFileSync(join(__dirname, 'usage-display.js'), 'utf8')

async function main() {
  // 先探测服务在线
  try {
    const res = await fetch(URL, { method: 'HEAD' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (e) {
    console.error('3080 未在运行，跳过 e2e:', e.message)
    process.exit(3)
  }

  let browser
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true })
  } catch (e1) {
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true })
    } catch (e2) {
      console.error('无法启动 Edge/Chrome:', e1.message, '|', e2.message)
      process.exit(2)
    }
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('body', { timeout: 15000 })
  await page.waitForTimeout(4000)

  const sessionId = process.argv[2] || ''
  await page.evaluate((sid) => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: sid }))
  }, sessionId)

  await page.addScriptTag({ content: CORE })

  // 等待面板嵌入（waitFrame 最长 30s）
  let layout = null
  for (let i = 0; i < 40; i++) {
    layout = await page.evaluate(() => {
      const host = document.getElementById('dsh-usage-display-host')
      if (!host || !host.parentElement) return null
      const frame = host.parentElement
      const siblings = [...frame.children]
      return {
        mounted: true,
        is4thChild: (() => {
          const inFlow = siblings.filter(s => getComputedStyle(s).position !== 'absolute')
          return inFlow.indexOf(host) === 3 && inFlow[inFlow.length - 1] === host
        })(),
        frameChildren: siblings.length,
        template: frame.style.gridTemplateColumns || '',
        rect: (() => { const r = host.getBoundingClientRect(); return { x: Math.round(r.x), width: Math.round(r.width), height: Math.round(r.height) } })(),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        api: typeof window.__DSH_USAGE_DISPLAY,
      }
    })
    if (layout) break
    await page.waitForTimeout(750)
  }
  console.log('layout:', JSON.stringify(layout, null, 2))

  if (!layout) {
    console.error('FAIL: 面板未嵌入（AppFrame 未出现或注入失败）')
    await browser.close()
    process.exit(1)
  }

  // 布局断言
  const assertions = []
  assertions.push(['第 4 个 grid 子元素', layout.is4thChild])
  assertions.push(['grid 模板以 336px 轨道结尾', /336px\s*$/.test(layout.template)])
  assertions.push(['面板贴右缘', layout.rect.x + layout.rect.width >= layout.viewport.w - 8])
  assertions.push(['面板高度撑满', layout.rect.height >= layout.viewport.h - 4])
  assertions.push(['API 暴露', layout.api === 'object'])
  for (const [name, ok] of assertions) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (assertions.some(([, ok]) => !ok)) {
    await browser.close()
    process.exit(1)
  }

  // 等待数据渲染（会话投影到达后区段标题才会出现）
  let secTitleFound = false
  for (let i = 0; i < 12; i++) {
    secTitleFound = await page.evaluate(() => {
      const host = document.getElementById('dsh-usage-display-host')
      if (!host) return false
      return !!host.shadowRoot.querySelector('.dshu-sec-title')
    })
    if (secTitleFound) break
    await page.waitForTimeout(700)
  }
  console.log('sec title rendered:', secTitleFound)

  const panelInfo = await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    const shadow = host.shadowRoot
    const text = shadow.querySelector('.dshu-body').innerText
    const mainTabs = shadow.querySelector('.dshu-main-tabs')
    const foot = shadow.querySelector('.dshu-foot')
    const secTitle = shadow.querySelector('.dshu-sec-title')
    const secTitleStyle = secTitle ? getComputedStyle(secTitle) : null
    return {
      text: text.slice(0, 500),
      hasHead: !!shadow.querySelector('.dshu-head'),
      actionBtnCount: shadow.querySelectorAll('.dshu-main-actions .dshu-icon-btn').length,
      hasFoot: !!foot,
      footBorderTop: foot ? getComputedStyle(foot).borderTopWidth : null,
      bodyFromTop: getComputedStyle(shadow.querySelector('.dshu-body')).display !== 'flex',
      secTitleStyle: secTitleStyle ? { fs: secTitleStyle.fontSize, fw: secTitleStyle.fontWeight } : null,
      tabRowHeight: Math.round(mainTabs.getBoundingClientRect().height),
    }
  })
  console.log('panel metrics:', JSON.stringify(panelInfo))
  assertions.length = 0
  assertions.push(['头部条已移除', panelInfo.hasHead === false])
  assertions.push(['操作按钮并入 tab 行（⟳⚙✕ ×3）', panelInfo.actionBtnCount === 3])
  assertions.push(['底部状态行存在且无黑线', panelInfo.hasFoot === true && panelInfo.footBorderTop === '0px'])
  assertions.push(['内容从顶部排布（无垂直居中）', panelInfo.bodyFromTop === true])
  assertions.push(['区段标题为侧边栏式（14px/400）', panelInfo.secTitleStyle && panelInfo.secTitleStyle.fs === '14px' && panelInfo.secTitleStyle.fw === '400'])
  for (const [name, ok] of assertions) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (assertions.some(([, ok]) => !ok)) {
    await browser.close()
    process.exit(1)
  }

  // 主 tab 切换：[用量] → [文件] → [用量]
  const tabState = await page.evaluate(() => {
    const shadow = document.getElementById('dsh-usage-display-host').shadowRoot
    const clickTab = (label) => {
      const tabs = [...shadow.querySelectorAll('.dshu-main-tab')]
      const tab = tabs.find(t => t.textContent.trim() === label)
      if (!tab) return 'MISSING'
      tab.click()
      return 'clicked'
    }
    const out = {}
    out.usageTabExists = clickTab('用量') !== 'MISSING'
    out.filesTabExists = clickTab('文件') !== 'MISSING'
    // 切到文件
    clickTab('文件')
    const body = shadow.querySelector('.dshu-body')
    const filesView = shadow.querySelector('.dshu-files-view')
    out.filesVisible = filesView.style.display !== 'none' && filesView.offsetParent !== null
    out.usageHidden = body.style.display === 'none'
    out.filesHasContent = filesView.textContent.length > 0
    out.filesTabOn = [...shadow.querySelectorAll('.dshu-main-tab')].find(t => t.textContent.trim() === '文件').classList.contains('on')
    // 切回用量
    clickTab('用量')
    out.usageVisible = body.style.display !== 'none' && body.offsetParent !== null
    out.filesHidden = filesView.style.display === 'none'
    return out
  })
  console.log('main tabs:', JSON.stringify(tabState, null, 2))

  await page.screenshot({ path: join(__dirname, 'screenshot-panel.png') })
  console.log('screenshot saved: screenshot-panel.png')

  // 卸载验证：恢复 grid 模板 + 移除列
  const destroyed = await page.evaluate(() => {
    window.__DSH_USAGE_DISPLAY.destroy()
    const host = document.getElementById('dsh-usage-display-host')
    const frames = [...document.querySelectorAll('div')].filter(d =>
      d.style && typeof d.style.gridTemplateColumns === 'string' && d.style.gridTemplateColumns.includes('minmax(0, 1fr)'))
    const restored = frames.length === 0 || frames.every(f => !/336px\s*$/.test(f.style.gridTemplateColumns || ''))
    return { hostGone: host === null, restored }
  })
  console.log('destroy:', JSON.stringify(destroyed))
  const destroyOk = destroyed.hostGone && destroyed.restored
  console.log(`${destroyOk ? 'PASS' : 'FAIL'}  卸载恢复布局`)

  await browser.close()
  process.exit(tabState.filesTabExists && tabState.filesVisible && tabState.usageHidden && destroyOk ? 0 : 1)
}

main().catch((e) => { console.error('FAIL:', e); process.exit(1) })
