/**
 * DSH 用量显示 — MV3 background service worker
 * 官方 API 转发代理：页面直连被 CORS 拦截的端点（platform.deepseek.com）由此转发。
 * host_permissions 已授予 api.deepseek.com / platform.deepseek.com。
 * 凭证（API Key / userToken）只存在于页面 localStorage，绝不进入扩展存储或日志。
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'dshu:official') return undefined
  const { url, init } = message
  const headers = (init && init.headers) || {}
  fetch(url, {
    method: (init && init.method) || 'GET',
    headers,
    body: (init && init.body) || undefined,
  })
    .then(async (r) => {
      sendResponse({ ok: r.ok, status: r.status, body: await r.text() })
    })
    .catch((e) => {
      sendResponse({ ok: false, status: 0, body: '', error: String(e && e.message ? e.message : e) })
    })
  return true // 异步 sendResponse
})
