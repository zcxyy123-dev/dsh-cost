'use strict'

/**
 * 校验 DSH bundle 插件包的结构与产物一致性。
 * 用法：node verify-bundle.js
 *
 * 检查项：
 *   1. package.json 声明 dsh.bundle（patch 存在）、dsh.client（platform=web）、
 *      exports["./client"] 指向已存在的 bundle、main 指向已存在的宿主模块；
 *   2. cordis.patch.yml 插入的条目名 = package.json 的 name；
 *   3. client/bundle.js 与当前 usage-display.js 重新生成的结果一致（防陈旧产物）；
 *   4. client/bundle.js 语法可解析、注册的 id 与包名一致；
 *   5. lib/host.js 语法可解析且导出 { name, inject, apply } 插件形状。
 */
const fs = require('node:fs')
const path = require('node:path')
const { buildBundle, corePath, bundlePath } = require('./build-bundle')

const root = __dirname
const failures = []
const check = (name, passed, detail) => {
  if (!passed) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}`)
}

let manifest
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  check('package.json 可解析', true)
} catch (error) {
  check('package.json 可解析', false, error.message)
  process.exit(1)
}

const PACKAGE_ID = manifest.name

// 1. package.json 契约
check('dsh.bundle.patch 声明存在', Boolean(manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch))
if (manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch) {
  check('dsh.bundle.patch 文件存在', fs.existsSync(path.join(root, manifest.dsh.bundle.patch)))
}
check('dsh.client.platform = web', Boolean(manifest.dsh && manifest.dsh.client && manifest.dsh.client.platform === 'web'))
check('exports["./client"] 存在', Boolean(manifest.exports && manifest.exports['./client']))
if (manifest.exports && manifest.exports['./client']) {
  check('client bundle 文件存在', fs.existsSync(path.join(root, manifest.exports['./client'])))
}
check('main 存在且指向宿主模块', Boolean(manifest.main) && fs.existsSync(path.join(root, manifest.main)))

// 2. patch 契约
const patchText = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
check('cordis.patch.yml 引用包名', patchText.includes(`name: ${PACKAGE_ID}`))

// 3. bundle 产物一致性
const bundleText = fs.readFileSync(bundlePath, 'utf8')
check('client/bundle.js 与核心一致（重新生成后无差异）', bundleText === buildBundle())

// 4. bundle 语法与注册 id
try {
  // eslint-disable-next-line no-new-func
  new Function(bundleText)
  check('client/bundle.js 语法可解析', true)
} catch (error) {
  check('client/bundle.js 语法可解析', false, error.message)
}
check('bundle 注册的 id = 包名', bundleText.includes(`const PACKAGE_ID = ${JSON.stringify(PACKAGE_ID)}`) && bundleText.includes('id: PACKAGE_ID'))
check('bundle 使用 __ModuleLoader__.load', bundleText.includes('__ModuleLoader__.load'))

// 5. 宿主模块形状
let host
try {
  host = require(path.join(root, 'lib', 'host.js'))
  check('lib/host.js 可加载', true)
} catch (error) {
  check('lib/host.js 可加载', false, error.message)
}
if (host) {
  check('宿主导出 name', host.name === PACKAGE_ID)
  check('宿主声明 inject 含 webServer', Array.isArray(host.inject) && host.inject.includes('webServer'))
  check('宿主导出 apply 函数', typeof host.apply === 'function')
}

if (failures.length > 0) {
  console.error(`\nbundle verification failed:\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  console.error('Run node build-bundle.js after changing usage-display.js, then verify again.')
  process.exit(1)
}
console.log('\nBundle verification passed.')
console.log(`Package: ${PACKAGE_ID} v${manifest.version}`)
console.log(`Core SHA-256: ${require('node:crypto').createHash('sha256').update(fs.readFileSync(corePath, 'utf8')).digest('hex')}`)
