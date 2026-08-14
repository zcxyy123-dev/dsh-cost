/**
 * DSH 用量显示 — content script
 * 1. 注入 bridge.js（页面世界桥）→ 2. 注入 usage-display.js（核心，自挂载面板）。
 * 并监听页面世界的 'dshu:official:req' 事件，转发给 background 代理后回发结果。
 */
(() => {
  const RESOURCES = ['bridge.js', 'usage-display.js']
  const HOST_ID = 'dsh-usage-display-host'

  let injected = false

  function injectScript(src, onload) {
    const script = document.createElement('script')
    script.src = chrome.runtime.getURL(src)
    script.onload = () => { script.remove(); if (onload) onload() }
    script.onerror = () => console.error('[DSH 用量显示] 加载失败:', src)
    ;(document.head || document.documentElement).appendChild(script)
  }

  function inject() {
    if (injected) return
    if (document.getElementById(HOST_ID)) return // 已存在面板（手动注入过）
    // 先桥后核心：核心的 officialFetch 会检测 window.__dshuBridgeFetch
    injectScript(RESOURCES[0], () => injectScript(RESOURCES[1]))
    injected = true
  }

  // 官方请求桥：页面世界 → 这里 → background → 回发
  window.addEventListener('dshu:official:req', (event) => {
    const detail = event.detail
    if (!detail || typeof detail.id !== 'string' || typeof detail.url !== 'string') return
    chrome.runtime.sendMessage({ type: 'dshu:official', url: detail.url, init: detail.init || {} })
      .then((result) => {
        window.dispatchEvent(new CustomEvent('dshu:official:res', { detail: { id: detail.id, result } }))
      })
      .catch((error) => {
        window.dispatchEvent(new CustomEvent('dshu:official:res', {
          detail: { id: detail.id, result: { error: String(error && error.message ? error.message : error) } },
        }))
      })
  })

  function tryInject() {
    if (document.body || document.documentElement) {
      inject()
      return
    }
    setTimeout(tryInject, 300)
  }

  tryInject()
})()
