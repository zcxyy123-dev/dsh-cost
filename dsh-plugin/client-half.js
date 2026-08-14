/**
 * 用量显示 · DSH 动态插件 — Client 半（code.client 的函数体）
 *
 * 直接嵌入网页右侧栏（details 列，取代官方 tool-details 面板）：
 * 上下文占用、会话指标（命中率/费用/运行时间/请求数）、用量分析（按来源/按类型）、
 * 明细、工作区文件、官方余额/平台费用。
 *
 * 数据链路：
 *   - 会话投影（tokenUsage / contextPressure / sessionStats / contextBreakdown）
 *     通过 details 槽标准 props 的 useProjection 按 key 直读（宿主推送，实时更新）；
 *   - firstTs / 主模型 / 子代理用量 / 目录树 / 官方接口 走 host.call 的
 *     meta / cold / subagents / tree / file / official；
 *   - 当前会话由 details 槽的 sessionId 标准 props 决定（跟随 GUI 选中）。
 *
 * 本文件内容即 cordis_define 的 code.client 字符串。纯 JS（无 JSX/TS）。
 */
return {
  inject: ['timer'],
  apply(ctx) {
    /* ---------------- 样式（颜色全部用 DSH 语义变量，随主题自动切换；全部作用域化） ---------------- */
    styles.insert(`.dshu-root * {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
.dshu-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  border-left: 1px solid var(--dsw-alias-border-l2, var(--dsw-static-neutral-bluish-800, rgb(53, 54, 56)));
  background: var(--dsw-alias-bg-base, var(--dsw-specific-sidebar-fill, rgb(21, 21, 23)));
}
.dshu-root .dshu-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  user-select: none;
}
.dshu-root .dshu-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 12px 12px;
  background: linear-gradient(180deg,
    var(--dsw-specific-input-major, rgb(33, 33, 35)),
    var(--dsw-specific-sidebar-fill, rgb(27, 27, 28)));
  border-bottom: 1px solid var(--dsw-static-neutral-bluish-800, rgb(53, 54, 56));
  flex: none;
  /* 与原生 details 列头部一致：14 + max(标题 20, 按钮 28) + 12 = 54px */
  height: 54px;
}
.dshu-root .dshu-title {
  font-size: 14px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}
.dshu-root .dshu-head-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  font-size: 13px;
  padding: 0;
}
.dshu-root .dshu-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--dsw-alias-state-business-primary, rgb(65, 118, 230));
  box-shadow: 0 0 8px var(--dsw-alias-state-business-primary, rgb(65, 118, 230));
  flex: none;
}
.dshu-root .dshu-session {
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  text-align: right;
}
.dshu-root .dshu-btn {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
  flex: none;
}
.dshu-root .dshu-btn:hover {
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
  background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56));
}
.dshu-root .dshu-body {
  flex: 1;
  min-height: 0;
  padding: 12px 16px;
  overflow-y: auto;
  user-select: text;
}
.dshu-root .dshu-body::-webkit-scrollbar {
  width: 6px;
}
.dshu-root .dshu-body::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56));
  border-radius: 3px;
}
.dshu-root .dshu-sec {
  margin-bottom: 14px;
}
.dshu-root .dshu-sec:last-child {
  margin-bottom: 0;
}
.dshu-root .dshu-sec-title {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, rgb(151, 157, 166));
  font-weight: 600;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.dshu-root .dshu-sec-title .dshu-sub {
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  font-weight: 400;
}
.dshu-root .dshu-ctx-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}
.dshu-root .dshu-ctx-used {
  font-size: 15px;
  font-weight: 700;
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
}
.dshu-root .dshu-ctx-used .dshu-muted {
  font-size: 11px;
  font-weight: 400;
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
}
.dshu-root .dshu-bar {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: var(--dsw-alias-interactive-bg-hover, rgb(44, 44, 46));
  overflow: hidden;
}
.dshu-root .dshu-bar > i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 4px;
  background: var(--dsw-alias-state-business-primary, rgb(65, 118, 230));
  transition: width .3s;
}
.dshu-root .dshu-bar > b {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--dsw-alias-state-warn-primary, rgb(245, 158, 11));
}
.dshu-root .dshu-bar-warn > i {
  background: var(--dsw-alias-state-warn-primary, rgb(245, 158, 11));
}
.dshu-root .dshu-bar-danger > i {
  background: var(--dsw-alias-state-error-primary, rgb(239, 68, 68));
}
.dshu-root .dshu-ctx-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  font-size: 11px;
}
.dshu-root .dshu-ctx-foot b {
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  font-weight: 500;
}
.dshu-root .dshu-badge {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 99px;
  font-weight: 600;
}
.dshu-root .dshu-badge-ok {
  color: var(--dsw-alias-state-success-primary, rgb(34, 197, 94));
  background: var(--dsw-alias-state-success-tertiary, rgba(34, 197, 94, 0.14));
}
.dshu-root .dshu-badge-warn {
  color: var(--dsw-alias-state-warn-primary, rgb(245, 158, 11));
  background: var(--dsw-alias-state-warn-tertiary, rgba(245, 158, 11, 0.14));
}
.dshu-root .dshu-badge-danger {
  color: var(--dsw-alias-state-error-primary, rgb(239, 68, 68));
  background: var(--dsw-alias-interactive-bg-hover-danger, rgba(239, 68, 68, 0.15));
}
.dshu-root .dshu-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}
.dshu-root .dshu-cell {
  background: var(--dsw-specific-input-major, rgb(27, 27, 28));
  border: 1px solid var(--dsw-static-neutral-bluish-850, rgb(44, 44, 46));
  border-radius: 8px;
  padding: 7px 9px;
}
.dshu-root .dshu-cell .k {
  font-size: 10px;
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
}
.dshu-root .dshu-cell .v {
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
  margin-top: 1px;
}
.dshu-root .dshu-cell .v.blue {
  color: var(--dsw-alias-state-business-primary, rgb(103, 158, 254));
}
.dshu-root .dshu-cell .v.green {
  color: var(--dsw-alias-state-success-secondary, rgb(78, 209, 126));
}
.dshu-root .dshu-cell .v.amber {
  color: var(--dsw-alias-state-warn-secondary, rgb(247, 173, 49));
}
.dshu-root .dshu-tabs {
  display: flex;
  gap: 2px;
  background: var(--dsw-specific-input-major, rgb(33, 33, 35));
  border-radius: 7px;
  padding: 2px;
  margin-bottom: 8px;
}
.dshu-root .dshu-tab {
  flex: 1;
  text-align: center;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  font-size: 11px;
  padding: 4px 0;
  border-radius: 6px;
  cursor: pointer;
}
.dshu-root .dshu-tab.on {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56));
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
  font-weight: 600;
}
.dshu-root .dshu-rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.dshu-root .dshu-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.dshu-root .dshu-row .k {
  color: var(--dsw-alias-label-tertiary, rgb(151, 157, 166));
}
.dshu-root .dshu-row .v {
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.dshu-root .dshu-row .v .unit {
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  font-weight: 400;
  font-size: 10px;
  margin-left: 3px;
}
.dshu-root .dshu-share {
  display: flex;
  gap: 2px;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--dsw-alias-interactive-bg-hover, rgb(44, 44, 46));
  margin: 6px 0 4px;
}
.dshu-root .dshu-share i {
  display: block;
  height: 100%;
}
.dshu-root .dshu-share-main {
  background: var(--dsw-alias-state-business-primary, rgb(65, 118, 230));
}
.dshu-root .dshu-share-sub {
  background: var(--dsw-alias-state-business-tertiary, rgb(147, 197, 253));
}
.dshu-root .dshu-share-in {
  background: var(--dsw-alias-state-business-primary, rgb(65, 118, 230));
}
.dshu-root .dshu-share-out {
  background: var(--dsw-alias-state-success-secondary, rgb(78, 209, 126));
}
.dshu-root .dshu-err {
  color: var(--dsw-alias-state-error-secondary, rgb(242, 90, 90));
  padding: 14px 4px;
  text-align: center;
}
.dshu-root .dshu-wait {
  color: var(--dsw-alias-label-caption, rgb(129, 133, 140));
  padding: 14px 4px;
  text-align: center;
}
.dshu-root .dshu-file-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2.5px 6px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  min-width: 0;
}
.dshu-root .dshu-file-row:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
}
.dshu-root .dshu-file-icon {
  flex: none;
  font-size: 11px;
}
.dshu-root .dshu-file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.dshu-root .dshu-file-actions {
  display: none;
  flex: none;
  gap: 2px;
}
.dshu-root .dshu-file-row:hover .dshu-file-actions {
  display: inline-flex;
}
.dshu-root .dshu-file-action {
  border: none;
  background: var(--dsw-specific-input-major, rgb(44, 44, 46));
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  border-radius: 4px;
  font-size: 10px;
  padding: 1px 4px;
  cursor: pointer;
  line-height: 1.4;
}
.dshu-root .dshu-file-action:hover {
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
}
.dshu-root .dshu-preview {
  margin-top: 8px;
  border: 1px solid var(--dsw-static-neutral-bluish-850, rgb(44, 44, 46));
  border-radius: 8px;
  overflow: hidden;
  background: var(--dsw-alias-markdown-code-block, rgb(27, 27, 28));
}
.dshu-root .dshu-preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--dsw-static-neutral-bluish-850, rgb(44, 44, 46));
  background: var(--dsw-specific-input-major, rgb(44, 44, 46));
}
.dshu-root .dshu-preview-info {
  font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary, rgb(151, 157, 166));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshu-root .dshu-preview-code {
  margin: 0;
  padding: 8px 10px;
  max-height: 220px;
  overflow: auto;
  white-space: pre;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  user-select: text;
}
.dshu-root .dshu-official {
  border: 1px solid var(--dsw-static-neutral-bluish-850, rgb(44, 44, 46));
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--dsw-specific-input-major, rgb(24, 24, 26));
}
.dshu-root .dshu-field {
  margin-bottom: 7px;
}
.dshu-root .dshu-field .k {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, rgb(151, 157, 166));
  margin-bottom: 4px;
}
.dshu-root .dshu-field input {
  width: 100%;
  background: var(--dsw-alias-button-floating-fill, rgb(33, 33, 35));
  border: 1px solid var(--dsw-static-neutral-bluish-800, rgb(53, 54, 56));
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
}
.dshu-root .dshu-field-hint {
  font-size: 10px;
  color: var(--dsw-alias-label-dimmed, rgb(101, 103, 107));
  margin-top: 4px;
  line-height: 1.5;
}
.dshu-root .dshu-official-btn {
  width: 100%;
  background: var(--dsw-specific-sidebar-fill, rgb(27, 27, 28));
  border: 1px solid var(--dsw-static-neutral-bluish-800, rgb(53, 54, 56));
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
  border-radius: 6px;
  padding: 5px 0;
  font-size: 12px;
  cursor: pointer;
}
.dshu-root .dshu-official-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56));
}
.dshu-head-toggle {
  border: 1px solid var(--dsw-static-neutral-bluish-800, rgb(53, 54, 56));
  background: var(--dsw-specific-input-major, rgb(33, 33, 35));
  color: var(--dsw-alias-label-secondary, rgb(207, 211, 214));
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  padding: 5px 8px;
  cursor: pointer;
}
.dshu-head-toggle:hover {
  color: var(--dsw-alias-label-primary, rgb(235, 238, 242));
  background: var(--dsw-alias-interactive-bg-hover-solid, rgb(53, 54, 56));
}`)

    /* ---------------- 配置与计算（与油猴/扩展版同一口径） ---------------- */
    const CONFIG = {
      pricing: {
        'deepseek-v4-flash': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
        'deepseek-v4-pro': { cacheHit: 0.003625, cacheMiss: 0.435, output: 0.87 },
        'deepseek-chat': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
        'deepseek-reasoner': { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
        fallback: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 },
      },
      currency: 'CNY',
      cnyRate: 7.14,
      contextWindow: 0,
      compressThreshold: 0.8,
    }

    function pricingFor(model) {
      if (model && CONFIG.pricing[model]) return CONFIG.pricing[model]
      return CONFIG.pricing.fallback
    }
    function costOf(model, hit, miss, output) {
      const p = pricingFor(model)
      const usd = (hit * p.cacheHit + miss * p.cacheMiss + output * p.output) / 1e6
      return CONFIG.currency === 'CNY' ? usd * (CONFIG.cnyRate || 7.14) : usd
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
    function pct(part, whole) {
      if (!whole) return 0
      return (part / whole) * 100
    }
    function badgeFor(usedPctValue, thresholdPctValue) {
      if (usedPctValue >= thresholdPctValue) return ['dshu-badge-danger', '已到压缩阈值']
      if (usedPctValue >= thresholdPctValue * 0.75) return ['dshu-badge-warn', '上下文紧张']
      return ['dshu-badge-ok', '上下文充足']
    }
    function baseName(p) {
      const parts = String(p).split(/[\\/]/)
      return parts[parts.length - 1] || p
    }

    /** 核心统计：输入投影/元信息/子代理，输出面板全部数字（与 usage-display.js 同口径）。 */
    function computeStats(raw) {
      const values = raw.projections || {}
      const tu = values.tokenUsage
      const cp = values.contextPressure || {}
      const ss = values.sessionStats
      const now = raw.now
      const meta = raw.meta || {}
      const subs = raw.subs || []

      const uncached = tu ? (tu.uncachedInputTokens || 0) : 0
      const output = tu ? (tu.outputTokens || 0) : 0
      const cacheRead = tu ? (tu.cacheReadTokens || 0) : 0
      const cacheWrite = tu ? (tu.cacheWriteTokens || 0) : 0
      const input = uncached + cacheRead + cacheWrite
      const hit = cacheRead
      const miss = uncached + cacheWrite
      const totalTokens = input + output
      const hitRate = hit + miss > 0 ? (hit / (hit + miss)) * 100 : 0

      const requests = ss && typeof ss.steps === 'number' ? ss.steps : 0
      const model = meta.model || null
      const firstTs = typeof meta.firstTs === 'number' ? meta.firstTs : null
      const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : null
      const active = updatedAt !== null && now - updatedAt < 5 * 60 * 1000
      const durationMs = firstTs !== null
        ? (active ? now - firstTs : Math.max(0, (updatedAt || now) - firstTs))
        : 0

      const contextWindow = cp.contextWindow || CONFIG.contextWindow || 1000000
      const used = cp.projectedTokens !== undefined ? cp.projectedTokens
        : cp.pressureTokens !== undefined ? cp.pressureTokens
        : input
      const usedPctValue = contextWindow > 0 ? (used / contextWindow) * 100 : 0
      const thresholdPctValue = (CONFIG.compressThreshold || 0.8) * 100
      const untilCompress = Math.max(0, contextWindow * (CONFIG.compressThreshold || 0.8) - used)

      const costMain = costOf(model, hit, miss, output)
      let subTokens = 0
      let subCost = 0
      let subRequests = 0
      let subHit = 0
      let subMiss = 0
      for (const sub of subs) {
        const s = sub.tokenUsage
        if (!s) continue
        const sMiss = (s.uncachedInputTokens || 0) + (s.cacheWriteTokens || 0)
        const sHit = s.cacheReadTokens || 0
        const sOut = s.outputTokens || 0
        subTokens += sMiss + sHit + sOut
        subRequests += 1
        subHit += sHit
        subMiss += sMiss
        subCost += costOf(sub.model || model, sHit, sMiss, sOut)
      }
      const totalCost = costMain + subCost
      const mainShare = totalTokens + subTokens > 0 ? (totalTokens / (totalTokens + subTokens)) * 100 : 100
      const inPctValue = totalTokens + output > 0 ? (input / (totalTokens + output)) * 100 : 0
      const subHitRate = subHit + subMiss > 0 ? (subHit / (subHit + subMiss)) * 100 : 0

      return {
        contextWindow, used, usedPct: usedPctValue, thresholdPct: thresholdPctValue, untilCompress,
        model, hitRate, cost: totalCost, costMain, costSub: subCost,
        durationMs, requests, totalTokens,
        input, output, hit, miss,
        mainTokens: totalTokens, subTokens, mainRequests: requests, subRequests,
        mainShare, inPct: inPctValue, subHitRate,
        contextBreakdown: values.contextBreakdown || null,
        sessionStats: ss || null,
        hasProjection: !!tu,
      }
    }

    /* ---------------- 面板组件（details 右侧栏嵌入式） ---------------- */
    const el = React.createElement

    function ctxSection(s) {
      const [badgeCls, badgeText] = badgeFor(s.usedPct, s.thresholdPct)
      const barPct = Math.min(100, s.usedPct)
      const barCls = s.usedPct >= s.thresholdPct ? 'dshu-bar dshu-bar-danger'
        : s.usedPct >= s.thresholdPct * 0.75 ? 'dshu-bar dshu-bar-warn'
        : 'dshu-bar'
      const markLeft = s.thresholdPct <= 100 ? `${s.thresholdPct.toFixed(1)}%` : '100%'
      return el('div', { className: 'dshu-sec' },
        el('div', { className: 'dshu-sec-title' },
          el('span', null, '上下文窗口'),
          el('span', { className: 'dshu-sub' }, `压缩阈值 ${s.thresholdPct.toFixed(0)}%`)),
        el('div', { className: 'dshu-ctx-meta' },
          el('span', { className: 'dshu-ctx-used' },
            `${fmtCompact(s.used)} `,
            el('span', { className: 'dshu-muted' }, `/ ${fmtCompact(s.contextWindow)} tokens`)),
          el('span', { className: `dshu-badge ${badgeCls}` }, badgeText)),
        el('div', { className: barCls },
          el('i', { style: { width: `${barPct}%` } }),
          el('b', { style: { left: markLeft } })),
        el('div', { className: 'dshu-ctx-foot' },
          el('span', null, `已用 ${fmtCompact(s.used)}（${s.usedPct.toFixed(1)}%）`),
          el('span', null, el('b', null, fmtCompact(s.untilCompress)), ' 距压缩')),
      )
    }

    function metricsSection(s) {
      const cells = [
        ['平均命中', `${s.hitRate.toFixed(2)}%`, 'green'],
        ['会话费用', fmtMoney(s.cost), 'amber'],
        ['运行时间', fmtDuration(s.durationMs), ''],
        ['请求数', String(s.requests), 'blue'],
      ]
      return el('div', { className: 'dshu-sec' },
        el('div', { className: 'dshu-sec-title' }, el('span', null, '会话指标')),
        el('div', { className: 'dshu-grid' },
          cells.map(([k, v, cls]) => el('div', { className: 'dshu-cell', key: k },
            el('div', { className: 'k' }, k),
            el('div', { className: `v ${cls}` }, v)))),
        el('div', { className: 'dshu-rows', style: { marginTop: 6 } },
          el('div', { className: 'dshu-row' },
            el('span', { className: 'k' }, '累计 tokens'),
            el('span', { className: 'v' }, fmtCompact(s.totalTokens), el('span', { className: 'unit' }, '输入+输出'))),
          el('div', { className: 'dshu-row' },
            el('span', { className: 'k' }, '主模型'),
            el('span', { className: 'v' }, s.model || '—'))),
      )
    }

    function sourceSection(s, tab, setTab) {
      const tabs = el('div', { className: 'dshu-tabs' },
        el('button', { className: `dshu-tab${tab === 'source' ? ' on' : ''}`, onClick: () => setTab('source') }, '按来源'),
        el('button', { className: `dshu-tab${tab === 'type' ? ' on' : ''}`, onClick: () => setTab('type') }, '按类型'))
      let body
      if (tab === 'source') {
        const mainW = Math.max(0, Math.min(100, s.mainShare))
        const subRate = s.subTokens > 0 ? `${s.subHitRate.toFixed(2)}%` : '—'
        body = el('div', null,
          el('div', { className: 'dshu-share' },
            el('i', { className: 'dshu-share-main', style: { width: `${mainW}%` } }),
            el('i', { className: 'dshu-share-sub', style: { width: `${Math.max(0, 100 - mainW)}%` } })),
          el('div', { className: 'dshu-rows' },
            el('div', { className: 'dshu-row' },
              el('span', { className: 'k' }, `主模型 ${s.mainShare.toFixed(0)}%`),
              el('span', { className: 'v' },
                `${s.mainRequests}次 · ${fmtCompact(s.mainTokens)}`,
                el('span', { className: 'unit' }, `缓存${s.hitRate.toFixed(2)}%`))),
            el('div', { className: 'dshu-row' },
              el('span', { className: 'k' }, `子代理 ${(100 - s.mainShare).toFixed(0)}%`),
              el('span', { className: 'v' },
                `${s.subRequests}次 · ${fmtCompact(s.subTokens)}`,
                el('span', { className: 'unit' }, `缓存${subRate}`)))))
      } else {
        const inW = Math.max(0, Math.min(100, s.inPct))
        body = el('div', null,
          el('div', { className: 'dshu-share' },
            el('i', { className: 'dshu-share-in', style: { width: `${inW}%` } }),
            el('i', { className: 'dshu-share-out', style: { width: `${Math.max(0, 100 - inW)}%` } })),
          el('div', { className: 'dshu-rows' },
            el('div', { className: 'dshu-row' },
              el('span', { className: 'k' }, `输入 ${s.inPct.toFixed(1)}%`),
              el('span', { className: 'v' }, fmtCompact(s.input))),
            el('div', { className: 'dshu-row' },
              el('span', { className: 'k' }, `输出 ${(100 - s.inPct).toFixed(1)}%`),
              el('span', { className: 'v' }, fmtCompact(s.output)))))
      }
      return el('div', { className: 'dshu-sec' },
        el('div', { className: 'dshu-sec-title' }, el('span', null, '用量分析')),
        tabs, body)
    }

    function detailSection(s, tab, setTab) {
      const tabs = el('div', { className: 'dshu-tabs' },
        el('button', { className: `dshu-tab${tab === 'io' ? ' on' : ''}`, onClick: () => setTab('io') }, '输入/输出'),
        el('button', { className: `dshu-tab${tab === 'hit' ? ' on' : ''}`, onClick: () => setTab('hit') }, '命中/未命中'))
      const rows = tab === 'io'
        ? [
          ['输入', fmtCompact(s.input), 'uncached + cacheRead + cacheWrite'],
          ['输出', fmtCompact(s.output), 'outputTokens'],
        ]
        : [
          ['命中', fmtCompact(s.hit), 'cacheReadTokens'],
          ['未命中', fmtCompact(s.miss), 'uncached + cacheWrite'],
        ]
      return el('div', { className: 'dshu-sec' },
        el('div', { className: 'dshu-sec-title' }, el('span', null, '明细')),
        tabs,
        el('div', { className: 'dshu-rows' },
          rows.map(([k, v, unit]) => el('div', { className: 'dshu-row', key: k },
            el('span', { className: 'k' }, k),
            el('span', { className: 'v' }, v, el('span', { className: 'unit' }, unit))))))
    }

    function filesSection(filesState, actions) {
      const { files, expanded, dirs, preview } = filesState
      const { toggleDir, previewFile, openPath, closePreview } = actions
      const children = []
      if (files && files.error) {
        children.push(el('div', { className: 'dshu-wait' }, files.error))
      } else if (files && files.entries) {
        for (const entry of files.entries) {
          children.push(fileRow(entry, 0, files, expanded, dirs, { toggleDir, previewFile, openPath }))
        }
        if (files.entries.length === 0) children.push(el('div', { className: 'dshu-wait' }, '（空目录）'))
      } else if (files && files.entries === null) {
        children.push(el('div', { className: 'dshu-wait' }, '加载中…'))
      }
      if (preview) {
        const head = preview.error
          ? el('div', { className: 'dshu-preview-head' }, el('span', { className: 'dshu-preview-info' }, `${preview.name} — ${preview.error}`), closeBtn(closePreview))
          : el('div', { className: 'dshu-preview-head' },
              el('span', { className: 'dshu-preview-info' },
                `${preview.name}${preview.truncated ? '（截断）' : ''}${preview.size != null ? ` · ${preview.size} B` : ''}`),
              closeBtn(closePreview))
        const body = preview.error
          ? null
          : el('pre', { className: 'dshu-preview-code' }, preview.content)
        children.push(el('div', { className: 'dshu-preview' }, head, body))
      }
      return el('div', { className: 'dshu-sec' },
        el('div', { className: 'dshu-sec-title' },
          el('span', null, '工作区文件'),
          el('span', { className: 'dshu-sub' }, files && files.root ? baseName(files.root) : '—')),
        ...(files ? children : [el('div', { className: 'dshu-wait' }, '无工作目录')]))
    }

    function closeBtn(onClick) {
      return el('button', { className: 'dshu-btn', onClick, title: '关闭预览' }, '✕')
    }

    function fileRow(entry, depth, files, expanded, dirs, actions) {
      const isDir = entry.type === 'dir'
      const pad = { paddingLeft: `${8 + depth * 14}px` }
      const children = [
        el('span', { className: 'dshu-file-icon' }, isDir ? '📁' : '📄'),
        el('span', { className: 'dshu-file-name', title: entry.path ? entry.path : entry.name }, entry.name),
      ]
      if (isDir) {
        const openBtn = el('button', {
          className: 'dshu-file-action', title: '在资源管理器中打开',
          onClick: (e) => { e.stopPropagation(); actions.openPath(entry.path) },
        }, '📂')
        children.push(el('span', { className: 'dshu-file-actions' }, openBtn))
        const row = el('div', {
          className: 'dshu-file-row', style: pad,
          onClick: () => actions.toggleDir(entry.path, entry.name),
        }, ...children)
        const rows = [row]
        if (expanded[entry.path]) {
          const dirEntries = dirs[entry.path]
          if (dirEntries === undefined || dirEntries === 'loading') {
            rows.push(el('div', { className: 'dshu-wait', style: { paddingLeft: `${22 + depth * 14}px` } }, '加载中…'))
          } else if (Array.isArray(dirEntries)) {
            for (const child of dirEntries) rows.push(fileRow(child, depth + 1, files, expanded, dirs, actions))
          }
        }
        return el('div', { key: entry.path }, ...rows)
      }
      const openBtn = el('button', {
        className: 'dshu-file-action', title: '用默认程序打开',
        onClick: (e) => { e.stopPropagation(); actions.openPath(entry.path) },
      }, '↗')
      children.push(el('span', { className: 'dshu-file-actions' }, openBtn))
      return el('div', {
        className: 'dshu-file-row', style: pad, key: entry.path,
        onClick: () => actions.previewFile(entry.path, entry.name),
      }, ...children)
    }

    function officialSection(officialState, actions) {
      const { official, apiKey, userToken, officialOpen, busy, autoKey } = officialState
      const { setApiKey, setUserToken, setOfficialOpen, refreshOfficial, reProbeKey } = actions
      const children = []
      children.push(el('div', { className: 'dshu-sec-title', key: 't' },
        el('span', null, '官方账户'),
        el('button', { className: 'dshu-btn', onClick: () => setOfficialOpen(!officialOpen), title: '配置凭证' }, '⚙')))
      if (officialOpen) {
        children.push(el('div', { className: 'dshu-official', key: 'cfg' },
          el('div', { className: 'dshu-field' },
            el('div', { className: 'k' }, 'API Key（余额）'),
            el('input', {
              type: 'password', value: apiKey, placeholder: 'sk-…',
              onChange: (e) => setApiKey(e.target.value),
            }),
            el('div', { className: 'dshu-field-hint' },
              autoKey === null ? '正在自动探测宿主凭证…'
                : autoKey.found ? `已自动获取宿主凭证（${autoKey.source}），可直接查询。`
                : '未在宿主凭证（.credentials.yaml）中找到 API Key，可手动粘贴。')),
          el('div', { className: 'dshu-field' },
            el('div', { className: 'k' }, '平台 userToken（官方费用/用量）'),
            el('input', {
              type: 'password', value: userToken, placeholder: '登录 platform.deepseek.com 后 F12 复制',
              onChange: (e) => setUserToken(e.target.value),
            }),
            el('div', { className: 'dshu-field-hint' }, '可选。platform.deepseek.com → Application → Local Storage → userToken。')),
          el('button', { className: 'dshu-official-btn', onClick: refreshOfficial, disabled: busy },
            busy ? '查询中…' : '查询官方数据'),
          el('button', {
            className: 'dshu-official-btn', onClick: reProbeKey,
            style: { marginTop: 6, opacity: 0.85 },
          }, '↻ 重新自动获取'),
        ))
      }
      const o = official
      if (o) {
        const rows = []
        const money = (v) => (v === null || v === undefined ? '—' : `${o.balance ? moneySym(o.balance.currency) : CONFIG.currency === 'CNY' ? '¥' : '$'}${Number(v).toFixed(2)}`)
        if (o.balance && !o.balance.error) {
          rows.push(el('div', { className: 'dshu-row', key: 'bal' },
            el('span', { className: 'k' }, '余额'),
            el('span', { className: 'v' },
              money(o.balance.total),
              el('span', { className: 'unit' }, `充值 ${money(o.balance.toppedUp)} / 赠送 ${money(o.balance.granted)}`))))
        } else if (o.balance && o.balance.error) {
          rows.push(el('div', { className: 'dshu-row', key: 'bal' },
            el('span', { className: 'k' }, '余额'),
            el('span', { className: 'v', style: { color: 'var(--dsw-alias-state-error-secondary, rgb(242, 90, 90))' } }, o.balance.error)))
        }
        if (o.usage && !o.usage.error) {
          const u = o.usage
          rows.push(
            el('div', { className: 'dshu-row', key: 'tc' },
              el('span', { className: 'k' }, '今日费用'),
              el('span', { className: 'v' }, money(u.todayCost))),
            el('div', { className: 'dshu-row', key: 'mc' },
              el('span', { className: 'k' }, '本月费用'),
              el('span', { className: 'v' }, money(u.monthCost))),
            el('div', { className: 'dshu-row', key: 'tt' },
              el('span', { className: 'k' }, '今日 tokens'),
              el('span', { className: 'v' }, fmtCompact(u.todayTokens), el('span', { className: 'unit' }, `${u.todayRequests} 次请求`))),
            el('div', { className: 'dshu-row', key: 'mt' },
              el('span', { className: 'k' }, '本月 tokens'),
              el('span', { className: 'v' }, fmtCompact(u.monthTokens), el('span', { className: 'unit' }, `${u.monthRequests} 次请求`))),
            el('div', { className: 'dshu-row', key: 'top' },
              el('span', { className: 'k' }, 'Top 模型'),
              el('span', { className: 'v' }, u.topModel || '—')),
          )
        } else if (o.usage && o.usage.error) {
          rows.push(el('div', { className: 'dshu-row', key: 'ue' },
            el('span', { className: 'k' }, '平台费用'),
            el('span', { className: 'v', style: { color: 'var(--dsw-alias-state-error-secondary, rgb(242, 90, 90))' } }, o.usage.error)))
        }
        children.push(el('div', { className: 'dshu-rows', style: { marginTop: 8 }, key: 'data' }, ...rows))
      }
      return el('div', { className: 'dshu-sec' }, ...children)
    }

    function moneySym(currency) {
      return currency === 'USD' ? '$' : '¥'
    }

    /** 嵌入式右侧栏面板：props = details 槽标准 props（useSessions/useProjection/sessionId）+ inject（closeDetails）。 */
    function UsagePanel(props) {
      const sessionId = props.sessionId
      const summary = props.useSessions((s) => (sessionId === undefined ? undefined : s.byId[sessionId]))

      // 实时投影（details 槽按 key 直读，宿主推送即更新）
      const tu = props.useProjection('tokenUsage')
      const cpv = props.useProjection('contextPressure')
      const ssv = props.useProjection('sessionStats')
      const cbv = props.useProjection('contextBreakdown')

      const [meta, setMeta] = React.useState(null)
      const [coldProj, setColdProj] = React.useState(null)
      const [subs, setSubs] = React.useState([])
      const [nonce, setNonce] = React.useState(0)
      const [collapsed, setCollapsed] = React.useState(false)
      const [tabSource, setTabSource] = React.useState('source')
      const [tabDetail, setTabDetail] = React.useState('io')
      const [files, setFiles] = React.useState(null)
      const [expanded, setExpanded] = React.useState({})
      const [dirs, setDirs] = React.useState({})
      const [preview, setPreview] = React.useState(null)
      const [official, setOfficial] = React.useState(null)
      const [apiKey, setApiKey] = React.useState('')
      const [userToken, setUserToken] = React.useState('')
      const [officialOpen, setOfficialOpen] = React.useState(false)
      const [officialBusy, setOfficialBusy] = React.useState(false)
      const [autoKey, setAutoKey] = React.useState(null)
      const [autoNonce, setAutoNonce] = React.useState(0)

      // 切换会话时清空会话级状态
      React.useEffect(() => {
        setMeta(null)
        setColdProj(null)
        setSubs([])
        setFiles(null)
        setExpanded({})
        setDirs({})
        setPreview(null)
        setOfficial(null)
      }, [sessionId])

      // 会话级数据拉取（meta/cold 一次性 + 子代理 5 秒自动刷新）
      React.useEffect(() => {
        if (!sessionId) return undefined
        let alive = true
        const call = (method, args) => host.call(method, args).then((r) => {
          if (!alive || !r || r.ok !== true) return null
          return r.value
        }).catch(() => null)
        call('meta', { sessionId }).then((v) => { if (alive && v) setMeta(v) })
        call('cold', { sessionId }).then((v) => { if (alive && v && typeof v === 'object') setColdProj(v) })
        call('subagents', { sessionId }).then((v) => { if (alive && Array.isArray(v)) setSubs(v) })
        const dispose = ctx.interval(() => {
          call('subagents', { sessionId }).then((v) => { if (alive && Array.isArray(v)) setSubs(v) })
        }, 5000)
        return () => { alive = false; dispose() }
      }, [sessionId, nonce])

      // 自动获取宿主凭证 API Key（探测一次/会话；找到则自动填充并查询官方余额）
      React.useEffect(() => {
        if (!sessionId) return undefined
        let alive = true
        host.call('apikey').then((r) => {
          if (!alive) return
          const value = r && r.ok === true ? r.value : null
          const key = value && typeof value.apiKey === 'string' && value.apiKey ? value.apiKey : ''
          if (key) {
            setApiKey(key)
            setAutoKey({ found: true, source: (value && value.source) || '' })
            host.call('official', { apiKey: key, userToken: null }).then((r2) => {
              if (!alive) return
              setOfficial(r2 && r2.ok === true ? r2.value : { error: '官方接口请求失败' })
            }).catch(() => { if (alive) setOfficial({ error: '官方接口请求失败' }) })
          } else {
            setAutoKey({ found: false, source: '' })
          }
        }).catch(() => { if (alive) setAutoKey({ found: false, source: '' }) })
        return () => { alive = false }
      }, [sessionId, autoNonce])

      // 工作区根目录加载（cwd 变化时）
      const cwd = summary ? summary.cwd : undefined
      React.useEffect(() => {
        if (!cwd) { setFiles(null); return undefined }
        let alive = true
        setFiles({ root: cwd, entries: null, error: null })
        host.call('tree', { path: cwd }).then((r) => {
          if (!alive) return
          const value = r && r.ok === true ? r.value : null
          const error = value && value.error ? value.error : (r && r.ok === true ? null : '目录读取失败')
          setFiles((f) => (f && f.root === cwd ? { root: cwd, entries: value && !value.error ? value.entries : [], error } : f))
        }).catch(() => {
          if (alive) setFiles((f) => (f && f.root === cwd ? { root: cwd, entries: [], error: '目录读取失败' } : f))
        })
        return () => { alive = false }
      }, [cwd])

      const toggleDir = (path, name) => {
        const willExpand = !expanded[path]
        setExpanded((prev) => {
          const next = { ...prev }
          if (willExpand) next[path] = true
          else delete next[path]
          return next
        })
        if (willExpand && dirs[path] === undefined) {
          setDirs((d) => ({ ...d, [path]: 'loading' }))
          host.call('tree', { path }).then((r) => {
            const value = r && r.ok === true ? r.value : null
            const entries = value && !value.error ? value.entries : []
            setDirs((d) => ({ ...d, [path]: entries }))
          }).catch(() => setDirs((d) => ({ ...d, [path]: [] })))
        }
      }
      const previewFile = (path, name) => {
        setPreview({ path, name, loading: true })
        host.call('file', { path }).then((r) => {
          const value = r && r.ok === true ? r.value : null
          if (value && !value.error) {
            setPreview({ path, name, content: value.content, truncated: !!value.truncated, size: value.size })
          } else {
            setPreview({ path, name, error: (value && value.error) || '读取失败' })
          }
        }).catch(() => setPreview({ path, name, error: '读取失败' }))
      }
      const closePreview = () => setPreview(null)
      const openPath = (path) => {
        const workspaces = ctx.get('workspaces')
        if (workspaces && typeof workspaces.openPath === 'function') {
          workspaces.openPath(path).catch(() => {})
        }
      }
      const refreshOfficial = () => {
        if (!apiKey && !userToken) return
        setOfficialBusy(true)
        host.call('official', { apiKey: apiKey || null, userToken: userToken || null }).then((r) => {
          setOfficialBusy(false)
          setOfficial(r && r.ok === true ? r.value : { error: '官方接口请求失败' })
        }).catch(() => {
          setOfficialBusy(false)
          setOfficial({ error: '官方接口请求失败' })
        })
      }

      // 计算统计：useProjection 实时值优先，冷读投影兜底
      const cold = coldProj || {}
      const projections = {
        tokenUsage: tu || cold.tokenUsage,
        contextPressure: cpv || cold.contextPressure,
        sessionStats: ssv || cold.sessionStats,
        contextBreakdown: cbv || cold.contextBreakdown,
      }
      const hasLive = !!(tu || cpv || ssv)
      const stats = computeStats({
        projections,
        meta: meta || {},
        subs,
        updatedAt: summary ? summary.updatedAt : undefined,
        now: Date.now(),
      })

      const head = el('div', { className: 'dshu-head' },
        el('span', { className: 'dshu-dot' }),
        el('span', { className: 'dshu-title' }, '用量显示'),
        el('span', { className: 'dshu-session' }, summary ? summary.displayTitle : ''),
        el('button', {
          className: 'dshu-btn dshu-head-btn', title: '刷新',
          onClick: () => setNonce((n) => n + 1),
        }, '⟳'),
        el('button', {
          className: 'dshu-btn dshu-head-btn', title: collapsed ? '展开' : '折叠',
          onClick: () => setCollapsed(!collapsed),
        }, collapsed ? '▢' : '—'),
        el('button', {
          className: 'dshu-btn dshu-head-btn', title: '关闭面板',
          onClick: () => { if (typeof props.closeDetails === 'function') { props.closeDetails() } },
        }, '✕'))

      let body
      if (!sessionId || !summary) {
        body = el('div', { className: 'dshu-wait' }, '未选择会话')
      } else {
        body = el('div', { className: 'dshu-body' },
          ctxSection(stats),
          metricsSection(stats),
          sourceSection(stats, tabSource, setTabSource),
          detailSection(stats, tabDetail, setTabDetail),
          filesSection(
            { files, expanded, dirs, preview },
            { toggleDir, previewFile, openPath, closePreview },
          ),
          officialSection(
            { official, apiKey, userToken, officialOpen, busy: officialBusy, autoKey },
            {
              setApiKey, setUserToken,
              setOfficialOpen: (v) => {
                setOfficialOpen(v)
                if (v && autoKey === null) setAutoNonce((n) => n + 1)
              },
              refreshOfficial,
              reProbeKey: () => setAutoNonce((n) => n + 1),
            },
          ),
        )
      }

      return el('div', { className: 'dshu-root' },
        el('div', { className: 'dshu-panel' }, head, collapsed ? null : body))
    }

    /* ---------------- 注册 UI ---------------- */
    const slots = ctx.get('slots')
    if (slots === undefined) return
    const layout = ctx.get('layout')

    // 1) 嵌入网页右侧栏（details 列；取代官方 tool-details 面板，提供 closeDetails）
    slots.inject('details', () => {
      const dispose = slots.register(
        {
          name: 'details',
          id: 'usagedisplay',
          priority: 1,
          inject: () => ({
            closeDetails: () => {
              try { ctx.get('layout')?.closeDetails() } catch { /* noop */ }
            },
          }),
        },
        (props) => el(UsagePanel, props),
      )
      // 激活后自动打开右侧栏，让面板立即可见
      try { layout?.openDetails() } catch { /* noop */ }
      return dispose
    })

    // 2) 会话头部加"📊 用量"开关按钮（加性槽位，不替换现有按钮），关闭后一键重新打开
    slots.inject('conversation.session.header.actions', () => slots.register(
      { name: 'conversation.session.header.actions', id: 'usagedisplay', order: 999, label: () => '用量显示' },
      () => el('button', {
        className: 'dshu-head-toggle',
        title: '打开用量面板',
        onClick: () => {
          try { ctx.get('layout')?.openDetails() } catch { /* noop */ }
        },
      }, '📊 用量'),
    ))

    // 3) cordis_run 卡片内的一行状态（最新 Run 卡内联展示）
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => el('div', { className: 'dshu-runchip', style: {
        display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
        color: 'var(--dsw-alias-label-secondary, rgb(207, 211, 214))',
        padding: '6px 10px', borderRadius: 8,
        background: 'var(--dsw-specific-input-major, rgb(33, 33, 35))',
        border: '1px solid var(--dsw-static-neutral-bluish-850, rgb(44, 44, 46))',
        marginTop: 6,
      } },
        el('span', { style: { width: 8, height: 8, borderRadius: '50%', background: 'var(--dsw-alias-state-success-primary, rgb(34, 197, 94))', flex: 'none' } }),
        '📊 用量显示已嵌入右侧栏（会话头部 📊 用量 可重新打开；✕ 关闭）。'),
    ))
  },
}
