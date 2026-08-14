// 把 client-half.js 里 styles.insert 的 CSS 重排为"每条规则独立行"，便于阅读/复刻。
const fs = require('node:fs')
const path = require('node:path')

const dir = __dirname
const clientPath = path.join(dir, 'client-half.js')
let js = fs.readFileSync(clientPath, 'utf8')

const marker = 'styles.insert(`'
const start = js.indexOf(marker) + marker.length
const end = js.indexOf('`)', start)
const css = js.slice(start, end)

const rules = css.split('}').filter((r) => r.trim().length > 0)
const pretty = rules.map((rule) => {
  const idx = rule.indexOf('{')
  const sel = rule.slice(0, idx).trim()
  const body = rule.slice(idx + 1).trim()
  const decls = body.split(';').map((d) => d.trim()).filter(Boolean)
  return `${sel} {\n  ${decls.join(';\n  ')};\n}`
}).join('\n')

js = js.slice(0, start) + pretty + js.slice(end)
fs.writeFileSync(clientPath, js, 'utf8')

// 校验：所有行都短于 2000 字符
let maxLen = 0
for (const line of js.split('\n')) maxLen = Math.max(maxLen, line.length)
console.log(`reformatted; max line length = ${maxLen}`)
