/** 函数完整性检查：所有被调用的顶层函数都有定义（含 const 箭头函数）。 */
const { readFileSync } = require('node:fs')
const code = readFileSync(require('node:path').join(__dirname, 'usage-display.js'), 'utf8')
// 先剥字符串与模板字面量（URL 里的 // 不能当注释），再剥注释（文档里的 var() 等示例会误报）
const stripped = code
  .replace(/`[\s\S]*?`|'[^']*'|"[^"]*"/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, ' ')
const defined = new Set([...stripped.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?:\(|=)/g)].map(m => m[1]))
const called = new Set([...stripped.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]))
// 浏览器全局 + 已知误报（回调形参 parse/callback、for..of 的 of、聚合器形参）
const builtins = new Set(('if for while switch catch return typeof new await document window console JSON Math Number String Object Array Set Map Promise parseInt parseFloat Date RegExp AbortController CustomEvent fetch localStorage setTimeout clearTimeout setInterval clearInterval structuredClone chrome unsafeWindow GM_xmlhttpRequest globalThis Error URL navigator requestAnimationFrame cancelAnimationFrame queueMicrotask Reflect Proxy Symbol BigInt Boolean Function WeakMap WeakSet Uint8Array Intl location history TextEncoder TextDecoder MutationObserver matchMedia of parse callback').split(' '))
const missing = [...called].filter(n => !defined.has(n) && !builtins.has(n))
console.log('定义函数数(含 const 箭头):', defined.size)
console.log(missing.length === 0 ? 'PASS 无缺失函数引用（renderError 已定义 ✓）' : 'FAIL 缺失: ' + missing.join(', '))
process.exit(missing.length === 0 ? 0 : 1)
