'use strict'

/**
 * Verifies that the checked-in deployment bundle was generated from the
 * readable Host/Client sources and still describes the supported UI shape.
 * Usage: node dsh-plugin/verify-plugin.js
 *
 * Line endings: the manifest embeds code strings with \n escapes while a
 * Windows checkout may hold CRLF files. All comparisons normalize CRLF to LF
 * so the check passes identically on any platform / checkout mode.
 */
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { buildClient, corePath } = require('./build-client')
const release = require('./release')
const dir = __dirname
const files = {
  host: path.join(dir, 'host-half.js'),
  client: path.join(dir, 'client-half.js'),
  manifest: path.join(dir, 'usage-display.plugin.json'),
}

const norm = (text) => String(text).replace(/\r\n/g, '\n')
const readText = (file) => norm(fs.readFileSync(file, 'utf8'))

const host = readText(files.host)
const client = readText(files.client)
const core = readText(corePath)
let manifest

try {
  manifest = JSON.parse(readText(files.manifest))
} catch (error) {
  console.error(`Invalid plugin JSON: ${error.message}`)
  process.exit(1)
}

const manifestHost = manifest.code ? norm(manifest.code.host) : undefined
const manifestClient = manifest.code ? norm(manifest.code.client) : undefined

const checks = [
  ['manifest version', manifest.version === release.version],
  ['manifest release marker', manifest.release === `${release.channel} / ${release.id}`],
  ['manifest name', manifest.name === release.name],
  ['manifest purpose', manifest.purpose === release.purpose],
  ['Host source matches manifest', manifestHost === host],
  ['Client source matches manifest', manifestClient === client],
  ['Client is generated from usage-display.js', client === buildClient(core)],
  ['Client injects the Cordis timer service', client.includes("inject: ['timer']")],
  ['Client uses supported Host RPC', client.includes('const __dshuHost') && client.includes('host.call(method, payload)')],
  ['Client cleans up through the Cordis lifecycle', client.includes("'usage-display.cleanup'")],
  ['Host exposes session history RPC', host.includes("harness.handle('session.history'")],
  ['Host exposes subagent RPC', host.includes("harness.handle('subagent.list'") && host.includes("harness.handle('subagent.history'")],
  ['New fourth-column layout is present', client.includes('const COL_WIDTH = 336') && client.includes('gridTemplateColumns')],
  ['New usage/files tabs are present', client.includes("'用量'") && client.includes("'文件'")],
  ['Loading overlay is present', client.includes('dshu-loading')],
  ['Turn usage annotations are present', client.includes('dshu-msg-usage')],
  ['Legacy details-sidebar client was not packaged', !client.includes("slots.inject('details'") && !client.includes('layout?.openDetails()')],
]

try {
  new Function('ctx', 'harness', `return (async () => {\n${host}\n})()`)
  new Function(
    'React', 'console', 'styles', 'host', 'harness',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'require', 'process', 'Buffer',
    `return (async () => {\n${client}\n})()`,
  )
  checks.push(['Host and Client source parses as dynamic closures', true])
} catch (error) {
  checks.push(['Host and Client source parses as dynamic closures', false])
  console.error(`Dynamic closure syntax error: ${error.message}`)
}

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name)
if (failures.length > 0) {
  console.error(`Plugin verification failed: ${failures.join(', ')}`)
  console.error('Run node dsh-plugin/build-plugin.js after changing either half, then verify again.')
  process.exit(1)
}

const digest = (text) => crypto.createHash('sha256').update(text).digest('hex')
// The manifest digest is computed from LF-normalized code strings so a
// Windows CRLF checkout reports the exact same identity as a Unix one.
const manifestForDigest = { ...manifest, code: { host: manifestHost, client: manifestClient } }
console.log('Plugin verification passed.')
console.log(`Version: ${release.version}`)
console.log(`Release: ${release.channel} / ${release.id}`)
console.log('Expected UI: fourth right-side grid column with 用量 / 文件 tabs (not details sidebar or floating window).')
console.log(`Host SHA-256: ${digest(host)}`)
console.log(`Client SHA-256: ${digest(client)}`)
console.log(`Manifest SHA-256: ${digest(JSON.stringify(manifestForDigest))}`)
