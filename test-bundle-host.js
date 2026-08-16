'use strict'

/**
 * 宿主半（lib/host.js）单元测试：信任栅栏、URL 白名单、头白名单、
 * apikey 凭证解析。用法：node test-bundle-host.js
 */
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')

const host = require('./lib/host.js')

/** 收集 apply 注册的路由，返回 { routes, disposers }。 */
function applyPlugin(services = {}) {
  const routes = []
  const disposers = []
  const ctx = {
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
    get: (name) => services[name],
    effect: (factory) => {
      const dispose = factory()
      disposers.push(dispose)
      return dispose
    },
  }
  host.apply(ctx)
  return { routes, disposers, ctx }
}

function makeRequest(method, headers) {
  const req = new EventEmitter()
  req.method = method
  req.headers = headers || {}
  req.destroy = () => {}
  return req
}

function makeResponse() {
  const res = {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }
  return res
}

async function invoke(route, req) {
  const res = makeResponse()
  await route.handler(req, res)
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null }
}

async function postJson(route, payload) {
  // Readable 流：handler 挂上 data/end 监听后事件自然触发（与真实 HTTP 一致）
  const req = Readable.from([Buffer.from(JSON.stringify(payload))])
  req.method = 'POST'
  req.headers = {
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    'content-type': 'application/json',
  }
  req.destroy = () => {}
  return invoke(route, req)
}

async function run() {
  const { routes } = applyPlugin()
  const byPath = Object.fromEntries(routes.map((r) => [r.path, r]))
  assert.equal(routes.length, 2, '应注册两个路由')
  assert.ok(byPath['/dshu/api/proxy'], '缺少 proxy 路由')
  assert.ok(byPath['/dshu/api/apikey'], '缺少 apikey 路由')

  // ---- 信任栅栏 ----
  const proxy = byPath['/dshu/api/proxy']

  let r = await invoke(proxy, makeRequest('POST', {}))
  assert.equal(r.status, 403, '缺 Host 头必须拒绝')

  r = await invoke(proxy, makeRequest('POST', { host: 'evil.example.com' }))
  assert.equal(r.status, 403, '非回环 Host 必须拒绝（防 DNS rebinding）')

  r = await invoke(proxy, makeRequest('POST', {
    host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site',
  }))
  assert.equal(r.status, 403, '跨站 fetch 标记必须拒绝')

  r = await invoke(proxy, makeRequest('POST', {
    host: '127.0.0.1:3080', origin: 'http://evil.example.com',
  }))
  assert.equal(r.status, 403, 'Origin 与 Host 不一致必须拒绝')

  r = await invoke(proxy, makeRequest('GET', { host: 'localhost:3080' }))
  assert.notEqual(r.status, 403, 'localhost 回环应放行（走到方法检查 405）')
  assert.equal(r.status, 405, 'proxy 路由对 GET 返回 405')

  // ---- URL 白名单 ----
  const originalFetch = globalThis.fetch
  const fetchCalls = []
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init })
    return { ok: true, status: 200, text: async () => '{"ok":true}' }
  }
  try {
    r = await postJson(proxy, { url: 'https://evil.com/steal', headers: {} })
    assert.equal(r.status, 403, '白名单外 URL 必须拒绝')
    assert.equal(fetchCalls.length, 0, '白名单外不得发起请求')

    r = await postJson(proxy, { url: 'http://api.deepseek.com/user/balance', headers: {} })
    assert.equal(r.status, 403, '非 https 必须拒绝')

    r = await postJson(proxy, { url: 'https://api.deepseek.com/other', headers: {} })
    assert.equal(r.status, 403, '白名单外路径必须拒绝')

    r = await postJson(proxy, {
      url: 'https://api.deepseek.com/user/balance?x=1',
      method: 'GET',
      headers: { Authorization: 'Bearer sk-test', Accept: 'application/json', Cookie: 'evil=1' },
    })
    assert.equal(r.status, 200, '白名单 URL 应转发')
    assert.equal(fetchCalls.length, 1, '恰好一次转发')
    assert.equal(fetchCalls[0].url, 'https://api.deepseek.com/user/balance?x=1', '原样转发 URL（含 query）')
    assert.deepEqual(fetchCalls[0].init.headers, {
      authorization: 'Bearer sk-test',
      accept: 'application/json',
    }, '只透传 authorization/accept，丢弃 Cookie 等')
    assert.deepEqual(r.json, { ok: true, status: 200, body: '{"ok":true}' })

    r = await postJson(proxy, {
      url: 'https://api.deepseek.com/user/balance',
      headers: { Authorization: 'Basic abc' },
    })
    assert.equal(fetchCalls.length, 2, '仍会转发请求')
    assert.deepEqual(fetchCalls[1].init.headers, {}, '非 Bearer 授权头被丢弃不透传')

    // 平台用量路径
    r = await postJson(proxy, {
      url: 'https://platform.deepseek.com/api/v0/usage/amount?month=8&year=2026',
      headers: { authorization: 'Bearer sk-x' },
    })
    assert.equal(r.status, 200, '平台用量路径应放行')
    assert.equal(fetchCalls.length, 3, '第三次转发（前两次：正常转发 + Basic 头丢弃转发）')

    // 上游失败 → 502 语义
    globalThis.fetch = async () => { throw new Error('network down') }
    r = await postJson(proxy, {
      url: 'https://api.deepseek.com/user/balance', headers: {},
    })
    assert.equal(r.status, 502, '上游异常应返回 502')
    assert.equal(r.json.ok, false)
  } finally {
    globalThis.fetch = originalFetch
  }

  // ---- apikey ----
  const apikey = byPath['/dshu/api/apikey']

  r = await invoke(apikey, makeRequest('POST', { host: '127.0.0.1:3080' }))
  assert.equal(r.status, 405, 'apikey 只允许 GET')

  {
    const { routes: routes2 } = applyPlugin({
      credentials: {
        resolve: async () => ({ value: 'sk-real', source: 'file' }),
      },
    })
    r = await invoke(routes2.find((x) => x.path === '/dshu/api/apikey'), makeRequest('GET', { host: '127.0.0.1:3080' }))
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { apiKey: 'sk-real', source: 'file' })
  }

  {
    const { routes: routes3 } = applyPlugin({})
    r = await invoke(routes3.find((x) => x.path === '/dshu/api/apikey'), makeRequest('GET', { host: '127.0.0.1:3080' }))
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { apiKey: null, source: null }, '无凭证服务时降级为 null')
  }

  console.log('Host half (lib/host.js) smoke test passed.')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
