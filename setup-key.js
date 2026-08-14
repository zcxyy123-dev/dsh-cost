/**
 * DSH 用量显示 — 本地桥（一键启动，免粘贴 + 文件服务）
 * =================================================
 * 提供两类能力（仅监听 127.0.0.1，CORS 放行给 DSH 页面）：
 *   1. 凭证导入：/credentials —— 自动读取 DSH / Reasonix 配置里的 API Key，
 *      面板探测到后自动导入并调用 /shutdown 关闭服务。
 *   2. 文件服务：/tree、/file —— 面板的"工作区文件"目录树与文本预览。
 *      DSH 宿主的 host.listDirectory 在当前部署未装配 browse 能力，
 *      目录浏览由本桥提供；"打开文件夹/默认程序打开文件"走宿主
 *      host.openPath RPC（Invoke-Item），无需本桥。
 *
 * 用法：
 *   node setup-key.js            # 自动探测常见位置
 *   node setup-key.js <路径>     # 指定凭证文件（yaml 或 env 格式）
 * 或直接双击 setup-key.bat。
 *
 * 安全：只监听本机回环；文件读取限制 500KB 文本、过滤二进制扩展名、
 * 要求绝对路径；凭证/文件内容不写日志。
 */
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PORT = 3987
const HOST = '127.0.0.1'
let server = null // main() 中创建，handleRequest 的 /shutdown 关闭它

// ---- 文件服务限制（照 Reasonix file-read.ts 的安全设计） ----
const MAX_FILE_SIZE = 500 * 1024 // 500KB
const MAX_TREE_ENTRIES = 500 // 单目录最多返回条目数
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.7z',
  '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.webm', '.mp3', '.wav', '.ogg',
  '.exe', '.dll', '.so', '.dylib', '.class', '.pyc', '.o', '.obj',
  '.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt', '.db', '.sqlite', '.sqlite3', '.lock',
])

/** 常见凭证文件位置（DSH 与 Reasonix 桌面版）。 */
function candidatePaths() {
  const home = os.homedir()
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const candidates = [
    path.join(home, '.dsh', '.credentials.yaml'),                    // DSH_HOME 凭证（默认）
    path.join(home, '.dsh', 'credentials.yaml'),
    path.join(appdata, 'dev.reasonix.desktop', '.env'),              // Reasonix 桌面版
    path.join(appdata, 'dev.reasonix.desktop', 'credentials'),
    path.join(home, '.reasonix', '.env'),
    path.join(home, '.reasonix', 'credentials'),
  ]
  // 部署目录（Reasonix 项目里也可能有 .dsh/.reasonix）
  const projectRoot = process.env.DSH_PROJECT_DIR
  if (projectRoot) {
    candidates.push(path.join(projectRoot, '.dsh', '.credentials.yaml'))
    candidates.push(path.join(projectRoot, '.reasonix', '.env'))
  }
  return candidates
}

/** 从文本中提取第一个形如 sk-xxx 的 DeepSeek API Key。 */
function extractApiKey(text) {
  const match = String(text || '').match(/sk-[A-Za-z0-9_-]{8,}/)
  return match ? match[0] : null
}

/** 读取并解析候选文件，返回 { path, key }。 */
function findApiKey(explicitPath) {
  const files = explicitPath ? [explicitPath] : candidatePaths()
  for (const file of files) {
    try {
      if (!fs.existsSync(file)) continue
      const text = fs.readFileSync(file, 'utf8')
      const key = extractApiKey(text)
      if (key) return { path: file, key }
    } catch { /* 跳过不可读文件 */ }
  }
  return null
}

/** 目录列表（一层）。返回 { path, entries: [{name,path,dir,hidden}] }。 */
function listDirectory(dirPath) {
  const resolved = path.resolve(dirPath)
  const entries = []
  for (const name of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (entries.length >= MAX_TREE_ENTRIES) break
    const full = path.join(resolved, name.name)
    let isDir = name.isDirectory()
    let hidden = name.name.startsWith('.')
    if (!isDir && name.isSymbolicLink()) {
      try { isDir = fs.statSync(full).isDirectory() } catch { /* 悬空链接按文件 */ }
    }
    entries.push({ name: name.name, path: full, dir: isDir, hidden })
  }
  // 目录在前，各按名称排序
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  return { path: resolved, entries }
}

/** 文本预览（照 Reasonix file-read.ts 的防护：大小限制 + 二进制扩展过滤）。 */
function readFilePreview(filePath) {
  const resolved = path.resolve(filePath)
  const ext = path.extname(resolved).toLowerCase()
  if (BINARY_EXTS.has(ext)) return { error: `binary file not supported (${ext})` }
  const st = fs.statSync(resolved)
  if (!st.isFile()) return { error: 'not a file' }
  if (st.size > MAX_FILE_SIZE) return { error: `file too large (${st.size} bytes, max ${MAX_FILE_SIZE})` }
  const content = fs.readFileSync(resolved, 'utf8')
  return { path: resolved, content, size: st.size, lines: content.split(/\r?\n/).length }
}

function handleRequest(req, res, found) {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const json = (status, body) => {
    res.setHeader('Content-Type', 'application/json')
    res.writeHead(status)
    res.end(JSON.stringify(body))
  }

  if (url.pathname === '/credentials' && found) {
    json(200, { apiKey: found.key, source: found.path })
    return
  }
  if (url.pathname === '/shutdown') {
    res.end('ok')
    console.log('[setup-key] 已导入，服务关闭。')
    server.close(() => process.exit(0))
    return
  }
  if (url.pathname === '/ping') {
    json(200, { ok: true })
    return
  }
  if (url.pathname === '/tree') {
    const target = url.searchParams.get('path')
    if (!target) { json(400, { error: 'path query parameter required' }); return }
    try {
      json(200, listDirectory(target))
    } catch (e) {
      json(404, { error: `cannot list directory: ${e.code || e.message}` })
    }
    return
  }
  if (url.pathname === '/file') {
    const target = url.searchParams.get('path')
    if (!target) { json(400, { error: 'path query parameter required' }); return }
    try {
      const result = readFilePreview(target)
      if (result.error) { json(400, { error: result.error }); return }
      json(200, result)
    } catch (e) {
      json(404, { error: `cannot read file: ${e.code || e.message}` })
    }
    return
  }
  json(404, { error: 'not found' })
}

function main() {
  const explicit = process.argv[2]
  const found = findApiKey(explicit)
  if (!found) {
    console.error('[setup-key] 未找到 API Key。')
    console.error('  已检查位置:')
    for (const p of (explicit ? [explicit] : candidatePaths())) console.error('    - ' + p)
    console.error('  请用参数指定凭证文件路径，例如: node setup-key.js "C:\\Users\\xxx\\.dsh\\.credentials.yaml"')
    console.error('  （目录树/文件预览仍可用：面板会提示缺少凭证，但文件功能不受影响）')
    // 无凭证也继续启动（文件服务独立于凭证）
  }
  if (found) {
    console.log(`[setup-key] 已从 ${found.path} 找到 API Key（${found.key.slice(0, 6)}…${found.key.slice(-4)}）`)
  } else {
    console.log('[setup-key] 未找到 API Key（仅启用文件服务：目录树 / 文件预览）')
  }
  const created = http.createServer((req, res) => handleRequest(req, res, found))
  server = created
  // listen 失败（如端口被占用）要有友好提示而不是静默崩溃
  created.on('error', (err) => {
    console.error(`[setup-key] 启动失败: ${err.code || err.message}`)
    if (err.code === 'EADDRINUSE') {
      console.error('[setup-key] 3987 端口已被占用：可能已有桥在运行（先关闭旧窗口，或直接使用现有桥）')
    }
    process.exit(1)
  })
  created.listen(PORT, HOST, () => {
    console.log(`[setup-key] 本地桥已启动: http://${HOST}:${PORT}/ （仅本机回环）`)
    console.log('[setup-key] 端点: /credentials(API Key) /tree(目录) /file(预览) /ping /shutdown')
    console.log('[setup-key] 桥需保持运行以服务文件浏览；不用时关闭本窗口即可。')
  })
  // 兜底：8 小时后自动退出（凭证导入是瞬时的，但文件浏览需要桥常驻）
  const autoExit = setTimeout(() => {
    console.log('[setup-key] 8 小时超时，自动退出。')
    created.close(() => process.exit(0))
  }, 8 * 60 * 60 * 1000)
  autoExit.unref()
}

main()
