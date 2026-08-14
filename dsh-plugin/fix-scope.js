// 修复 client-half.js：从 usage-display.plugin.json 恢复原始内容，然后：
// 1) 把 styles.insert 里的全部 CSS 选择器作用域化到 .dshu-root 下（防止污染整个页面）；
// 2) 给面板最外层包装 div 加上 .dshu-root 类。
const fs = require('node:fs')
const path = require('node:path')

const dir = __dirname
const jsonPath = path.join(dir, 'usage-display.plugin.json')
const clientPath = path.join(dir, 'client-half.js')

const plugin = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
let js = plugin.code.client

// ---- 1) CSS 作用域化 ----
const marker = 'styles.insert(`'
const start = js.indexOf(marker) + marker.length
const end = js.indexOf('`)', start)
if (start < 0 || end < 0) {
  console.error('styles.insert template not found')
  process.exit(1)
}
const css = js.slice(start, end)
const rules = css.split('}')
const scoped = rules.map((rule) => {
  const idx = rule.indexOf('{')
  if (idx < 0) return rule
  const sel = rule.slice(0, idx).trim()
  const body = rule.slice(idx)
  if (!sel) return rule
  const sels = sel.split(',').map((s) => s.trim()).filter(Boolean)
  const prefixed = sels.map((s) => (s.startsWith('.dshu-root') ? s : `.dshu-root ${s}`)).join(', ')
  return `${prefixed}${body}`
}).join('}')
js = js.slice(0, start) + scoped + js.slice(end)

// ---- 2) 外层包装加 .dshu-root ----
js = js.replace(
  "return el('div', { style: panelStyle },\n        el('div', { className: 'dshu-panel' }",
  "return el('div', { className: 'dshu-root', style: panelStyle },\n        el('div', { className: 'dshu-panel' }",
)

fs.writeFileSync(clientPath, js, 'utf8')
console.log(`client-half.js restored + scoped (${js.length} B)`)
