'use strict'

/** Exercises the narrow Host RPC contract used by the generated client. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, 'host-half.js'), 'utf8')
const handlers = new Map()
const harness = { handle: (name, handler) => handlers.set(name, handler) }

const rootEvents = [
  { seq: 0, type: 'user/message', data: { turn: 1 } },
  { seq: 1, type: 'assistant/message', data: { turn: 1, usage: { inputTokens: 10, outputTokens: 3 } } },
]
const ctx = {
  get(name) {
    if (name === 'sessionQuery') {
      return {
        listSessions: async () => [{ header: { id: 'root', cwd: 'D:/work', updatedAt: 100 } }],
        readSession: async (sessionId) => ({ session: { id: sessionId }, events: sessionId === 'root' ? rootEvents : [] }),
        listEvents: async () => [],
      }
    }
    if (name === 'sessionProjectionCache') {
      return { coldSnapshot: async (sessionId) => ({ values: { tokenUsage: { outputTokens: sessionId === 'child' ? 7 : 3 } } }) }
    }
    if (name === 'subagents') {
      return { listChildren: async (sessionId) => sessionId === 'root'
        ? [{ kind: 'child', id: 'child', mode: 'one-shot', label: 'worker' }]
        : [] }
    }
    return undefined
  },
}

async function run() {
  const plugin = new Function('ctx', 'harness', source)(ctx, harness)
  assert.equal(typeof plugin.apply, 'function')
  plugin.apply(ctx)

  const list = await handlers.get('session.list')({})
  assert.deepEqual(list.items, [{ sessionId: 'root', cwd: 'D:/work', updatedAt: 100 }])

  const history = await handlers.get('session.history')({ sessionId: 'root', maxMessages: 1 })
  assert.equal(history.events.length, 1)
  assert.equal(history.events[0].event.seq, 1)
  assert.equal(history.projections.values.tokenUsage.outputTokens, 3)

  const children = await handlers.get('subagent.list')({ parentSessionId: 'root' })
  assert.deepEqual(children.entries, [{ sessionId: 'child', mode: 'one-shot', label: 'worker' }])

  const child = await handlers.get('subagent.history')({ parentSessionId: 'root', childSessionId: 'child' })
  assert.deepEqual(child.events, [])
  assert.equal(child.projections.values.tokenUsage.outputTokens, 7)
  console.log('Host RPC contract smoke test passed.')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
