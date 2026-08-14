/**
 * 用量显示 · DSH 插件构建脚本
 * 读取 host-half.js / client-half.js，生成可分享的 usage-display.plugin.json。
 * 该 JSON 的 code.host / code.client 就是 cordis_define 需要的字符串。
 * 用法：node dsh-plugin/build-plugin.js
 */
const fs = require('node:fs')
const path = require('node:path')

const dir = __dirname
const host = fs.readFileSync(path.join(dir, 'host-half.js'), 'utf8')
const client = fs.readFileSync(path.join(dir, 'client-half.js'), 'utf8')

const plugin = {
  name: '用量显示',
  purpose: '在 DSH Web GUI 右下角悬浮显示当前会话用量：上下文占用、缓存命中率、费用估算、请求数、tokens 明细、按来源/类型分析、工作区文件浏览，以及官方余额/平台费用（凭证仅本次会话有效）。',
  code: { host, client },
}

const out = path.join(dir, 'usage-display.plugin.json')
fs.writeFileSync(out, JSON.stringify(plugin, null, 2), 'utf8')
console.log(`written ${out} (host ${host.length} B, client ${client.length} B)`)
