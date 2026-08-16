'use strict'

/**
 * Dynamic-plugin release contract shared by the builder and verifier.
 * `main` is the supported update channel; this project does not publish
 * a separate floating-window dynamic-plugin release.
 *
 * Version history:
 *   1.x  — legacy `main / details-sidebar` packages (DSH `details` sidebar).
 *   2.0.0 — the only current release, `main / embedded-grid-column`
 *           (DSH right-side fourth column with 用量 / 文件 tabs).
 * Any package whose version/release marker is not exactly 2.0.0 /
 * `main / embedded-grid-column` is NOT the latest version and must not be
 * deployed.
 */
module.exports = Object.freeze({
  channel: 'main',
  id: 'embedded-grid-column',
  version: '2.0.0',
  name: '用量显示',
  purpose: '当前稳定版（main / embedded-grid-column，v2.0.0）：在 DSH Web GUI 右侧新增第四列，显示当前会话用量与文件视图。验收应看到“用量 / 文件”、加载遮罩和回合用量标注；不是旧的 details 侧栏，也不是右下角悬浮窗。',
})
