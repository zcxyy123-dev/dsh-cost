'use strict'

/**
 * Produces the Cordis browser half from the canonical standalone core.
 *
 * The core retains its browser implementation for the userscript, extension,
 * and console artifacts. This wrapper supplies the dynamic-package transport
 * and lifecycle adapters without reaching around Cordis's guarded globals.
 */
const fs = require('node:fs')
const path = require('node:path')

const pluginDir = __dirname
const corePath = path.join(pluginDir, '..', 'usage-display.js')
const clientPath = path.join(pluginDir, 'client-half.js')

const prelude = String.raw`/**
 * GENERATED FILE. Do not edit directly.
 * Source: ../usage-display.js + build-client.js
 * Regenerate: node dsh-plugin/build-client.js
 *
 * This dynamic client deliberately uses only host.call and the injected
 * Cordis timer service. It never reaches the browser's guarded fetch or
 * timer globals.
 */
return {
  inject: ['timer'],
  apply(ctx) {
    const timerDisposers = new Map()
    let nextTimerId = 0

    function reportAsyncError(error) {
      console.error('[usage-display] scheduled callback failed', error)
    }

    function runCallback(callback) {
      try {
        const result = callback()
        if (result && typeof result.catch === 'function') result.catch(reportAsyncError)
      } catch (error) {
        reportAsyncError(error)
      }
    }

    function setTimeout(callback, delay) {
      const id = ++nextTimerId
      const dispose = ctx.timeout(() => {
        timerDisposers.delete(id)
        runCallback(callback)
      }, Math.max(0, Number(delay) || 0))
      timerDisposers.set(id, dispose)
      return id
    }

    function clearTimeout(id) {
      const dispose = timerDisposers.get(id)
      timerDisposers.delete(id)
      if (typeof dispose === 'function') dispose()
    }

    function setInterval(callback, delay) {
      const id = ++nextTimerId
      const dispose = ctx.interval(() => runCallback(callback), Math.max(0, Number(delay) || 0))
      timerDisposers.set(id, dispose)
      return id
    }

    function clearInterval(id) {
      clearTimeout(id)
    }

    const __dshuHost = Object.freeze({
      call(method, payload) {
        return host.call(method, payload)
      },
      openPath(targetPath) {
        const workspaces = ctx.get('workspaces')
        if (!workspaces || typeof workspaces.openPath !== 'function') {
          return Promise.reject(new Error('The DSH workspaces service cannot open paths in this client.'))
        }
        return workspaces.openPath(targetPath)
      },
    })

    // Every dynamic path selects __dshuHost before its standalone fallback.
    // This binding exists only to keep an accidental fallback from escaping
    // the Cordis runner's network boundary.
    const fetch = () => Promise.reject(new Error('Dynamic usage display must use host.call instead of fetch.'))

`

const postlude = String.raw`

    ctx.effect(() => () => {
      for (const dispose of timerDisposers.values()) {
        try { if (typeof dispose === 'function') dispose() } catch { /* already disposed */ }
      }
      timerDisposers.clear()
      try { api.destroy() } catch (error) { console.error('[usage-display] cleanup failed', error) }
      try {
        if (globalThis.__DSH_USAGE_DISPLAY === api) delete globalThis.__DSH_USAGE_DISPLAY
      } catch { /* debug API cleanup is best effort */ }
    }, 'usage-display.cleanup')
  },
}
`

function buildClient(core) {
  if (typeof core !== 'string' || core.length === 0) throw new Error('usage-display.js is empty')
  return `${prelude}${core}${postlude}`
}

function writeClient({ corePath: source = corePath, clientPath: output = clientPath } = {}) {
  const core = fs.readFileSync(source, 'utf8')
  const client = buildClient(core)
  fs.writeFileSync(output, client, 'utf8')
  return { core, client, output }
}

if (require.main === module) {
  const { core, client, output } = writeClient()
  console.log(`written ${output} (core ${core.length} B, client ${client.length} B)`)
}

module.exports = { buildClient, writeClient, corePath, clientPath }
