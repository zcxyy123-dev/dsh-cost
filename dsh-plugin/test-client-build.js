'use strict'

/**
 * Smoke test for the generated dynamic browser half. It evaluates the same
 * closure shape used by the Cordis runner while the forbidden globals throw.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const clientPath = path.join(__dirname, 'client-half.js')
const client = fs.readFileSync(clientPath, 'utf8')
const parameterNames = [
  'React', 'console', 'styles', 'host', 'harness',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'require', 'process', 'Buffer',
]

function forbidden(name) {
  return () => { throw new Error(`${name} escaped the dynamic wrapper`) }
}

async function run() {
  const originalDocument = globalThis.document
  const originalStorage = globalThis.localStorage
  delete globalThis.__DSH_USAGE_DISPLAY
  globalThis.document = undefined
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

  const cleanups = []
  const ctx = {
    timeout: () => () => {},
    interval: () => () => {},
    effect(factory) {
      const cleanup = factory()
      cleanups.push(cleanup)
      return cleanup
    },
    get: () => undefined,
  }
  const closure = new Function(...parameterNames, `return (async () => {\n${client}\n})()`)

  try {
    const plugin = await closure(
      {}, console, { insert: () => () => {} }, { call: async () => ({}) }, {},
      forbidden('setTimeout'), forbidden('setInterval'), forbidden('clearTimeout'), forbidden('clearInterval'),
      forbidden('fetch'), forbidden('require'), undefined, undefined,
    )
    assert.deepEqual(plugin.inject, ['timer'])
    assert.equal(typeof plugin.apply, 'function')
    plugin.apply(ctx)
    assert.ok(globalThis.__DSH_USAGE_DISPLAY, 'core API should initialize inside the dynamic wrapper')
    assert.equal(cleanups.length, 1, 'wrapper should register one lifecycle cleanup')
    cleanups[0]()
    assert.equal(globalThis.__DSH_USAGE_DISPLAY, undefined, 'cleanup should remove the debug API it created')
    console.log('Dynamic client wrapper smoke test passed.')
  } finally {
    if (originalDocument === undefined) delete globalThis.document
    else globalThis.document = originalDocument
    if (originalStorage === undefined) delete globalThis.localStorage
    else globalThis.localStorage = originalStorage
    delete globalThis.__DSH_USAGE_DISPLAY
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
