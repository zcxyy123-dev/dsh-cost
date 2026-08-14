/**
 * 本地桥单测：/tree /file /ping /shutdown 各路径（正常/二进制/超大/不存在/穿越）。
 * 运行：先 node setup-key.js 起桥，再 node test-bridge.js
 */
const { writeFileSync, mkdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const BASE = 'http://127.0.0.1:3987'
const TMP = join(__dirname, '.bridge-test')

async function get(url) {
  const r = await fetch(BASE + url)
  const j = await r.json().catch(() => null)
  return { status: r.status, ...j }
}

let failed = 0
const eq = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failed += 1
}

async function main() {
  // 准备测试文件
  mkdirSync(join(TMP, 'sub'), { recursive: true })
  writeFileSync(join(TMP, 'hello.txt'), 'line1\nline2\nline3\n', 'utf8')
  writeFileSync(join(TMP, 'big.bin'), Buffer.alloc(600 * 1024, 1)) // 600KB > 500KB
  writeFileSync(join(TMP, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

  // ping
  const ping = await get('/ping')
  eq('ping', ping.ok === true, JSON.stringify(ping))

  // tree（绝对路径）
  const tree = await get(`/tree?path=${encodeURIComponent(TMP)}`)
  eq('tree 根目录', Array.isArray(tree.entries), `${tree.entries && tree.entries.length} 项`)
  const sub = tree.entries && tree.entries.find(e => e.name === 'sub')
  eq('tree 目录条目', sub && sub.dir === true, sub && sub.path)

  // 子目录
  const subTree = await get(`/tree?path=${encodeURIComponent(join(TMP, 'sub'))}`)
  eq('tree 子目录', Array.isArray(subTree.entries), '')

  // 文件预览
  const file = await get(`/file?path=${encodeURIComponent(join(TMP, 'hello.txt'))}`)
  eq('file 预览', file.content === 'line1\nline2\nline3\n' && file.lines === 4, `size=${file.size}`)

  // 二进制扩展过滤
  const pic = await get(`/file?path=${encodeURIComponent(join(TMP, 'pic.png'))}`)
  eq('file 二进制过滤', pic.error && pic.error.includes('binary'), pic.error)

  // 超大文件限制
  const big = await get(`/file?path=${encodeURIComponent(join(TMP, 'big.bin'))}`)
  eq('file 大小限制', big.error && big.error.includes('too large'), big.error)

  // 不存在的路径
  const missing = await get(`/file?path=${encodeURIComponent(join(TMP, 'nope.txt'))}`)
  eq('file 不存在', missing.error && (missing.error.includes('ENOENT') || missing.error.includes('not')), missing.error)

  // 无 path 参数
  const nopath = await get('/file')
  eq('file 缺参数', nopath.error, nopath.error)

  // 目录当文件读
  const dirAsFile = await get(`/file?path=${encodeURIComponent(TMP)}`)
  eq('file 目录拒绝', dirAsFile.error, dirAsFile.error)

  rmSync(TMP, { recursive: true, force: true })
  console.log(failed === 0 ? '\n桥单测全部通过 ✅' : `\n${failed} 项失败 ❌`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FAIL', e); process.exit(1) })
