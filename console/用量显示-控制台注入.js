/* =====================================================================
 * DSH 用量显示 v2.0.0 — 控制台注入版
 * =====================================================================
 * 用法：打开 DeepSeek Harness Web GUI（http://127.0.0.1:3080），按 F12
 * 打开开发者工具，把本文件全部内容粘贴到 Console 回车即可。
 * 卸载：执行 __DSH_USAGE_DISPLAY.destroy()，或刷新页面。
 * 说明：读取页面同源 session.history 数据，嵌入页面右侧列（grid 第 4 列），
 *       [用量|文件] 视图切换，每 5 秒自动刷新（可在 CONFIG.refreshMs 修改）。
 * ===================================================================== */
/**
 * 用量显示 · Usage Display for DeepSeek Harness Web GUI
 * ========================================================
 * 自包含注入脚本：读取 DeepSeek Harness Web 页面的同源 API（session.history
 * 及其 tokenUsage / contextPressure / contextBreakdown / sessionStats 投影），
 * 计算会话用量并**嵌入页面右侧列**（追加为 DSH 三轨 grid 布局的第 4 列，
 * 与原生 details 列同款观感，对话区自动挤压，非悬浮覆盖）。
 *
 * 三种注入方式共用本文件：
 *   1. Chrome/Edge 扩展（extension/ 目录，content script 注入本文件到页面世界）
 *   2. Tampermonkey 油猴脚本（userscript/用量显示.user.js，内嵌本文件）
 *   3. 浏览器控制台粘贴（console/用量显示-控制台注入.js，内嵌本文件）
 *
 * 数据通道（已在 DSH 部署上实测验证）：
 *   POST /api/session.history  →  events[] + projections{ tokenUsage, contextPressure, ... }
 *   POST /api/subagent.list    →  子代理列表（按来源统计用）
 *   当前会话 id 来自 localStorage["dsh.sessions.current"]
 *
 * 面板布局：头部 + [用量|文件] 主视图切换。用量视图含上下文窗口/会话指标/
 * 用量分析/明细/官方账户；文件视图含工作区文件（目录树/预览）——两者切换显示。
 * 加载反馈：请求期间（发起请求 → 收到返回）面板显示模糊遮罩 + 旋转等待指示；
 * 监听 localStorage["dsh.sessions.current"]，切换会话/窗口时立即遮罩并立刻刷新。
 * 消息标注：聊天区每条已完成回合（turn）的底部、复制按钮旁标注该回合
 * 发送的输入 / 返回的输出 token 量与费用（数据来自 session.history 的 usage）。
 * 卸载：调用 window.__DSH_USAGE_DISPLAY.destroy()（恢复页面布局）或刷新页面。
 */

/* ============================== 配置区 ====================================
 * 按需修改。修改后重新注入即可。
 *
 * 计价与 Reasonix 桌面版保持一致（USD / 每百万 tokens，取自其开源
 * src/telemetry/stats.ts 的 DEEPSEEK_PRICING 表）：
 *   deepseek-v4-flash / deepseek-chat / deepseek-reasoner:
 *     命中 $0.0028、未命中 $0.14、输出 $0.28
 *   deepseek-v4-pro:
 *     命中 $0.003625、未命中 $0.435、输出 $0.87
 * 面板按 CONFIG.currency 显示币种（默认人民币：USD × cnyRate）。
 */
const CONFIG = {
  // 模型价目表（USD / 1M tokens）。key 为模型 id；缺省模型回退 fallback。
  // 面板会自动从会话事件读取实际模型（assistant/message 的 source.model），
  // 匹配不到时用 fallback。
  pricing: {
    'deepseek-v4-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    'deepseek-v4-pro': { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
    'deepseek-chat': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    'deepseek-reasoner': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
    fallback: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
  },
  // 展示币种：'CNY'（¥，按 cnyRate 换算）或 'USD'（$，直接显示）
  currency: 'CNY',
  cnyRate: 7.14,
  // 上下文窗口（tokens）。默认 0 = 优先取服务端 contextPressure.contextWindow，
  // 拿不到时回退到这个值。DeepSeek V4 系列为 1,000,000。
  contextWindow: 0,
  // 压缩触发阈值（占上下文窗口的比例）。"距压缩" = 阈值 × 窗口 − 已用。
  compressThreshold: 0.8,
  // 自动刷新间隔（毫秒）。
  refreshMs: 5000,
  // 官方账户数据（余额/平台费用）刷新间隔（毫秒）。官方接口有频率限制，勿设过小。
  officialRefreshMs: 60000,
  // 在聊天区每条已完成回合（turn）底部、复制按钮旁标注该回合的
  // 输入（发送）/ 输出（返回）token 量与费用。数据来自 session.history 的 usage。
  annotateMessages: true,
  // 调试日志开关。
  debug: false,
}

/** 取某模型的单价（USD/1M tokens）；未知模型回退 fallback。 */
function pricingFor(model) {
  if (model && CONFIG.pricing[model]) return CONFIG.pricing[model]
  return CONFIG.pricing.fallback
}

/** 费用（元，按展示币种）：命中/未命中/输出 token 数 → 金额。 */
function costOf(model, hit, miss, output) {
  const p = pricingFor(model)
  const usd = (hit * p.cacheHit + miss * p.cacheMiss + output * p.output) / 1e6
  return CONFIG.currency === 'CNY' ? usd * (CONFIG.cnyRate || 7.14) : usd
}

/* ============================== 工具函数 ================================== */
function fmtInt(n) {
  return Number(n).toLocaleString('en-US')
}

function fmtCompact(n) {
  const v = Number(n) || 0
  if (v >= 1e6) {
    const x = v / 1e6
    return `${x >= 100 ? Math.round(x) : x.toFixed(2).replace(/\.?0+$/, '')}M`
  }
  if (v >= 1e3) {
    const x = v / 1e3
    return `${x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, '')}K`
  }
  return String(Math.round(v))
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}小时${String(m).padStart(2, '0')}分${String(s).padStart(2, '0')}秒`
  if (m > 0) return `${m}分${String(s).padStart(2, '0')}秒`
  return `${s}秒`
}

function fmtMoney(amount) {
  const v = Number(amount) || 0
  const sym = CONFIG.currency === 'CNY' ? '¥' : '$'
  if (v === 0) return `${sym}0.0000`
  if (v >= 1) return `${sym}${v.toFixed(2)}`
  if (v >= 0.01) return `${sym}${v.toFixed(4)}`
  return `${sym}${v.toFixed(6)}`
}

/* ===================== 官方账户（DeepSeek 官方 API 直连） =====================
 * 两类官方数据源：
 *   1. 余额：GET https://api.deepseek.com/user/balance（公开接口，浏览器 CORS 放行，
 *      用 API Key 鉴权；Key 仅存本机 localStorage，请求只发往官方域名）
 *   2. 平台用量/费用：GET https://platform.deepseek.com/api/v0/usage/{amount,cost}
 *      （平台私有 dashboard 接口，需登录 platform.deepseek.com 后从浏览器
 *      localStorage 复制 userToken；页面直连被 CORS 拦截，由扩展后台
 *      / 油猴 GM_xhr 桥转发——见 __dshuBridgeFetch）
 * 聚合语义照 CodexBar（开源）的 DeepSeekUsageCostParser：amount 为 token 整数，
 * cost 为金额浮点；type ∈ {PROMPT_CACHE_HIT_TOKEN, PROMPT_CACHE_MISS_TOKEN,
 * RESPONSE_TOKEN, REQUEST}；错误码 40002/40003 表示 Token 失效。
 */
const OFFICIAL = {
  BALANCE_URL: 'https://api.deepseek.com/user/balance',
  USAGE_AMOUNT_URL: 'https://platform.deepseek.com/api/v0/usage/amount',
  USAGE_COST_URL: 'https://platform.deepseek.com/api/v0/usage/cost',
}
const STORAGE_KEY = 'dshu.apiKey'
const STORAGE_TOKEN = 'dshu.platformToken'
// 凭证通道：优先宿主内建桥（/dshu/credentials，同源，直读 DSH 宿主凭证）；
// 回退本地桥（setup-key.js / setup-key.bat，3987 端口）。
const LOCAL_CREDENTIAL_URL = 'http://127.0.0.1:3987/credentials'
let lastAutoProbeAt = 0

/**
 * Dynamic Cordis packages receive this lexical adapter from
 * dsh-plugin/build-client.js. The standalone userscript/extension builds do
 * not define it and retain their normal same-origin/browser transport.
 */
function hasDynamicHost() {
  return typeof __dshuHost !== 'undefined'
    && __dshuHost !== null
    && typeof __dshuHost.call === 'function'
}

/**
 * 自动获取 API Key：优先宿主凭证（/dshu/credentials，直读 DSH 宿主
 * DEEPSEEK_API_KEY），无宿主桥时回退本地桥。找到后存入 localStorage。
 * 无可用通道时静默跳过，每 30 秒重试一次。
 */
async function autoImportApiKey() {
  const now = Date.now()
  if (getApiKey()) return false
  if (now - lastAutoProbeAt < 30000) return false
  lastAutoProbeAt = now
  if (hasDynamicHost()) {
    try {
      const credential = await __dshuHost.call('apikey', {})
      if (credential && typeof credential.apiKey === 'string' && credential.apiKey) {
        setStoredCredential(STORAGE_KEY, credential.apiKey.trim())
        log('auto-imported api key from dynamic host')
        return true
      }
    } catch { /* credential access is optional */ }
  }
  // 1) 宿主内建桥（同源，零配置）
  try {
    if (await probeHostBridge()) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2500)
      const response = await fetch(`${HOST_BRIDGE}/credentials`, { signal: controller.signal, cache: 'no-store' })
      clearTimeout(timer)
      if (response.ok) {
        const json = parseJsonSafe(await response.text())
        if (json && typeof json.apiKey === 'string' && json.apiKey) {
          setStoredCredential(STORAGE_KEY, json.apiKey.trim())
          log('auto-imported api key from host bridge')
          return true
        }
      }
    }
  } catch { /* 回退本地桥 */ }
  // 2) 本地桥回退
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const response = await fetch(LOCAL_CREDENTIAL_URL, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    if (!response.ok) return false
    const json = parseJsonSafe(await response.text())
    if (!json || typeof json.apiKey !== 'string' || !json.apiKey) return false
    setStoredCredential(STORAGE_KEY, json.apiKey.trim())
    log('auto-imported api key from local bridge')
    return true
  } catch {
    return false // 桥未启动等静默场景
  }
}

function getStoredCredential(name) {
  try { return localStorage.getItem(name) || '' } catch { return '' }
}
function setStoredCredential(name, value) {
  try {
    if (value) localStorage.setItem(name, value)
    else localStorage.removeItem(name)
  } catch { /* noop */ }
}
function getApiKey() { return getStoredCredential(STORAGE_KEY) }
function getPlatformToken() { return getStoredCredential(STORAGE_TOKEN) }

/**
 * 官方请求统一传输层：
 *   1. 扩展/油猴注入的桥（__dshuBridgeFetch，可绕过页面 CORS）
 *   2. 页面 fetch 直连（api.deepseek.com 等 CORS 放行的端点）
 * 返回 { ok, status, body }。
 */
async function officialFetch(url, init = {}) {
  if (typeof window !== 'undefined' && typeof window.__dshuBridgeFetch === 'function') {
    try {
      const bridged = await window.__dshuBridgeFetch(url, init)
      if (bridged && typeof bridged.status === 'number') return bridged
    } catch (e) {
      log('bridge fetch failed, falling back to direct', e)
    }
  }
  const response = await fetch(url, init)
  return { ok: response.ok, status: response.status, body: await response.text() }
}

function parseJsonSafe(text) {
  try { return JSON.parse(text) } catch { return null }
}

/** 余额：API Key → api.deepseek.com/user/balance。多币种取余额最大者（pickPrimaryBalance 语义）。 */
async function fetchOfficialBalance() {
  const key = getApiKey()
  if (!key) return null
  if (hasDynamicHost()) {
    const result = await __dshuHost.call('official', { apiKey: key })
    return result && result.balance ? result.balance : null
  }
  const res = await officialFetch(OFFICIAL.BALANCE_URL, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
  })
  if (res.status === 401) return { error: 'API Key 无效或已失效' }
  const json = parseJsonSafe(res.body)
  if (!json || !Array.isArray(json.balance_infos)) return null
  const infos = json.balance_infos.filter(i => i && i.total_balance !== undefined)
  if (infos.length === 0) return null
  const primary = infos.reduce((a, b) => (Number(b.total_balance) > Number(a.total_balance) ? b : a))
  return {
    available: json.is_available !== false,
    currency: primary.currency || 'CNY',
    total: Number(primary.total_balance) || 0,
    granted: Number(primary.granted_balance) || 0,
    toppedUp: Number(primary.topped_up_balance) || 0,
  }
}

/* ===================== 工作区文件（目录树/预览/系统打开） =====================
 * 能力分工（实测结论）：
 *   - 系统打开（文件夹→资源管理器、文件→默认程序）：宿主 RPC host.openPath
 *     （Invoke-Item，canOpenPath=true），浏览器直连即可
 *   - 目录树/文本预览/凭证：优先走**宿主内建桥**（同源 /dshu/tree|file|credentials，
 *     由 DSH 动态插件 dshub-1 注册，零配置）；宿主桥不可用时回退本地桥
 *     （setup-key.js 的 /tree /file，3987 端口）
 */
const HOST_BRIDGE = '/dshu'
const LOCAL_TREE_URL = 'http://127.0.0.1:3987/tree'
const LOCAL_FILE_URL = 'http://127.0.0.1:3987/file'
let hostBridgeUp = undefined // 宿主桥是否可用（undefined=未探测）

let filesState = {
  root: undefined,        // 当前会话 cwd
  loaded: false,          // 根目录是否加载过
  expanded: new Set(),    // 已展开的目录路径
  preview: null,          // { path, name, content, size, lines, error }
  loading: new Set(),     // 加载中的路径
  bridgeUp: undefined,    // 目录/文件桥是否可用（undefined=未探测）
}

function resetFilesState(root) {
  filesState = { root, loaded: false, expanded: new Set(), preview: null, loading: new Set(), bridgeUp: undefined }
}

/** 探测宿主内建桥（一次，之后缓存）。 */
async function probeHostBridge() {
  if (hostBridgeUp !== undefined) return hostBridgeUp
  if (hasDynamicHost()) {
    hostBridgeUp = true
    return true
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 1500)
    const resp = await fetch(`${HOST_BRIDGE}/ping`, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    hostBridgeUp = resp.ok
  } catch { hostBridgeUp = false }
  return hostBridgeUp
}

/** 桥请求（目录树/文件预览）：优先宿主内建路由（同源），失败回退本地桥。 */
async function bridgeGet(hostPath, localUrl, pathParam) {
  if (hasDynamicHost()) {
    const method = hostPath === '/tree' ? 'tree' : hostPath === '/file' ? 'file' : null
    if (!method) return { error: `unsupported host bridge path: ${hostPath}` }
    return __dshuHost.call(method, { path: pathParam })
  }
  const hostOk = await probeHostBridge()
  if (hostOk) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 4000)
      const response = await fetch(`${HOST_BRIDGE}${hostPath}?path=${encodeURIComponent(pathParam)}`, { signal: controller.signal, cache: 'no-store' })
      clearTimeout(timer)
      const json = parseJsonSafe(await response.text())
      if (response.ok && json) return json
      if (json && json.error) return json // 宿主路由的业务错误（如路径不存在）也透传
    } catch { /* 宿主桥异常，回退本地桥 */ }
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const response = await fetch(`${localUrl}?path=${encodeURIComponent(pathParam)}`, { signal: controller.signal, cache: 'no-store' })
    clearTimeout(timer)
    const json = parseJsonSafe(await response.text())
    if (!response.ok || !json) return { error: (json && json.error) || `HTTP ${response.status}` }
    return json
  } catch {
    return { error: hostOk
      ? '宿主桥读取失败'
      : '目录树/预览不可用：可让会话激活宿主桥（dshub-1），或双击 setup-key.bat 启动本地桥' }
  }
}

/** 列目录（宿主桥 /tree → 本地桥 /tree）。 */
async function bridgeListDirectory(dirPath) {
  const result = await bridgeGet('/tree', LOCAL_TREE_URL, dirPath)
  if (result.error) { filesState.bridgeUp = false; return result }
  filesState.bridgeUp = true
  return result
}

/** 文件预览（本地桥 /file）。 */
async function bridgeReadFile(filePath) {
  const result = await bridgeGet('/file', LOCAL_FILE_URL, filePath)
  if (result.error) { filesState.bridgeUp = false; return result }
  filesState.bridgeUp = true
  return result
}

/** 系统默认方式打开路径（宿主 RPC host.openPath）。 */
async function hostOpenPath(targetPath) {
  if (hasDynamicHost()) return __dshuHost.openPath(targetPath)
  const result = await rpc('host.openPath', { path: targetPath })
  return result
}

/** 目录条目 DOM（递归渲染展开的子树）。 */
function fileEntryRow(entry, depth) {
  const row = el('div', 'dshu-file-row')
  row.style.paddingLeft = `${8 + depth * 14}px`
  const icon = el('span', 'dshu-file-icon', entry.dir ? '📁' : '📄')
  const name = el('span', 'dshu-file-name', entry.name)
  name.title = entry.path
  row.append(icon, name)

  if (entry.dir) {
    // 点击展开/收起
    const toggle = () => {
      if (filesState.expanded.has(entry.path)) {
        filesState.expanded.delete(entry.path)
      } else {
        filesState.expanded.add(entry.path)
        void expandDirectory(entry.path)
      }
      refreshFilesSection()
    }
    row.onclick = (e) => { if (!e.target.closest('.dshu-file-action')) toggle() }
    const actions = el('span', 'dshu-file-actions')
    const openBtn = el('button', 'dshu-file-action', '📂')
    openBtn.title = '在资源管理器中打开'
    openBtn.onclick = (e) => { e.stopPropagation(); void hostOpenPath(entry.path).catch(() => {}) }
    actions.append(openBtn)
    row.append(actions)
  } else {
    row.onclick = (e) => { if (!e.target.closest('.dshu-file-action')) void previewFile(entry.path) }
    const actions = el('span', 'dshu-file-actions')
    const openBtn = el('button', 'dshu-file-action', '↗')
    openBtn.title = '用默认程序打开'
    openBtn.onclick = (e) => { e.stopPropagation(); void hostOpenPath(entry.path).catch(() => {}) }
    actions.append(openBtn)
    row.append(actions)
  }
  return row
}

/** 展开一个目录（懒加载子项）。 */
async function expandDirectory(dirPath) {
  if (filesState.loading.has(dirPath)) return
  filesState.loading.add(dirPath)
  refreshFilesSection()
  try {
    const result = await bridgeListDirectory(dirPath)
    if (!result.error) {
      filesState.entries = filesState.entries || {}
      filesState.entries[dirPath] = result.entries
    } else {
      filesState.expanded.delete(dirPath)
    }
  } finally {
    filesState.loading.delete(dirPath)
    refreshFilesSection()
  }
}

/** 预览一个文件。 */
async function previewFile(filePath) {
  if (filesState.loading.has(filePath)) return
  filesState.loading.add(filePath)
  filesState.preview = { path: filePath, loading: true }
  refreshFilesSection()
  try {
    const result = await bridgeReadFile(filePath)
    if (result.error) {
      filesState.preview = { path: filePath, error: result.error, loading: false }
    } else {
      filesState.preview = { path: result.path || filePath, content: result.content, size: result.size, lines: result.lines, loading: false }
    }
  } finally {
    filesState.loading.delete(filePath)
    refreshFilesSection()
  }
}

function renderFilesSection(container, s) {
  const sec = el('div', 'dshu-sec dshu-files')
  const title = el('div', 'dshu-sec-title')
  const label = el('span', null, '工作区文件')
  const meta = el('span', 'dshu-sub', (s.cwd || '').length > 42 ? '…' + s.cwd.slice(-42) : (s.cwd || ''))
  meta.title = s.cwd || ''
  const refreshBtn = el('button', 'dshu-btn', '⟳')
  refreshBtn.title = '刷新文件树'
  refreshBtn.onclick = () => { resetFilesState(); filesState.root = s.cwd; void loadRoot(s.cwd) }
  title.append(label, meta, refreshBtn)
  sec.append(title)

  if (!s.cwd) {
    sec.append(el('div', 'dshu-wait', '会话无工作目录'))
    container.append(sec)
    return
  }

  if (!filesState.loaded) {
    // 首次进入：加载根目录
    filesState.root = s.cwd
    void loadRoot(s.cwd)
    sec.append(waitNode('加载目录…'))
    container.append(sec)
    return
  }

  if (filesState.bridgeUp === false) {
    const tip = el('div', 'dshu-field-hint')
    tip.textContent = '目录树/预览不可用：可让会话激活宿主桥（dshub-1），或双击 setup-key.bat（打开文件夹/默认程序打开不受影响）'
    sec.append(tip)
    container.append(sec)
    return
  }

  const tree = el('div', 'dshu-file-tree')
  const rootEntries = (filesState.entries || {})[filesState.root]
  if (!rootEntries || rootEntries.length === 0) {
    sec.append(el('div', 'dshu-wait', '目录为空或不可读'))
    container.append(sec)
    return
  }
  for (const entry of rootEntries) {
    tree.append(fileEntryRow(entry, 0))
    // 递归渲染已展开的子目录（最多 6 层，防深循环）
    renderExpandedChildren(tree, entry, 1)
  }
  sec.append(tree)

  // 预览区
  if (filesState.preview) {
    const pv = filesState.preview
    const box = el('div', 'dshu-preview')
    const head = el('div', 'dshu-preview-head')
    const info = el('span', 'dshu-preview-info')
    if (pv.loading) info.append(el('span', 'dshu-spinner-sm'), '加载中…')
    else info.textContent = `${pv.error ? '⚠ ' : ''}${baseName(pv.path)}${pv.size !== undefined ? ` · ${fmtInt(pv.size)} 字节` : ''}${pv.lines !== undefined ? ` · ${fmtInt(pv.lines)} 行` : ''}`
    info.title = pv.path
    const close = el('button', 'dshu-btn', '✕')
    close.onclick = () => { filesState.preview = null; refreshFilesSection() }
    head.append(info, close)
    box.append(head)
    if (pv.error) {
      box.append(el('div', 'dshu-err', pv.error))
    } else if (pv.content !== undefined) {
      const pre = el('pre', 'dshu-preview-code', pv.content.length > 20000 ? pv.content.slice(0, 20000) + '\n…（已截断）' : pv.content)
      box.append(pre)
    }
    sec.append(box)
  }
  container.append(sec)
}

/** 渲染已展开子目录的子树（DFS，深度上限 6）。 */
function renderExpandedChildren(container, parentEntry, depth) {
  if (depth > 6 || !parentEntry.dir) return
  if (!filesState.expanded.has(parentEntry.path)) return
  const children = (filesState.entries || {})[parentEntry.path]
  if (!children) return
  for (const child of children) {
    container.append(fileEntryRow(child, depth))
    renderExpandedChildren(container, child, depth + 1)
  }
}

async function loadRoot(rootPath) {
  if (filesState.loading.has(rootPath)) return
  filesState.loading.add(rootPath)
  refreshFilesSection()
  try {
    const result = await bridgeListDirectory(rootPath)
    if (result.error) {
      filesState.loaded = true
      filesState.bridgeUp = false
    } else {
      filesState.loaded = true
      filesState.bridgeUp = true
      filesState.entries = filesState.entries || {}
      filesState.entries[rootPath] = result.entries
    }
  } finally {
    filesState.loading.delete(rootPath)
    refreshFilesSection()
  }
}

function refreshFilesSection() {
  if (!shadow) return
  const view = shadow.querySelector('.dshu-files-view')
  if (!view) return
  view.textContent = ''
  if (lastStats) renderFilesSection(view, lastStats)
}

function baseName(p) {
  const parts = String(p).split(/[\\/]/)
  return parts[parts.length - 1] || p
}

const FILES_CSS = `
.dshu-file-row {
  display: flex; align-items: center; gap: 5px; padding: 2.5px 6px; border-radius: 5px;
  cursor: pointer; font-size: 11.5px; color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  min-width: 0;
}
.dshu-file-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
.dshu-file-icon { flex: none; font-size: 11px; }
.dshu-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.dshu-file-actions { display: none; flex: none; gap: 2px; }
.dshu-file-row:hover .dshu-file-actions { display: inline-flex; }
.dshu-file-action {
  border: none; background: var(--dsw-specific-input-major, rgb(44, 44, 46)); color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  border-radius: 4px; font-size: 10px; padding: 1px 4px; cursor: pointer; line-height: 1.4;
}
.dshu-file-action:hover { color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); }
.dshu-preview {
  margin-top: 8px; border-radius: 8px; overflow: hidden; background: var(--dsw-alias-markdown-code-block, rgb(27, 27, 28));
}
.dshu-preview-head {
  display: flex; justify-content: space-between; align-items: center; gap: 6px;
  padding: 5px 8px; background: var(--dsw-specific-input-major, rgb(44, 44, 46));
}
.dshu-preview-info { font-size: 10.5px; color: var(--dsw-alias-label-tertiary, rgb(151, 157, 166)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshu-preview-code {
  margin: 0; padding: 8px 10px; max-height: 220px; overflow: auto; white-space: pre;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 10.5px; line-height: 1.55;
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214)); user-select: text;
}
.dshu-files-anchor { display: contents; }
`

const USAGE_CATEGORY = {
  HIT: 'PROMPT_CACHE_HIT_TOKEN',
  MISS: 'PROMPT_CACHE_MISS_TOKEN',
  OUTPUT: 'RESPONSE_TOKEN',
  REQUEST: 'REQUEST',
}

/** 把一个模型用量条目（usage: [{type, amount}]）按类别求和。 */
function foldCategoryItems(items, parse) {
  const out = { hit: 0, miss: 0, output: 0, request: 0 }
  for (const item of items || []) {
    const t = typeof item.type === 'string' ? item.type.toUpperCase() : ''
    const amount = parse(item.amount)
    if (t === USAGE_CATEGORY.HIT) out.hit += amount
    else if (t === USAGE_CATEGORY.MISS) out.miss += amount
    else if (t === USAGE_CATEGORY.OUTPUT) out.output += amount
    else if (t === USAGE_CATEGORY.REQUEST) out.request += amount
  }
  return out
}

/** 聚合 amount/cost 两个响应 → 官方用量摘要（语义照 CodexBar DeepSeekUsageCostParser）。 */
function aggregateOfficialUsage(amountPayload, costPayload) {
  const aData = amountPayload && amountPayload.data ? amountPayload.data.biz_data : null
  const cData = costPayload && costPayload.data ? costPayload.data.biz_data : null
  if (!aData) return null

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const monthPrefix = today.slice(0, 7)

  // 本月（total 为完整当月总计；缺失时从 days 兜底）与今日（days[今天]）
  const month = { hit: 0, miss: 0, output: 0, request: 0 }
  const day = { hit: 0, miss: 0, output: 0, request: 0 }
  let topModel = null
  let topModelTokens = -1
  const modelTokens = {}

  const totals = aData.total || []
  const hasTotals = totals.length > 0
  for (const m of totals) {
    if (!m || !m.model) continue
    const folded = foldCategoryItems(m.usage, v => Math.max(0, parseInt(v, 10) || 0))
    const total = folded.hit + folded.miss + folded.output
    modelTokens[m.model] = (modelTokens[m.model] || 0) + total
    month.hit += folded.hit; month.miss += folded.miss
    month.output += folded.output; month.request += folded.request
  }
  for (const d of aData.days || []) {
    if (!d || !d.date) continue
    const isToday = d.date === today
    // total 存在时 days 只用于"今日"（total 已是当月完整总计，避免重复叠加）
    if (hasTotals && !isToday) continue
    const isThisMonth = d.date.startsWith(monthPrefix)
    for (const m of d.data || []) {
      if (!m || !m.model) continue
      const folded = foldCategoryItems(m.usage, v => Math.max(0, parseInt(v, 10) || 0))
      if (isThisMonth && !hasTotals) {
        month.hit += folded.hit; month.miss += folded.miss
        month.output += folded.output; month.request += folded.request
        modelTokens[m.model] = (modelTokens[m.model] || 0) + folded.hit + folded.miss + folded.output
      }
      if (isToday) {
        day.hit += folded.hit; day.miss += folded.miss
        day.output += folded.output; day.request += folded.request
      }
    }
  }
  for (const [model, tokens] of Object.entries(modelTokens)) {
    if (tokens > topModelTokens) { topModelTokens = tokens; topModel = model }
  }

  // 费用（cost：total 为当月总计；币种取 biz_data[0].currency，默认 CNY）
  let currency = 'CNY'
  let monthCost
  let todayCost
  if (Array.isArray(cData) && cData.length > 0) {
    const c0 = cData[0]
    if (typeof c0.currency === 'string' && c0.currency) currency = c0.currency
    const parseCost = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0 }
    const costMonth = { hit: 0, miss: 0, output: 0 }
    const costDay = { hit: 0, miss: 0, output: 0 }
    const costTotals = c0.total || []
    const hasCostTotals = costTotals.length > 0
    for (const m of costTotals) {
      if (!m || !m.model) continue
      const folded = foldCategoryItems(m.usage, parseCost)
      costMonth.hit += folded.hit; costMonth.miss += folded.miss; costMonth.output += folded.output
    }
    for (const d of c0.days || []) {
      if (!d || !d.date) continue
      const isToday = d.date === today
      if (hasCostTotals && !isToday) continue
      const isThisMonth = d.date.startsWith(monthPrefix)
      for (const m of d.data || []) {
        if (!m || !m.model) continue
        const folded = foldCategoryItems(m.usage, parseCost)
        if (isThisMonth && !hasCostTotals) { costMonth.hit += folded.hit; costMonth.miss += folded.miss; costMonth.output += folded.output }
        if (isToday) { costDay.hit += folded.hit; costDay.miss += folded.miss; costDay.output += folded.output }
      }
    }
    monthCost = costMonth.hit + costMonth.miss + costMonth.output
    todayCost = costDay.hit + costDay.miss + costDay.output
  }

  return {
    currency,
    monthTokens: month.hit + month.miss + month.output,
    monthRequests: month.request,
    todayTokens: day.hit + day.miss + day.output,
    todayRequests: day.request,
    monthCost: monthCost !== undefined ? monthCost : null,
    todayCost: todayCost !== undefined ? todayCost : null,
    hitTokens: month.hit,
    missTokens: month.miss,
    outputTokens: month.output,
    topModel,
  }
}

/** 平台用量/费用：需要 userToken（登录 platform.deepseek.com 后从 localStorage 复制）。 */
async function fetchOfficialPlatformUsage() {
  const token = getPlatformToken()
  if (!token) return null
  if (hasDynamicHost()) {
    const result = await __dshuHost.call('official', { userToken: token })
    return result && result.usage ? result.usage : null
  }
  const now = new Date()
  const query = `?month=${now.getMonth() + 1}&year=${now.getFullYear()}`
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` }
  const [amountRes, costRes] = await Promise.all([
    officialFetch(`${OFFICIAL.USAGE_AMOUNT_URL}${query}`, { headers }),
    officialFetch(`${OFFICIAL.USAGE_COST_URL}${query}`, { headers }),
  ])
  const amountPayload = parseJsonSafe(amountRes.body)
  const costPayload = parseJsonSafe(costRes.body)
  // 平台错误码 40002/40003 = 认证失败（Token 失效）
  const authFailed = (amountPayload && (amountPayload.code === 40002 || amountPayload.code === 40003))
    || (costPayload && (costPayload.code === 40002 || costPayload.code === 40003))
  if (authFailed) return { error: '平台 Token 无效或已过期' }
  if (!amountPayload || amountPayload.code !== 0 || !amountPayload.data) return null
  return aggregateOfficialUsage(amountPayload, costPayload)
}

function currencySymbol(code) {
  return code === 'USD' ? '$' : '¥'
}

/** 一次拉取全部官方数据（节流由调用方控制）。 */
async function refreshOfficial() {
  const out = { balance: null, usage: null }
  try { out.balance = await fetchOfficialBalance() } catch (e) { log('balance failed', e) }
  try { out.usage = await fetchOfficialPlatformUsage() } catch (e) { log('platform usage failed', e) }
  return out
}

function pct(part, whole) {
  if (!whole) return 0
  return (part / whole) * 100
}

function uid() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID()
  } catch { /* noop */ }
  return `u${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function log(...args) {
  if (CONFIG.debug) console.log('[用量显示]', ...args)
}

/* ============================== API 层 ==================================== */
async function rpc(method, payload) {
  if (hasDynamicHost()) return __dshuHost.call(method, payload)
  const response = await fetch(`/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: uid(), method, payload }),
  })
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`)
  const body = await response.json()
  const result = body && body.result
  if (!result || result.ok !== true) {
    const err = result && result.error ? `${result.error.code}: ${result.error.message}` : 'unknown error'
    throw new Error(`${method} failed: ${err}`)
  }
  return result.value
}

/** 解析当前会话 id：优先 localStorage（与 GUI 同一存储键），回退到最近会话。 */
async function resolveSessionId() {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.sessionId === 'string' && parsed.sessionId) return parsed.sessionId
    }
  } catch { /* noop */ }
  const list = await rpc('session.list', {})
  const items = (list && list.items) || []
  if (items.length === 0) return undefined
  return items.reduce((a, b) => ((b.updatedAt || 0) > (a.updatedAt || 0) ? b : a)).sessionId
}

/**
 * 拉取完整会话历史（分页向前翻，直到 hasMore=false）。
 * 返回 { events, projections }；projections 仅尾页携带。
 * 注意：单页事件可能远超 65535 条（分页按 message 计数，chunk 事件海量），
 * 严禁用展开语法（...arr）拼接大数组——V8 参数上限会抛
 * "Maximum call stack size exceeded"（真实事故），必须用 concat。
 */
async function fetchSession(sessionId) {
  let events = []
  let projections
  let beforeSeq
  let page = 0
  const MAX_PAGES = 400
  do {
    const payload = { sessionId }
    if (beforeSeq !== undefined) payload.beforeSeq = beforeSeq
    payload.maxMessages = 200
    const pageValue = await rpc('session.history', payload)
    const pageEvents = pageValue.events || []
    if (pageEvents.length === 0) break
    events = pageEvents.concat(events) // 向前翻页 → 倒序收集后拼回正序（concat，勿用展开）
    if (beforeSeq === undefined && pageValue.projections) projections = pageValue.projections
    beforeSeq = pageEvents[0].event.seq
    if (beforeSeq === undefined || beforeSeq <= 0) break
    page += 1
    if (page >= MAX_PAGES) break
  } while (true)
  return { events, projections }
}

/** 子代理用量汇总（按来源统计用）。失败静默降级为空数组。 */
async function fetchSubagentUsage(parentSessionId) {
  const out = []
  try {
    const list = await rpc('subagent.list', { parentSessionId })
    for (const entry of (list && list.entries) || []) {
      try {
        const value = await rpc('subagent.history', {
          parentSessionId,
          childSessionId: entry.sessionId,
          mode: entry.mode,
          maxMessages: 50,
        })
        const tu = value && value.projections && value.projections.values && value.projections.values.tokenUsage
        out.push({ sessionId: entry.sessionId, mode: entry.mode, tokenUsage: tu })
      } catch (e) {
        log('subagent.history failed', entry.sessionId, e)
      }
    }
  } catch (e) {
    log('subagent.list failed', e)
  }
  return out
}

/* ============================== 统计计算 ================================== */
/**
 * 从事件流手工折叠 usage（tokenUsage 投影缺失时的回退路径）。
 * 同一 turn/step 的 usage 只计一次（chunk usage 与 message usage 互斥覆盖）。
 */
function foldUsageFromEvents(events) {
  const totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const seenSteps = new Set()
  let requests = 0
  for (const entry of events) {
    const event = entry && entry.event ? entry.event : entry
    let usage, turn, step
    if (event.type === 'assistant/message' && event.data && event.data.usage) {
      ;({ usage } = event.data)
      turn = event.data.turn
      step = event.data.step
    } else if (event.type === 'assistant/chunk' && event.data && event.data.chunk && event.data.chunk.type === 'usage') {
      usage = event.data.chunk.usage
      turn = event.data.turn
      step = event.data.step
    }
    if (!usage) continue
    const key = `${turn}:${step}`
    if (seenSteps.has(key)) continue
    seenSteps.add(key)
    requests += 1
    totals.uncachedInputTokens += usage.inputTokens || 0
    totals.outputTokens += usage.outputTokens || 0
    totals.cacheReadTokens += usage.cacheReadTokens || 0
    totals.cacheWriteTokens += usage.cacheWriteTokens || 0
  }
  return { totals, requests }
}

/**
 * 核心统计：输入原始数据，输出面板所需的全部数字。
 * @param {object} raw - { events, projections, subagents, now,
 *   firstTs?, lastTs?, requests?, model? } —— firstTs/lastTs/requests/model
 *   可由调用方预计算传入（避免全量拉取事件），缺省时从 events 推导。
 */
function computeStats(raw) {
  const { events = [], subagents = [] } = raw
  const now = raw.now !== undefined ? raw.now : Date.now()
  const projections = raw.projections || {}
  const values = projections.values || {}

  // --- 累计用量：优先服务端投影，缺失时手工折叠 ---
  const tu = values.tokenUsage
  const folded = foldUsageFromEvents(events)
  const uncached = tu ? (tu.uncachedInputTokens || 0) : folded.totals.uncachedInputTokens
  const output = tu ? (tu.outputTokens || 0) : folded.totals.outputTokens
  const cacheRead = tu ? (tu.cacheReadTokens || 0) : folded.totals.cacheReadTokens
  const cacheWrite = tu ? (tu.cacheWriteTokens || 0) : folded.totals.cacheWriteTokens

  const input = uncached + cacheRead + cacheWrite
  const hit = cacheRead
  const miss = uncached + cacheWrite
  const totalTokens = input + output
  const hitRate = hit + miss > 0 ? (hit / (hit + miss)) * 100 : 0

  // --- 请求数 / 运行时间 / 模型（调用方可预计算传入，缺省从事件推导） ---
  const sessionStats = values.sessionStats
  const requests = raw.requests !== undefined
    ? raw.requests
    : (sessionStats && typeof sessionStats.steps === 'number' ? sessionStats.steps : folded.requests)
  let firstTs = raw.firstTs
  let lastTs = raw.lastTs
  let model = raw.model
  if (firstTs === undefined || lastTs === undefined || model === undefined) {
    for (const entry of events) {
      const event = entry && entry.event ? entry.event : entry
      const ts = typeof event.time === 'number' ? event.time : typeof event.ts === 'number' ? event.ts : undefined
      if (ts === undefined) continue
      if (firstTs === undefined || ts < firstTs) firstTs = ts
      if (lastTs === undefined || ts > lastTs) lastTs = ts
      // 会话主模型：取最后一个带模型来源的 assistant/message
      if (model === undefined && event.type === 'assistant/message') {
        const source = event.data && event.data.message && event.data.message.source
        if (source && typeof source.model === 'string') model = source.model
      }
    }
  }
  const active = lastTs !== undefined && now - lastTs < 5 * 60 * 1000
  const durationMs = firstTs !== undefined ? (active ? now - firstTs : lastTs - firstTs) : 0

  // --- 上下文窗口 / 已用 / 距压缩 ---
  const cp = values.contextPressure || {}
  const contextWindow = cp.contextWindow || CONFIG.contextWindow || 1_000_000
  const used = cp.projectedTokens !== undefined ? cp.projectedTokens
    : cp.pressureTokens !== undefined ? cp.pressureTokens
    : input
  const usedPct = contextWindow > 0 ? (used / contextWindow) * 100 : 0
  const thresholdPct = (CONFIG.compressThreshold || 0.8) * 100
  const untilCompress = Math.max(0, contextWindow * (CONFIG.compressThreshold || 0.8) - used)

  // --- 费用（与 Reasonix 同款价目表与公式，USD 计费 + 展示币种换算） ---
  const costMain = costOf(model, hit, miss, output)
  let subCost = 0
  let subTokens = 0
  let subRequests = 0
  let subHit = 0
  let subMiss = 0
  let subOutput = 0
  for (const sub of subagents) {
    const s = sub.tokenUsage
    if (!s) continue
    const sMiss = (s.uncachedInputTokens || 0) + (s.cacheWriteTokens || 0)
    const sHit = s.cacheReadTokens || 0
    const sOut = s.outputTokens || 0
    subTokens += sMiss + sHit + sOut
    subRequests += 1
    subHit += sHit
    subMiss += sMiss
    subOutput += sOut
    subCost += costOf(sub.model || model, sHit, sMiss, sOut)
  }
  const totalCost = costMain + subCost
  const mainShare = totalTokens + subTokens > 0 ? (totalTokens / (totalTokens + subTokens)) * 100 : 100

  return {
    // 上下文
    contextWindow,
    used,
    usedPct,
    thresholdPct,
    untilCompress,
    // 会话指标
    model,
    hitRate,
    cost: totalCost,
    costMain,
    costSub: subCost,
    durationMs,
    requests,
    totalTokens,
    // 明细
    input,
    output,
    hit,
    miss,
    // 按来源
    mainTokens: totalTokens,
    subTokens,
    mainRequests: requests,
    subRequests,
    mainShare,
    // 工作区（会话工作目录）
    cwd: raw.cwd,
    // 原始
    contextBreakdown: values.contextBreakdown || null,
    sessionStats: values.sessionStats || null,
    hasProjection: !!tu,
  }
}

/* ============================== 面板 UI ===================================
 * 颜色全部使用 DSH 语义变量（--dsw-alias-* / --dsw-static-*），随页面
 * body[data-ds-dark-theme] 亮/暗主题自动切换；var() 自带 fallback 兜底。
 * 自定义属性沿 DOM 继承链穿透 shadow DOM 边界，主题切换无需任何 JS。
 */
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.dshu-panel {
  position: relative; /* 遮罩（加载/设置）的定位锚点 */
  display: flex; flex-direction: column;
  height: 100%; min-width: 0;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  user-select: none; overflow: hidden;
}
/* 主视图切换（无头部条）：[用量|文件] + 右侧无边框操作按钮 */
.dshu-main-tabs {
  display: flex; align-items: center; gap: 2px;
  padding: 10px 12px 0; flex: none;
}
.dshu-main-tab {
  flex: 1; text-align: center; border: none; background: transparent;
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  font-size: 12px; padding: 6px 0; border-radius: 7px; cursor: pointer;
}
.dshu-main-tab:hover { color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); }
.dshu-main-tab.on {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56));
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); font-weight: 600;
}
.dshu-main-actions { display: flex; gap: 0; margin-left: 4px; flex: none; }
.dshu-icon-btn {
  border: none; background: transparent; color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  cursor: pointer; font-size: 13px; line-height: 1; width: 24px; height: 24px;
  display: grid; place-items: center; border-radius: 6px; padding: 0;
}
.dshu-icon-btn:hover { color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
/* 通用小按钮（文件刷新/预览关闭/设置弹层） */
.dshu-btn {
  border: none; background: transparent; color: var(--dsw-alias-label-caption, rgb(129, 133, 140)); cursor: pointer;
  font-size: 13px; line-height: 1; padding: 2px 6px; border-radius: 6px; flex: none;
}
.dshu-btn:hover { color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08)); }
/* 内容从顶部排布（侧边栏工作区风格），无垂直居中 */
.dshu-body { flex: 1; min-height: 0; padding: 8px 12px 14px; overflow-y: auto; user-select: text; }
.dshu-files-view { flex: 1; min-height: 0; padding: 8px 12px 14px; overflow-y: auto; user-select: text; }
.dshu-body::-webkit-scrollbar { width: 6px; }
.dshu-body::-webkit-scrollbar-thumb { background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56)); border-radius: 3px; }
.dshu-files-view::-webkit-scrollbar { width: 6px; }
.dshu-files-view::-webkit-scrollbar-thumb { background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56)); border-radius: 3px; }
.dshu-sec { margin-bottom: 14px; }
.dshu-sec:last-child { margin-bottom: 0; }
/* 区段标题：对齐侧边栏"工作区"标题（14px/400/灰色，无大写无字距） */
.dshu-sec-title {
  font-size: 14px; font-weight: 400; color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  display: flex; align-items: center; justify-content: space-between;
  margin: 2px 0 4px; padding: 0 0 0 4px;
}
.dshu-sec-title .dshu-sub { font-size: 12px; color: var(--dsw-alias-label-dimmed, rgb(101, 103, 107)); font-weight: 400; }
.dshu-ctx-meta { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
.dshu-ctx-used { font-size: 15px; font-weight: 700; color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); }
.dshu-ctx-used .dshu-muted { font-size: 11px; font-weight: 400; color: var(--dsw-alias-label-caption, rgb(129, 133, 140)); }
.dshu-bar { position: relative; height: 8px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgb(44, 44, 46)); overflow: hidden; }
.dshu-bar > i { position: absolute; inset: 0 auto 0 0; border-radius: 4px; background: var(--dsw-alias-state-business-primary, rgb(65, 118, 230)); transition: width .3s; }
.dshu-bar > b { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--dsw-alias-state-warn-primary, rgb(245, 158, 11)); }
.dshu-bar-warn > i { background: var(--dsw-alias-state-warn-primary, rgb(245, 158, 11)); }
.dshu-bar-danger > i { background: var(--dsw-alias-state-error-primary, rgb(239, 68, 68)); }
.dshu-ctx-foot { display: flex; justify-content: space-between; margin-top: 5px; color: var(--dsw-alias-label-caption, rgb(129, 133, 140)); font-size: 11px; }
.dshu-ctx-foot b { color: var(--dsw-alias-label-secondary, rgb(207, 211, 214)); font-weight: 500; }
.dshu-badge {
  font-size: 10px; padding: 1px 7px; border-radius: 99px; font-weight: 600;
}
.dshu-badge-ok { color: var(--dsw-alias-state-success-primary, rgb(34, 197, 94)); background: var(--dsw-alias-state-success-tertiary, rgba(34, 197, 94, 0.14)); }
.dshu-badge-warn { color: var(--dsw-alias-state-warn-primary, rgb(245, 158, 11)); background: var(--dsw-alias-state-warn-tertiary, rgba(245, 158, 11, 0.14)); }
.dshu-badge-danger { color: var(--dsw-alias-state-error-primary, rgb(239, 68, 68)); background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239, 68, 68, 0.15)); }
.dshu-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
.dshu-cell { background: var(--dsw-specific-input-major, rgb(27, 27, 28)); border-radius: 8px; padding: 7px 9px; }
.dshu-cell .k { font-size: 10px; color: var(--dsw-alias-label-caption, rgb(129, 133, 140)); }
.dshu-cell .v { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); margin-top: 1px; }
.dshu-cell .v.blue { color: var(--dsw-alias-state-business-primary, rgb(103, 158, 254)); }
.dshu-cell .v.green { color: var(--dsw-alias-state-success-secondary, rgb(78, 209, 126)); }
.dshu-cell .v.amber { color: var(--dsw-alias-state-warn-secondary, rgb(247, 173, 49)); }
.dshu-tabs { display: flex; gap: 2px; background: var(--dsw-specific-input-major, rgb(33, 33, 35)); border-radius: 7px; padding: 2px; margin-bottom: 8px; }
.dshu-tab {
  flex: 1; text-align: center; border: none; background: transparent; color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  font-size: 11px; padding: 4px 0; border-radius: 6px; cursor: pointer;
}
.dshu-tab.on { background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56)); color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); font-weight: 600; }
.dshu-rows { display: flex; flex-direction: column; gap: 5px; }
.dshu-row { display: flex; justify-content: space-between; align-items: baseline; }
.dshu-row .k { color: var(--dsw-alias-label-tertiary, rgb(151, 157, 166)); }
.dshu-row .v { color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); font-weight: 600; font-variant-numeric: tabular-nums; }
.dshu-row .v .unit { color: var(--dsw-alias-label-caption, rgb(129, 133, 140)); font-weight: 400; font-size: 10px; margin-left: 3px; }
.dshu-share { display: flex; gap: 2px; height: 6px; border-radius: 3px; overflow: hidden; background: var(--dsw-alias-interactive-bg-hover, rgb(44, 44, 46)); margin: 6px 0 4px; }
.dshu-share i { display: block; height: 100%; }
.dshu-share-main { background: var(--dsw-alias-state-business-primary, rgb(65, 118, 230)); }
.dshu-share-sub { background: var(--dsw-alias-state-business-tertiary, rgb(147, 197, 253)); }
.dshu-share-in { background: var(--dsw-alias-state-business-primary, rgb(65, 118, 230)); }
.dshu-share-out { background: var(--dsw-alias-state-success-secondary, rgb(78, 209, 126)); }
/* 底部状态行：侧边栏底部行风格（无黑线） */
.dshu-foot {
  padding: 6px 12px; display: flex; justify-content: space-between; align-items: center;
  color: var(--dsw-alias-label-dimmed, rgb(101, 103, 107)); font-size: 12px; flex: none;
}
.dshu-err { color: var(--dsw-alias-state-error-secondary, rgb(242, 90, 90)); padding: 14px 4px; text-align: center; }
.dshu-wait { color: var(--dsw-alias-label-caption, rgb(129, 133, 140)); padding: 14px 4px; text-align: center; }
/* 加载中：模糊遮罩 + 旋转等待指示器 */
.dshu-loading {
  position: absolute; inset: 0; z-index: 3;
  display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: rgba(21, 21, 23, 0.55);
  background: color-mix(in srgb, var(--dsw-alias-bg-base, rgb(21, 21, 23)) 60%, transparent);
  backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
}
.dshu-loading.on { display: flex; }
.dshu-spinner {
  width: 28px; height: 28px; border-radius: 50%;
  border: 3px solid var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56));
  border-top-color: var(--dsw-alias-state-business-primary, rgb(103, 158, 254));
  animation: dshu-spin .8s linear infinite;
}
.dshu-loading-text { font-size: 11px; color: var(--dsw-alias-label-caption, rgb(129, 133, 140)); }
/* 行内小号旋转指示器（等待占位 / 文件加载中） */
.dshu-spinner-sm {
  display: inline-block; width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56));
  border-top-color: var(--dsw-alias-state-business-primary, rgb(103, 158, 254));
  animation: dshu-spin .8s linear infinite; vertical-align: -2px; margin-right: 6px;
}
/* 刷新按钮加载时旋转 */
.dshu-icon-btn.spinning { animation: dshu-spin .9s linear infinite; }
@keyframes dshu-spin { to { transform: rotate(360deg); } }
`

let hostEl = null
let shadow = null
let refreshTimer = null
let domReadyHandler = null
let lastStats = null
let lastError = null // 会话数据加载错误（独立于 lastStats，避免被后续刷新覆盖）
let lastOfficial = null
let lastOfficialAt = 0
let viewState = { sourceTab: 'source', detailTab: 'io', mainTab: 'usage' }
let loadingCount = 0 // 并发加载计数（refreshData 可能重叠：手动刷新 + 定时器）
let loadingTimer = null // 常规刷新延迟显示遮罩的计时器（防 5s 周期刷新闪烁）
let refreshSeq = 0 // 刷新代次：会话切换后，旧代次请求的结果直接丢弃，避免旧数据覆盖新会话
let sessionWatchTimer = null // 会话切换监听（localStorage 轮询）
let displayedSessionId = null // 当前已展示数据的会话 id（用于检测切换）
let sessionSwitching = false // 本次加载由会话切换触发 → 立即显示遮罩（不延迟）
// 会话首事件时间缓存：首次/切换会话时全量拉一次，之后常规刷新只拉尾页。
// （firstTs 是会话不变常量，token/命中率/请求数等全部来自尾页投影）
// 同时持久化到 localStorage：刷新页面也不用再次全量拉取。
const SESSION_FIRST_STORAGE = 'dshu.sessionFirst'
let firstTsCache = null // { sessionId, firstTs, model }

function loadFirstTsCache() {
  try {
    const raw = localStorage.getItem(SESSION_FIRST_STORAGE)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.sessionId === 'string' && typeof parsed.firstTs === 'number') {
        firstTsCache = { sessionId: parsed.sessionId, firstTs: parsed.firstTs, model: parsed.model || undefined }
        return firstTsCache
      }
    }
  } catch { /* noop */ }
  return null
}

function saveFirstTsCache() {
  try {
    if (firstTsCache) localStorage.setItem(SESSION_FIRST_STORAGE, JSON.stringify(firstTsCache))
  } catch { /* noop */ }
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function badgeFor(usedPct, thresholdPct) {
  if (usedPct >= thresholdPct) return ['dshu-badge-danger', '已到压缩阈值']
  if (usedPct >= thresholdPct * 0.75) return ['dshu-badge-warn', '上下文紧张']
  return ['dshu-badge-ok', '上下文充足']
}

function renderContextSection(container, s) {
  const sec = el('div', 'dshu-sec')
  const title = el('div', 'dshu-sec-title')
  title.append(el('span', null, '上下文窗口'), el('span', 'dshu-sub', `压缩阈值 ${s.thresholdPct.toFixed(0)}%`))
  sec.append(title)

  const meta = el('div', 'dshu-ctx-meta')
  const used = el('span', 'dshu-ctx-used')
  used.append(`${fmtCompact(s.used)} `, el('span', 'dshu-muted', `/ ${fmtCompact(s.contextWindow)} tokens`))
  const [badgeCls, badgeText] = badgeFor(s.usedPct, s.thresholdPct)
  meta.append(used, el('span', `dshu-badge ${badgeCls}`, badgeText))
  sec.append(meta)

  const bar = el('div', 'dshu-bar')
  const fill = el('i')
  fill.style.width = `${Math.min(100, s.usedPct)}%`
  const mark = el('b')
  mark.style.left = `${Math.min(100, s.thresholdPct)}%`
  bar.append(fill, mark)
  if (s.usedPct >= s.thresholdPct * 0.75 && s.usedPct < s.thresholdPct) bar.classList.add('dshu-bar-warn')
  if (s.usedPct >= s.thresholdPct) bar.classList.add('dshu-bar-danger')
  sec.append(bar)

  const foot = el('div', 'dshu-ctx-foot')
  const a = el('span', null, '')
  a.append('已用 ', el('b', null, fmtCompact(s.used)), `（${s.usedPct.toFixed(1)}%）`)
  const b = el('span', null, '')
  b.append('距压缩 ', el('b', null, fmtCompact(s.untilCompress)))
  foot.append(a, b)
  sec.append(foot)
  container.append(sec)
}

function renderMetrics(container, s) {
  const sec = el('div', 'dshu-sec')
  sec.append(el('div', 'dshu-sec-title', '会话指标'))
  const grid = el('div', 'dshu-grid')
  const cells = [
    ['平均命中', `${s.hitRate.toFixed(2)}%`, 'green'],
    ['会话费用', fmtMoney(s.cost), 'amber'],
    ['运行时间', fmtDuration(s.durationMs), ''],
    ['请求数', fmtInt(s.requests), 'blue'],
    ['累计 tokens', fmtInt(s.totalTokens), ''],
    ['主模型占比', `${s.mainShare.toFixed(1)}%`, ''],
  ]
  for (const [k, v, color] of cells) {
    const cell = el('div', 'dshu-cell')
    cell.append(el('div', 'k', k), el('div', `v ${color}`, v))
    grid.append(cell)
  }
  sec.append(grid)
  container.append(sec)
}

function renderAnalysis(container, s) {
  const sec = el('div', 'dshu-sec')
  sec.append(el('div', 'dshu-sec-title', '用量分析'))

  const tabs = el('div', 'dshu-tabs')
  const tSource = el('button', 'dshu-tab', '按来源')
  const tType = el('button', 'dshu-tab', '按类型')
  if (viewState.sourceTab === 'source') tSource.classList.add('on')
  else tType.classList.add('on')
  tSource.onclick = () => { viewState.sourceTab = 'source'; refreshPanel() }
  tType.onclick = () => { viewState.sourceTab = 'type'; refreshPanel() }
  tabs.append(tSource, tType)
  sec.append(tabs)

  if (viewState.sourceTab === 'source') {
    const rows = el('div', 'dshu-rows')
    const share = el('div', 'dshu-share')
    const main = el('i', 'dshu-share-main')
    main.style.width = `${Math.max(0.5, s.mainShare)}%`
    share.append(main)
    if (s.subTokens > 0) {
      const sub = el('i', 'dshu-share-sub')
      sub.style.width = `${Math.max(0.5, 100 - s.mainShare)}%`
      share.append(sub)
    }
    // 主模型行
    const r1 = el('div', 'dshu-row')
    r1.append(el('span', 'k', s.model ? `主模型 · ${s.model}` : '主模型'), el('span', 'v', `${s.mainShare.toFixed(1)}%`))
    rows.append(share, r1)
    const r2 = el('div', 'dshu-row')
    r2.append(
      el('span', 'k', `${fmtInt(s.mainRequests)} 次 · 总计 ${fmtInt(s.mainTokens)} · 缓存 ${s.hitRate.toFixed(2)}% · 费用 ${fmtMoney(s.costMain)}`),
    )
    r2.style.justifyContent = 'flex-start'
    rows.append(r2)
    if (s.subTokens > 0) {
      const r3 = el('div', 'dshu-row')
      r3.append(el('span', 'k', '子代理'), el('span', 'v', `${s.subRequests} 次 · 总计 ${fmtInt(s.subTokens)} · 费用 ${fmtMoney(s.costSub)}`))
      rows.append(r3)
    }
    sec.append(rows)
  } else {
    const rows = el('div', 'dshu-rows')
    const share = el('div', 'dshu-share')
    const inBar = el('i', 'dshu-share-in')
    const outBar = el('i', 'dshu-share-out')
    const total = s.input + s.output
    inBar.style.width = `${total > 0 ? Math.max(0.5, (s.input / total) * 100) : 0}%`
    outBar.style.width = `${total > 0 ? Math.max(0.5, (s.output / total) * 100) : 0}%`
    share.append(inBar, outBar)
    rows.append(share)
    const r1 = el('div', 'dshu-row')
    r1.append(el('span', 'k', '输入'), el('span', 'v', fmtInt(s.input)))
    const r2 = el('div', 'dshu-row')
    r2.append(el('span', 'k', '输出'), el('span', 'v', fmtInt(s.output)))
    rows.append(r1, r2)
    sec.append(rows)
  }

  // 明细
  const detailTitle = el('div', 'dshu-sec-title', '明细')
  sec.append(detailTitle)
  const detailTabs = el('div', 'dshu-tabs')
  const tIo = el('button', 'dshu-tab', '输入/输出')
  const tHit = el('button', 'dshu-tab', '命中/未命中')
  if (viewState.detailTab === 'io') tIo.classList.add('on')
  else tHit.classList.add('on')
  tIo.onclick = () => { viewState.detailTab = 'io'; refreshPanel() }
  tHit.onclick = () => { viewState.detailTab = 'hit'; refreshPanel() }
  detailTabs.append(tIo, tHit)
  sec.append(detailTabs)

  const rows = el('div', 'dshu-rows')
  if (viewState.detailTab === 'io') {
    rows.append(
      kvRow('输入', s.input, `（命中 ${fmtCompact(s.hit)}）`),
      kvRow('输出', s.output, ''),
    )
  } else {
    rows.append(
      kvRow('命中', s.hit, `（${s.hit + s.miss > 0 ? pct(s.hit, s.hit + s.miss).toFixed(2) : 0}%）`),
      kvRow('未命中', s.miss, ''),
    )
  }
  sec.append(rows)
  container.append(sec)
}

function kvRow(k, v, suffix) {
  const r = el('div', 'dshu-row')
  const val = el('span', 'v')
  val.append(fmtInt(v))
  if (suffix) val.append(el('span', 'unit', suffix))
  r.append(el('span', 'k', k), val)
  return r
}

function renderError(container, message) {
  container.append(el('div', 'dshu-err', `加载失败：${message}`))
}

function renderOfficialSection(container, official) {
  const sec = el('div', 'dshu-sec dshu-official')
  const title = el('div', 'dshu-sec-title')
  title.append(el('span', null, '官方账户'), el('span', 'dshu-sub', 'DeepSeek 直连'))
  sec.append(title)

  const hasKey = !!getApiKey()
  const hasToken = !!getPlatformToken()

  if (!hasKey && !hasToken) {
    const hint = el('div', 'dshu-row')
    hint.append(el('span', 'k', '未配置凭证 · 自动探测中…'), el('button', 'dshu-link', '⚙ 配置/手动'))
    hint.querySelector('.dshu-link').onclick = () => openSettings()
    const tip = el('div', 'dshu-field-hint')
    tip.textContent = '自动导入宿主凭证（dshub-1 桥）或双击 setup-key.bat（也可点 ⚙ 手动粘贴）'
    sec.append(hint, tip)
    container.append(sec)
    return
  }

  if (official && official.balance && !official.balance.error) {
    const b = official.balance
    const sym = currencySymbol(b.currency)
    const row = el('div', 'dshu-row')
    const val = el('span', 'v green')
    val.append(`${sym}${b.total.toFixed(2)}`, el('span', 'unit', `充值 ${sym}${b.toppedUp.toFixed(2)} / 赠送 ${sym}${b.granted.toFixed(2)}`))
    row.append(el('span', 'k', `余额${b.available ? '' : '（不可用）'}`), val)
    sec.append(row)
  } else if (official && official.balance && official.balance.error) {
    const row = el('div', 'dshu-row')
    row.append(el('span', 'k', '余额'), el('span', 'v', official.balance.error))
    sec.append(row)
  } else if (hasKey) {
    const row = el('div', 'dshu-row')
    row.append(el('span', 'k', '余额'), el('span', 'v', '查询失败'))
    sec.append(row)
  }

  if (official && official.usage && !official.usage.error) {
    const u = official.usage
    const sym = currencySymbol(u.currency)
    const r1 = el('div', 'dshu-row')
    r1.append(el('span', 'k', '今日费用'), el('span', 'v', u.todayCost !== null ? `${sym}${u.todayCost.toFixed(4)}` : '—'))
    const r2 = el('div', 'dshu-row')
    r2.append(el('span', 'k', '本月费用'), el('span', 'v', u.monthCost !== null ? `${sym}${u.monthCost.toFixed(4)}` : '—'))
    const r3 = el('div', 'dshu-row')
    r3.append(el('span', 'k', `本月 ${fmtInt(u.monthTokens)} tokens · ${fmtInt(u.monthRequests)} 请求`), el('span', 'v', u.topModel || '—'))
    r3.style.justifyContent = 'flex-start'
    const r4 = el('div', 'dshu-row')
    r4.append(
      el('span', 'k', `今日 ${fmtInt(u.todayTokens)} tokens`),
      el('span', 'v', `命中 ${fmtCompact(u.hitTokens)} / 未命中 ${fmtCompact(u.missTokens)} / 输出 ${fmtCompact(u.outputTokens)}`),
    )
    sec.append(r1, r2, r3, r4)
  } else if (hasToken && official && official.usage && official.usage.error) {
    const row = el('div', 'dshu-row')
    row.append(el('span', 'k', '平台费用'), el('span', 'v', official.usage.error))
    sec.append(row)
  } else if (hasToken) {
    const row = el('div', 'dshu-row')
    row.append(el('span', 'k', '平台费用'), el('span', 'v', '查询失败（浏览器直连被拦，请用扩展或油猴版）'))
    sec.append(row)
  }

  const foot = el('div', 'dshu-ctx-foot')
  const left = el('span', null, hasKey ? '余额：官方 API' : '费用：官方平台')
  const right = el('button', 'dshu-link', '⚙ 配置')
  right.onclick = () => openSettings()
  foot.append(left, right)
  sec.append(foot)
  container.append(sec)
}

/** 设置弹层：粘贴 API Key（余额）与平台 userToken（官方费用），仅存本机 localStorage。 */
function openSettings() {
  if (!shadow) return
  const panel = shadow.querySelector('.dshu-panel')
  if (!panel) return
  let overlay = shadow.querySelector('.dshu-settings')
  if (overlay) { overlay.style.display = ''; return }
  overlay = el('div', 'dshu-settings')
  const card = el('div', 'dshu-settings-card')
  const title = el('div', 'dshu-sec-title')
  title.append(el('span', null, '官方账户配置'), el('button', 'dshu-btn dshu-settings-close', '✕'))
  title.querySelector('.dshu-settings-close').onclick = () => { overlay.style.display = 'none' }
  card.append(title)

  const mkField = (label, storageName, placeholder, hint) => {
    const wrap = el('div', 'dshu-field')
    wrap.append(el('div', 'k', label))
    const input = el('input')
    input.type = 'password'
    input.placeholder = placeholder
    input.value = getStoredCredential(storageName)
    const save = el('button', 'dshu-btn', '保存')
    save.onclick = () => { setStoredCredential(storageName, input.value.trim()); refreshData(); overlay.style.display = 'none' }
    const clear = el('button', 'dshu-btn', '清除')
    clear.onclick = () => { input.value = ''; setStoredCredential(storageName, ''); refreshData(); overlay.style.display = 'none' }
    const bar = el('div', 'dshu-field-bar')
    bar.append(input, save, clear)
    wrap.append(bar, el('div', 'dshu-field-hint', hint))
    return wrap
  }

  card.append(mkField(
    'API Key（查余额）',
    STORAGE_KEY,
    'sk-…',
    'platform.deepseek.com → API Keys 创建。仅存本机浏览器，请求只发往 api.deepseek.com（CORS 已放行，全形态可用）。',
  ))
  card.append(mkField(
    '平台 userToken（官方费用/用量）',
    STORAGE_TOKEN,
    '粘贴 userToken',
    '登录 platform.deepseek.com 后 F12 → Application → Local Storage → 复制 userToken。请求发往 platform.deepseek.com，页面直连被 CORS 拦截，需扩展或油猴版（自动走后台桥）。',
  ))
  const note = el('div', 'dshu-field-hint')
  note.textContent = '凭证不出本机、不进任何日志；会话级费用仍为本地估算（官方无按会话计费接口），账户级余额/费用为官方准确值。'
  card.append(note)
  overlay.append(card)
  panel.append(overlay)
}

const OFFICIAL_CSS = `
.dshu-link {
  background: none; border: none; color: var(--dsw-alias-state-business-primary, rgb(103, 158, 254)); cursor: pointer;
  font-size: 11px; padding: 0; text-decoration: underline;
}
.dshu-official { border-radius: 8px; padding: 8px 10px; background: var(--dsw-specific-input-major, rgb(24, 24, 26)); }
.dshu-field { margin-bottom: 10px; }
.dshu-field .k { font-size: 11px; color: var(--dsw-alias-label-tertiary, rgb(151, 157, 166)); margin-bottom: 4px; }
.dshu-field-bar { display: flex; gap: 6px; }
.dshu-field-bar input {
  flex: 1; min-width: 0; background: var(--dsw-alias-button-floating-fill, rgb(33, 33, 35)); border: 1px solid var(--dsw-static-neutral-bluish-800, rgb(53, 54, 56));
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242)); border-radius: 6px; padding: 5px 8px; font-size: 12px;
}
.dshu-field-hint { font-size: 10px; color: var(--dsw-alias-label-dimmed, rgb(101, 103, 107)); margin-top: 4px; line-height: 1.5; }
.dshu-settings {
  position: absolute; inset: 0; background: rgba(10, 10, 12, 0.9); z-index: 2;
  display: flex; align-items: flex-start; justify-content: center; padding: 14px;
}
.dshu-settings-card {
  width: 100%; background: var(--dsw-specific-sidebar-fill, rgb(27, 27, 28)); border: 1px solid var(--dsw-static-neutral-bluish-800, rgb(53, 54, 56));
  border-radius: 10px; padding: 12px; max-height: 100%; overflow-y: auto;
}
`

/**
 * 加载状态开关（引用计数）。
 * 仅在"首次加载（尚无数据）或会话切换后的第一次请求"显示模糊遮罩 + 转圈；
 * 后续周期刷新 / 手动刷新直接静默更新数据，不再显示遮罩。
 */
function setLoading(on) {
  if (on) loadingCount += 1
  else loadingCount = Math.max(0, loadingCount - 1)
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null }
  if (loadingCount > 0) {
    // 首次加载 / 会话切换后的第一次请求 → 立即遮罩；常规刷新静默，不显示
    if (!lastStats || sessionSwitching) applyLoading(true)
  } else {
    applyLoading(false)
    sessionSwitching = false
  }
}

/** 同步检测会话是否切换（只读 localStorage，无网络开销）。切换时更新 displayedSessionId。 */
function checkSessionSwitch() {
  try {
    const raw = localStorage.getItem('dsh.sessions.current')
    if (!raw) return false
    const parsed = JSON.parse(raw)
    const id = parsed && typeof parsed.sessionId === 'string' ? parsed.sessionId : null
    if (!id) return false
    if (displayedSessionId !== id) {
      displayedSessionId = id
      return true
    }
  } catch { /* noop */ }
  return false
}

/**
 * 会话切换监听：轮询 localStorage 的当前会话键（GUI 切换窗口/会话时更新该键）。
 * 检测到切换 → 立即显示模糊遮罩并立刻发起刷新，不等下一个 5s 周期。
 */
function watchSessionChanges() {
  if (sessionWatchTimer) return
  sessionWatchTimer = setInterval(() => {
    if (checkSessionSwitch()) {
      sessionSwitching = true
      applyLoading(true)
      void refreshData()
    }
  }, 400)
  if (sessionWatchTimer.unref) sessionWatchTimer.unref()
}

/** 测试探针：观察遮罩显隐（生产环境恒为 null，由 _internal.setLoadingTracer 设置）。 */
let loadingTracer = null

/** 应用加载遮罩的显隐（模糊层 + 旋转等待），并让右上角刷新按钮同步旋转。 */
function applyLoading(show) {
  if (loadingTracer) { try { loadingTracer(show) } catch { /* noop */ } }
  if (!shadow) return
  const overlay = shadow.querySelector('.dshu-loading')
  if (overlay) overlay.classList.toggle('on', show)
  const btn = shadow.querySelector('.dshu-icon-btn.refresh')
  if (btn) btn.classList.toggle('spinning', show)
}

/** 等待占位：行内小号旋转指示器 + 文案。 */
function waitNode(text) {
  const node = el('div', 'dshu-wait')
  node.append(el('span', 'dshu-spinner-sm'), el('span', null, text))
  return node
}

function refreshPanel() {
  if (!shadow) return
  const body = shadow.querySelector('.dshu-body')
  if (!body) return
  body.textContent = ''
  if (lastError) {
    body.append(el('div', 'dshu-err', `加载失败：${lastError}`))
    const foot = shadow.querySelector('.dshu-foot-time')
    if (foot) foot.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
    return
  }
  if (!lastStats) {
    body.append(waitNode('等待会话数据…'))
    return
  }
  const s = lastStats
  renderContextSection(body, s)
  renderMetrics(body, s)
  renderAnalysis(body, s)
  renderOfficialSection(body, lastOfficial)
  // 工作区文件独立渲染到"文件"视图（与"用量"视图切换显示）
  refreshFilesSection()
  const foot = shadow.querySelector('.dshu-foot-time')
  if (foot) foot.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
}

/**
 * 拉取尾页（最后 maxMessages 条 message 对应的事件，轻量），投影只在尾页携带。
 * 大会话单页事件可达数万条，但远小于全量；常规刷新走这里。
 */
async function fetchSessionTail(sessionId, maxMessages = 5) {
  const pageValue = await rpc('session.history', { sessionId, maxMessages })
  return { events: pageValue.events || [], projections: pageValue.projections }
}

/** 加载包装：进入/退出时切换模糊遮罩 + 旋转等待指示（实际逻辑在 refreshDataCore）。 */
async function refreshData() {
  const seq = ++refreshSeq // 本帧代次：结束后只有仍是最新代次才允许渲染
  if (checkSessionSwitch()) sessionSwitching = true // 会话已切换 → 本次加载立即遮罩
  setLoading(true)
  try {
    await refreshDataCore(seq)
  } finally {
    setLoading(false)
  }
}

async function refreshDataCore(seq) {
  try {
    const sessionId = await resolveSessionId()
    // 会话已切换：立即作废旧会话的回合用量映射，避免旧数据短暂标注到新会话
    if (turnUsage && turnUsage.sessionId !== sessionId) {
      turnUsage = null
      turnUsagePromise = null
    }
    if (shadow) {
      const label = shadow.querySelector('.dshu-session')
      if (label) {
        label.textContent = sessionId ? sessionId.slice(0, 8) : '…'
        label.title = sessionId || ''
      }
    }
    if (!sessionId) {
      lastStats = null
      if (seq === refreshSeq) refreshPanel()
      return
    }

    // 首次/切换会话：全量拉一次，缓存会话首事件时间与主模型（含 localStorage 持久化）
    let firstTs = undefined
    let model = undefined
    const cached = firstTsCache || loadFirstTsCache()
    if (cached && cached.sessionId === sessionId) {
      firstTs = cached.firstTs
      model = cached.model
    } else {
      const { events } = await fetchSession(sessionId)
      let fTs
      let m
      for (const entry of events) {
        const event = entry && entry.event ? entry.event : entry
        const ts = typeof event.time === 'number' ? event.time : typeof event.ts === 'number' ? event.ts : undefined
        if (ts !== undefined && (fTs === undefined || ts < fTs)) fTs = ts
        if (event.type === 'assistant/message') {
          const source = event.data && event.data.message && event.data.message.source
          if (source && typeof source.model === 'string') m = source.model
        }
      }
      firstTsCache = { sessionId, firstTs: fTs, model: m }
      saveFirstTsCache()
      firstTs = fTs
      model = m
      // 会话首次全量拉取时顺带构建回合用量映射（避免二次全量）
      if (CONFIG.annotateMessages) {
        turnUsage = { sessionId, steps: new Map() }
        mergeTurnSteps(turnUsage.steps, events)
      }
    }

    // 常规刷新：只拉尾页（轻量），投影提供全部累计值
    const { events: tailEvents, projections } = await fetchSessionTail(sessionId, 5)
    let lastTs
    for (const entry of tailEvents) {
      const event = entry && entry.event ? entry.event : entry
      const ts = typeof event.time === 'number' ? event.time : typeof event.ts === 'number' ? event.ts : undefined
      if (ts !== undefined && (lastTs === undefined || ts > lastTs)) lastTs = ts
    }

    // 会话工作目录：会话切换时从 session.list 取一次（文件区块用）
    if (!filesState.root || filesState.sessionId !== sessionId) {
      let cwd
      try {
        const list = await rpc('session.list', {})
        const row = (list.items || []).find(i => i.sessionId === sessionId)
        cwd = row ? row.cwd : undefined
      } catch { /* noop */ }
      resetFilesState(cwd)
      filesState.sessionId = sessionId
    }

    const subagents = await fetchSubagentUsage(sessionId)
    lastStats = computeStats({
      events: tailEvents,
      projections,
      subagents,
      firstTs,
      lastTs,
      model,
      cwd: filesState.root,
      requests: undefined, // 由 sessionStats.steps 或事件折叠得出
    })
    lastError = null
    log('stats', lastStats)
    if (seq === refreshSeq) {
      refreshPanel()
      // 消息标注：增量并入尾页事件（新回合/进行中回合），刷新标注（会话切换时丢弃过期帧）
      void refreshTurnAnnotations(sessionId, tailEvents)
    }
  } catch (e) {
    log('refresh failed', e)
    lastError = e && e.message ? e.message : String(e)
    if (seq === refreshSeq) refreshPanel()
  }

  // 官方账户数据：独立节流（默认 60s 一次），与面板 5s 刷新解耦
  const now = Date.now()
  const hasCredential = !!(getApiKey() || getPlatformToken())
  if (hasCredential && now - lastOfficialAt >= CONFIG.officialRefreshMs) {
    lastOfficialAt = now
    lastOfficial = await refreshOfficial()
    log('official', lastOfficial)
    if (seq === refreshSeq) refreshPanel()
  }

  // 无 API Key 时自动探测本地凭证服务（setup-key 工具），导入后立即刷新官方数据
  if (!hasCredential && (await autoImportApiKey())) {
    lastOfficial = await refreshOfficial()
    log('official after auto-import', lastOfficial)
    if (seq === refreshSeq) refreshPanel()
  }
}

/* ===================== 消息标注（每条回合底部的用量/费用） =====================
 * 在聊天区每个已完成回合的 turn-tail（[data-turn-tail="N"]）里、复制按钮旁，
 * 注入"↑ 输入 X · ↓ 输出 Y · 费用"标注。数据源为 session.history 事件：
 *   assistant/message 的 data.usage（含 inputTokens/cacheReadTokens/
 *   cacheWriteTokens/outputTokens/reasoningTokens）与 data.message.source.model；
 *   assistant/chunk 事件（chunk.type = 'usage'）同形状（两者按 turn:step 后者覆盖前者）。
 * 回合 = 一次用户请求的完整执行（可能含多个 agent 步骤），输入/输出按回合求和。
 * 会话切换时全量拉取一次构建映射；常规刷新把尾页事件增量并入（新回合/进行中
 * 回合的步骤），MutationObserver 兜底 React 重渲染，增量数据到达后原位更新。
 */
let turnUsage = null // { sessionId, steps: Map<"turn:step", {input,output,hit,miss,reasoning,model}> }
let turnUsagePromise = null // 全量构建中的 promise（防并发重复拉取）
let annotateObserver = null
let annotateTimer = null
let annotateStyleEl = null

const ANNOTATE_CSS = `
.dshu-msg-usage {
  display: inline-flex; align-items: center; gap: 3px; margin: 0 2px 0 6px;
  font-size: 10.5px; line-height: 1; white-space: nowrap;
  color: var(--dsw-alias-label-dimmed, rgb(101, 103, 107));
  user-select: text; cursor: default;
}
.dshu-msg-usage b {
  font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
}
.dshu-msg-usage .dshu-msg-cost {
  font-weight: 600; font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-state-warn-secondary, rgb(247, 173, 49));
}
.dshu-msg-usage .dshu-msg-sep { opacity: .7; }
`

/** 把事件流里的 usage 按 "turn:step" 并入 stepsMap（后者覆盖前者：message 优先于 chunk）。 */
function mergeTurnSteps(stepsMap, events) {
  for (const entry of events || []) {
    const event = entry && entry.event ? entry.event : entry
    const data = event && event.data
    if (!data || typeof data.turn !== 'number') continue
    let usage
    let model
    if (event.type === 'assistant/message' && data.usage) {
      usage = data.usage
      const src = data.message && data.message.source
      if (src && typeof src.model === 'string') model = src.model
    } else if (event.type === 'assistant/chunk'
      && data.chunk && data.chunk.type === 'usage' && data.chunk.usage) {
      usage = data.chunk.usage
    } else {
      continue
    }
    stepsMap.set(`${data.turn}:${data.step}`, {
      input: (usage.inputTokens || 0) + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0),
      output: usage.outputTokens || 0,
      hit: usage.cacheReadTokens || 0,
      miss: (usage.inputTokens || 0) + (usage.cacheWriteTokens || 0),
      reasoning: usage.reasoningTokens || 0,
      model,
    })
  }
}

/** 回合汇总：把该 turn 全部步骤相加；无用量返回 null。 */
function turnTotals(stepsMap, turn) {
  let input = 0
  let output = 0
  let hit = 0
  let miss = 0
  let reasoning = 0
  let model
  for (const [key, s] of stepsMap) {
    const idx = key.indexOf(':')
    if (idx <= 0 || Number(key.slice(0, idx)) !== turn) continue
    input += s.input; output += s.output; hit += s.hit; miss += s.miss; reasoning += s.reasoning
    if (s.model) model = s.model
  }
  if (input === 0 && output === 0) return null
  return { input, output, hit, miss, reasoning, model, cost: costOf(model, hit, miss, output) }
}

/** 确保当前会话的回合用量映射已构建（每会话一次全量拉取，可并发安全）。 */
function ensureTurnUsage(sessionId) {
  if (turnUsage && turnUsage.sessionId === sessionId) return Promise.resolve(turnUsage)
  if (turnUsagePromise) return turnUsagePromise
  turnUsage = { sessionId, steps: new Map() } // 先占位作废旧会话数据
  async function buildTurnUsage() {
    try {
      const { events } = await fetchSession(sessionId)
      if (turnUsage && turnUsage.sessionId === sessionId) mergeTurnSteps(turnUsage.steps, events)
    } catch (e) {
      log('turn usage build failed', e)
    }
    return turnUsage
  }
  turnUsagePromise = buildTurnUsage().finally(() => { turnUsagePromise = null })
  return turnUsagePromise
}

/** 刷新回合标注：确保映射就绪 → 增量并入尾页事件 → 重新标注（新回合/数据变化时原位更新）。 */
async function refreshTurnAnnotations(sessionId, tailEvents) {
  if (!CONFIG.annotateMessages) return
  try {
    const usage = await ensureTurnUsage(sessionId)
    if (!usage || usage.sessionId !== sessionId) return
    mergeTurnSteps(usage.steps, tailEvents)
    annotateMessages()
  } catch (e) {
    log('turn annotation failed', e)
  }
}

/** 构建单条用量标注（"↑ 输入 X · ↓ 输出 Y · 费用"），悬停显示模型/命中/推理明细。 */
function makeUsageChip(totals) {
  const chip = el('span', 'dshu-msg-usage')
  chip._dshuUpdate = (t) => {
    chip.textContent = ''
    chip.append(
      el('span', 'dshu-msg-sep', '↑'), ' ', el('b', null, fmtCompact(t.input)),
      ' ', el('span', 'dshu-msg-sep', '· ↓'), ' ', el('b', null, fmtCompact(t.output)),
      ' ', el('span', 'dshu-msg-cost', fmtMoney(t.cost)),
    )
    const parts = []
    if (t.model) parts.push(t.model)
    parts.push(`输入 ${fmtInt(t.input)} · 输出 ${fmtInt(t.output)}`)
    parts.push(`命中 ${fmtInt(t.hit)} / 未命中 ${fmtInt(t.miss)}`)
    if (t.reasoning > 0) parts.push(`推理 ${fmtInt(t.reasoning)}`)
    parts.push(`费用 ${fmtMoney(t.cost)}`)
    chip.title = parts.join(' · ')
  }
  chip._dshuUpdate(totals)
  return chip
}

/** 扫描聊天区所有回合尾部，注入/更新用量标注（插在复制按钮旁，无则追加到回合尾）。 */
function annotateMessages() {
  if (!CONFIG.annotateMessages || !turnUsage) return
  const tails = document.querySelectorAll('[data-turn-tail]')
  for (const tail of tails) {
    const turn = Number(tail.getAttribute('data-turn-tail'))
    if (!Number.isFinite(turn)) continue
    const totals = turnTotals(turnUsage.steps, turn)
    const chip = tail.querySelector('.dshu-msg-usage')
    if (!totals) {
      if (chip) chip.remove()
      continue
    }
    if (chip) {
      if (chip._dshuUpdate) chip._dshuUpdate(totals)
      continue
    }
    const copyBtn = tail.querySelector('button[aria-label="复制"], button[aria-label="Copy"]')
    const made = makeUsageChip(totals)
    if (copyBtn) copyBtn.insertAdjacentElement('afterend', made)
    else tail.append(made)
  }
}

/** 标注样式注入页面（标注在页面 DOM，不在面板 shadow 内）。 */
function ensureAnnotateStyle() {
  if (annotateStyleEl || !document || !document.head) return
  annotateStyleEl = document.createElement('style')
  annotateStyleEl.textContent = ANNOTATE_CSS
  document.head.appendChild(annotateStyleEl)
}

/** 监听聊天区 DOM 变化（React 重渲染/新回合完成），防抖后重新标注。 */
function startAnnotateObserver() {
  if (annotateObserver || !CONFIG.annotateMessages || !document || !document.body) return
  annotateObserver = new MutationObserver(() => {
    if (annotateTimer) clearTimeout(annotateTimer)
    annotateTimer = setTimeout(() => { annotateTimer = null; annotateMessages() }, 300)
  })
  annotateObserver.observe(document.body, { childList: true, subtree: true })
}

/* ============================== 挂载（嵌入页面右侧列） ==============================
 * 页面根布局是 DSH 的三轨 grid（sidebar | center | details）。本面板作为追加的
 * 第 4 列嵌入 grid 最右侧，并把 grid-template-columns 末尾追加 336px 轨道——
 * 真正的页面内嵌（对话区被挤压），不是悬浮覆盖，观感与原生 details 列一致。
 * MutationObserver 兜底 React 重渲染对 grid 样式/子节点的改写。
 */
const COL_WIDTH = 336
let frame = null
let colObserver = null

function findFrame() {
  const all = document.querySelectorAll('div')
  for (const d of all) {
    if (d.style && typeof d.style.gridTemplateColumns === 'string'
      && d.style.gridTemplateColumns.includes('minmax(')
      && d.style.gridTemplateColumns.includes('1fr')) return d
  }
  return null
}

/** 确保我们的列作为 grid 第 4 个子元素存在，且模板以追加轨道结尾。 */
function applyColumn() {
  if (!frame || !hostEl || !frame.isConnected) return
  if (hostEl.parentNode !== frame) frame.appendChild(hostEl)
  const cur = frame.style.gridTemplateColumns || ''
  if (cur && !cur.endsWith(`${COL_WIDTH}px`)) {
    frame.style.gridTemplateColumns = `${cur} ${COL_WIDTH}px`
  }
}

/** 轮询等待 AppFrame（React SPA 挂载晚于 document-idle）。 */
function waitFrame(callback) {
  const found = findFrame()
  if (found) { callback(found); return }
  let tries = 0
  const timer = setInterval(() => {
    const f = findFrame()
    if (f || ++tries > 60) {
      clearInterval(timer)
      if (f) callback(f)
    }
  }, 500)
}

function mount() {
  if (hostEl) return
  hostEl = document.createElement('div')
  hostEl.id = 'dsh-usage-display-host'
  hostEl.style.width = `${COL_WIDTH}px`
  hostEl.style.height = '100%'
  hostEl.style.minWidth = '0'
  hostEl.style.overflow = 'hidden'
  hostEl.style.borderLeft = '1px solid var(--dsw-alias-border-l2, rgb(53, 54, 56))'
  hostEl.style.background = 'var(--dsw-alias-bg-base, rgb(21, 21, 23))'
  shadow = hostEl.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = CSS + OFFICIAL_CSS + FILES_CSS
  shadow.append(style)

  const panel = el('div', 'dshu-panel')

  // 主视图切换：[用量] [文件]（工作区文件与上下文窗口不同时展示）；
  // 无头部条：刷新/设置/关闭以无边框小按钮并入 tab 行右侧
  const mainTabs = el('div', 'dshu-main-tabs')
  const tabUsage = el('button', 'dshu-main-tab on', '用量')
  tabUsage.dataset.tab = 'usage'
  const tabFiles = el('button', 'dshu-main-tab', '文件')
  tabFiles.dataset.tab = 'files'
  const actions = el('div', 'dshu-main-actions')
  const btnRefresh = el('button', 'dshu-icon-btn refresh', '⟳')
  btnRefresh.title = '立即刷新'
  btnRefresh.onclick = () => { refreshData() }
  const btnSettings = el('button', 'dshu-icon-btn', '⚙')
  btnSettings.title = '官方账户配置（余额/费用）'
  btnSettings.onclick = () => openSettings()
  const btnClose = el('button', 'dshu-icon-btn', '✕')
  btnClose.title = '关闭面板（恢复页面布局；刷新页面可重新启用）'
  btnClose.onclick = () => destroy()
  actions.append(btnRefresh, btnSettings, btnClose)
  const body = el('div', 'dshu-body')
  body.append(waitNode('等待会话数据…'))
  const filesView = el('div', 'dshu-files-view')
  filesView.style.display = 'none'
  const foot = el('div', 'dshu-foot')
  foot.append(el('span', null, '数据源 session.history'), el('span', 'dshu-foot-time', ''))

  const switchMainTab = (tab) => {
    viewState.mainTab = tab
    body.style.display = tab === 'usage' ? '' : 'none'
    filesView.style.display = tab === 'files' ? '' : 'none'
    tabUsage.classList.toggle('on', tab === 'usage')
    tabFiles.classList.toggle('on', tab === 'files')
    if (tab === 'files' && filesView.childElementCount === 0) refreshFilesSection()
  }
  tabUsage.onclick = () => switchMainTab('usage')
  tabFiles.onclick = () => switchMainTab('files')
  mainTabs.append(tabUsage, tabFiles, actions)

  panel.append(mainTabs, body, filesView, foot)

  // 加载中模糊遮罩（旋转等待）：仅首次加载与会话切换后的第一次请求期间显示，
  // 常规刷新静默更新数据
  const loadingOverlay = el('div', 'dshu-loading')
  loadingOverlay.append(el('div', 'dshu-spinner'), el('div', 'dshu-loading-text', '正在加载数据…'))
  panel.append(loadingOverlay)

  shadow.append(panel)

  // 嵌入右侧列：等待 AppFrame 出现后挂为 grid 第 4 列
  waitFrame((f) => {
    frame = f
    f.appendChild(hostEl)
    applyColumn()
    colObserver = new MutationObserver(() => applyColumn())
    colObserver.observe(f, { attributes: true, attributeFilter: ['style'], childList: true })
  })

  checkSessionSwitch() // 初始化已展示会话，避免会话监听首轮误触发
  watchSessionChanges() // 切换会话/窗口 → 立即遮罩并立刻刷新
  if (CONFIG.annotateMessages) {
    ensureAnnotateStyle() // 消息标注样式（页面 DOM 用）
    startAnnotateObserver() // 聊天区 DOM 变化 → 标注/更新
  }
  refreshData()
  refreshTimer = setInterval(refreshData, CONFIG.refreshMs)
  if (refreshTimer.unref) refreshTimer.unref()
}

function destroy() {
  if (domReadyHandler && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
    document.removeEventListener('DOMContentLoaded', domReadyHandler)
    domReadyHandler = null
  }
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
  if (sessionWatchTimer) { clearInterval(sessionWatchTimer); sessionWatchTimer = null }
  if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null }
  if (annotateObserver) { annotateObserver.disconnect(); annotateObserver = null }
  if (annotateTimer) { clearTimeout(annotateTimer); annotateTimer = null }
  if (annotateStyleEl) { annotateStyleEl.remove(); annotateStyleEl = null }
  refreshSeq += 1 // 作废仍在途的刷新结果
  loadingCount = 0
  sessionSwitching = false
  displayedSessionId = null
  turnUsage = null
  turnUsagePromise = null
  if (typeof document !== 'undefined') {
    // 移除已注入到聊天区的用量标注
    document.querySelectorAll('.dshu-msg-usage').forEach(n => n.remove())
  }
  if (colObserver) { colObserver.disconnect(); colObserver = null }
  if (frame && hostEl) {
    // 恢复 grid 模板：去掉追加的轨道
    const cur = frame.style.gridTemplateColumns || ''
    const suffix = ` ${COL_WIDTH}px`
    if (cur.endsWith(suffix)) frame.style.gridTemplateColumns = cur.slice(0, -suffix.length)
    if (hostEl.parentNode === frame) hostEl.remove()
  }
  frame = null
  if (hostEl) { hostEl.remove(); hostEl = null; shadow = null }
  lastStats = null
  lastOfficial = null
  lastOfficialAt = 0
  resetFilesState(undefined)
}

/* ============================== 入口 ====================================== */
const api = {
  CONFIG,
  refresh: refreshData,
  destroy,
  computeStats,
  foldUsageFromEvents,
  fetchBalance: fetchOfficialBalance,
  fetchPlatformUsage: fetchOfficialPlatformUsage,
  autoImportApiKey,
  _internal: { resolveSessionId, fetchSession, fetchSessionTail, fetchSubagentUsage, fmtCompact, fmtInt, fmtMoney, fmtDuration, aggregateOfficialUsage, checkSessionSwitch, setLoading, mergeTurnSteps, turnTotals,
    // 测试探针（Node 无 DOM 环境验证加载状态机）：
    setLoadingTracer: (fn) => { loadingTracer = typeof fn === 'function' ? fn : null },
    setSessionSwitching: (v) => { sessionSwitching = !!v },
    setLastStats: (v) => { lastStats = v },
  },
}

;(function init() {
  // Node/测试环境没有 document，不自动挂载面板（通过 __DSH_USAGE_DISPLAY 调用核心逻辑）
  if (typeof document === 'undefined') return
  if (document.readyState === 'loading') {
    domReadyHandler = () => {
      domReadyHandler = null
      mount()
    }
    document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true })
  } else {
    mount()
  }
})()

// 暴露调试/控制 API（页面世界）
if (typeof globalThis !== 'undefined') {
  globalThis.__DSH_USAGE_DISPLAY = api
}

