/**
 * 用量显示 · DSH 插件构建脚本
 * 读取 host-half.js / client-half.js，生成可分享的 usage-display.plugin.json。
 * 该 JSON 的 code.host / code.client 就是 cordis_define 需要的字符串。
 * 用法：node dsh-plugin/build-plugin.js
 */
const fs = require('node:fs')
const path = require('node:path')
const { writeClient } = require('./build-client')
const release = require('./release')

const dir = __dirname
writeClient()
const host = fs.readFileSync(path.join(dir, 'host-half.js'), 'utf8')
const client = fs.readFileSync(path.join(dir, 'client-half.js'), 'utf8')

const plugin = {
  version: release.version,
  release: `${release.channel} / ${release.id}`,
  name: release.name,
  purpose: release.purpose,
  code: { host, client },
}

const out = path.join(dir, 'usage-display.plugin.json')
fs.writeFileSync(out, JSON.stringify(plugin, null, 2), 'utf8')
console.log(`written ${out} (host ${host.length} B, client ${client.length} B)`)
