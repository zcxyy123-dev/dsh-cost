/**
 * 工作区文件 E2E：真实 GUI 页面验证
 *   1. 文件区块渲染 + 会话 cwd 显示
 *   2. 目录树顶层条目（桥 /tree）
 *   3. 展开子目录（懒加载）
 *   4. 点击文件预览内容（桥 /file）
 *   5. host.openPath 通道（用不存在的路径断言返回错误，避免真实弹窗）
 * 运行：先 node setup-key.js 起桥，再 node browser-e2e-files.js
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
  // 当前会话 cwd = 本工具目录（含 usage-display.js / README.md / extension 等）
  await page.addScriptTag({ content: CORE })
  await page.waitForTimeout(6000)

  const bodyText = () => page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    return host ? host.shadowRoot.querySelector('.dshu-body').innerText : ''
  })

  // 1. 文件区块
  let text = await bodyText()
  console.log('文件区块存在:', text.includes('工作区文件') ? 'PASS' : 'FAIL')
  console.log('cwd 显示:', text.includes('用量显示') ? 'PASS' : 'FAIL', '—', text.split('\n').find(l => l.includes('用量显示')))

  // 2. 目录树顶层（等桥加载）
  await page.waitForTimeout(3000)
  text = await bodyText()
  const hasRootFiles = text.includes('usage-display.js') || text.includes('README.md') || text.includes('extension')
  console.log('目录树顶层条目:', hasRootFiles ? 'PASS' : 'FAIL')
  console.log('  →', text.split('\n').filter(l => /📁|📄/.test(l)).slice(0, 8).join(' | '))

  // 3. 展开 extension 目录
  await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    const shadow = host.shadowRoot
    const rows = [...shadow.querySelectorAll('.dshu-file-row')]
    const ext = rows.find(r => r.textContent.includes('extension'))
    if (ext) ext.click()
  })
  await page.waitForTimeout(2500)
  text = await bodyText()
  console.log('展开 extension:', text.includes('manifest.json') ? 'PASS' : 'FAIL')

  // 4. 点击 manifest.json 预览
  await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    const shadow = host.shadowRoot
    const rows = [...shadow.querySelectorAll('.dshu-file-row')]
    const mf = rows.find(r => r.textContent.includes('manifest.json'))
    if (mf) mf.click()
  })
  await page.waitForTimeout(2500)
  const preview = await page.evaluate(() => {
    const host = document.getElementById('dsh-usage-display-host')
    const shadow = host.shadowRoot
    const info = shadow.querySelector('.dshu-preview-info')
    const code = shadow.querySelector('.dshu-preview-code')
    return { info: info ? info.textContent : null, code: code ? code.textContent.slice(0, 80) : null }
  })
  console.log('预览信息:', preview.info ? 'PASS: ' + preview.info : 'FAIL')
  console.log('预览内容:', preview.code && preview.code.includes('manifest_version') ? 'PASS' : `FAIL (${preview.code})`)

  // 5. openPath 通道（不存在路径 → 错误返回，证明 RPC 通道通）
  const openPathProbe = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/host.openPath', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'open-probe', method: 'host.openPath', payload: { path: 'D:\\\\__dshu_no_such__' } }),
      })
      const j = await r.json()
      return j.result.ok ? 'UNEXPECTED-OK' : 'PASS:' + j.result.error.code
    } catch (e) { return 'FAIL:' + e.message }
  })
  console.log('openPath 通道:', openPathProbe)

  await page.screenshot({ path: join(__dirname, 'screenshot-files.png') })
  console.log('未捕获异常:', pageErrors.length === 0 ? 'PASS' : 'FAIL: ' + pageErrors.join(' | '))
  await browser.close()
  process.exit(hasRootFiles && pageErrors.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
