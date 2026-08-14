/**
 * DSH 用量显示 — 页面世界桥（由 content.js 注入）
 * 定义 window.__dshuBridgeFetch：把官方 API 请求通过 CustomEvent 协议交给
 * content script → background service worker 转发（绕过页面 CORS）。
 * 协议：
 *   页面世界 dispatch  'dshu:official:req'  { id, url, init }
 *   content script 回发 'dshu:official:res'  { id, result }
 */
(() => {
  if (typeof window === 'undefined' || window.__dshuBridgeFetch) return

  window.__dshuBridgeFetch = (url, init) =>
    new Promise((resolve, reject) => {
      const id = `dshu-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const timeout = setTimeout(() => {
        window.removeEventListener('dshu:official:res', handler)
        reject(new Error('bridge timeout'))
      }, 15000)
      const handler = (event) => {
        const detail = event.detail
        if (!detail || detail.id !== id) return
        clearTimeout(timeout)
        window.removeEventListener('dshu:official:res', handler)
        if (detail.result && detail.result.error) reject(new Error(detail.result.error))
        else resolve(detail.result)
      }
      window.addEventListener('dshu:official:res', handler)
      window.dispatchEvent(new CustomEvent('dshu:official:req', {
        detail: { id, url, init: { method: (init && init.method) || 'GET', headers: (init && init.headers) || {}, body: (init && init.body) || undefined } },
      }))
    })
})()
