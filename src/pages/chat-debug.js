/**
 * 检测与修复页面 — 杀毒软件风格
 * 一键检测 + 一键修复，简洁易懂
 */
import { api, getRequestLogs, clearRequestLogs, isTauriRuntime } from '../lib/tauri-api.js'
import { wsClient } from '../lib/ws-client.js'
import { isOpenclawReady, isGatewayRunning } from '../lib/app-state.js'
import { isForeignGatewayError, showGatewayConflictGuidance } from '../lib/gateway-ownership.js'
import { icon, statusIcon } from '../lib/icons.js'
import { toast } from '../components/toast.js'
import { showUpgradeModal } from '../components/modal.js'
import { navigate } from '../router.js'
import { t } from '../lib/i18n.js'

/* ── 日志工具 ── */
const _debugLog = (() => {
  let _invoke = null
  let _invokeReady = false
  const _pendingLogs = []
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    import('@tauri-apps/api/core').then(m => {
      _invoke = m.invoke
      _invokeReady = true
      while (_pendingLogs.length > 0) {
        const log = _pendingLogs.shift()
        _invoke('panel_log_command', { message: log }).catch(() => {})
      }
    }).catch(() => {})
  }
  const MAX_LEN = 2000
  return (tag, msg) => {
    const line = `[${new Date().toLocaleTimeString()}] [chatDebug][${tag}] ${msg}`
    console.log(line)
    const logMsg = line.length > MAX_LEN ? line.slice(0, MAX_LEN) + '...(truncated)' : line
    if (_invokeReady && _invoke) {
      _invoke('panel_log_command', { message: logMsg }).catch(() => {})
    } else if (_invokeReady === false && window.__TAURI_INTERNALS__) {
      if (_pendingLogs.length < 100) _pendingLogs.push(logMsg)
    }
  }
})()

/* ── 状态 ── */
let _scanning = false
let _fixing = false
let _results = null // { items: [{label, ok, detail}], hasIssues, fixable }
let _page = null

/* ── CSS 注入（扫描动画） ── */
const SCAN_CSS_ID = 'scan-anim-css'
function injectScanCSS() {
  if (document.getElementById(SCAN_CSS_ID)) return
  const style = document.createElement('style')
  style.id = SCAN_CSS_ID
  style.textContent = `
    @keyframes scan-ring { 0% { transform: rotate(0deg) } 100% { transform: rotate(360deg) } }
    @keyframes scan-pulse { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.08); opacity: .85 } }
    @keyframes scan-item-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
    @keyframes result-pop { from { opacity:0; transform:scale(.9) } to { opacity:1; transform:scale(1) } }
    .scan-hero { display:flex; flex-direction:column; align-items:center; padding:48px 0 32px }
    .scan-circle { position:relative; width:180px; height:180px; cursor:pointer; user-select:none }
    .scan-circle.disabled { pointer-events:none; opacity:.6 }
    .scan-ring-outer { position:absolute; inset:0; border-radius:50%; border:3px solid var(--border); transition:border-color .3s }
    .scan-circle:hover .scan-ring-outer { border-color:var(--accent) }
    .scan-ring-spin { position:absolute; inset:-4px; border-radius:50%; border:3px solid transparent; border-top-color:var(--accent); animation:scan-ring 1.2s linear infinite; display:none }
    .scanning .scan-ring-spin { display:block }
    .scanning .scan-ring-outer { border-color:var(--accent) }
    .scan-inner { position:absolute; inset:16px; border-radius:50%; background:var(--bg-secondary); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; transition:background .3s,box-shadow .3s }
    .scan-circle:hover .scan-inner { background:var(--bg-tertiary,var(--bg-secondary)); box-shadow:0 0 24px rgba(99,102,241,.1) }
    .scanning .scan-inner { animation:scan-pulse 1.5s ease-in-out infinite }
    .scan-icon { width:40px; height:40px; color:var(--accent) }
    .scan-label { font-size:15px; font-weight:600; color:var(--text-primary) }
    .scan-sub { font-size:12px; color:var(--text-tertiary); margin-top:4px }
    .result-summary { animation:result-pop .3s ease-out; display:flex; align-items:center; gap:12px; padding:16px 20px; border-radius:12px; margin:0 auto 24px; max-width:480px }
    .result-summary.ok { background:var(--success-bg,#f0fdf4); border:1px solid var(--success-border,#86efac) }
    .result-summary.warn { background:var(--warning-bg,#fffbeb); border:1px solid var(--warning-border,#fde68a) }
    .result-summary.err { background:var(--error-bg,#fef2f2); border:1px solid var(--error-border,#fca5a5) }
    .result-icon { font-size:32px; flex-shrink:0 }
    .result-text-title { font-size:16px; font-weight:700 }
    .result-text-desc { font-size:13px; color:var(--text-secondary); margin-top:2px }
    .scan-items { max-width:520px; margin:0 auto; display:flex; flex-direction:column; gap:6px }
    .scan-item { display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius:10px; background:var(--bg-secondary); animation:scan-item-in .25s ease-out both; font-size:13px }
    .scan-item .si-icon { flex-shrink:0; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px }
    .scan-item .si-icon.ok { background:#dcfce7; color:#16a34a }
    .scan-item .si-icon.err { background:#fee2e2; color:#dc2626 }
    .scan-item .si-icon.warn { background:#fef3c7; color:#d97706 }
    .scan-item .si-label { flex:1; min-width:0 }
    .scan-item .si-detail { font-size:11px; color:var(--text-tertiary); margin-top:1px }
    .fix-btn-area { text-align:center; margin:20px 0 8px }
    .fix-btn { padding:10px 32px; font-size:15px; font-weight:600; border-radius:10px; background:var(--accent); color:#fff; border:none; cursor:pointer; transition:opacity .2s,transform .2s }
    .fix-btn:hover { opacity:.9; transform:translateY(-1px) }
    .fix-btn:disabled { opacity:.5; cursor:not-allowed; transform:none }
    .advanced-toggle { text-align:center; margin-top:28px; font-size:12px; color:var(--text-tertiary); cursor:pointer; user-select:none }
    .advanced-toggle:hover { color:var(--accent) }
    .advanced-panel { display:none; margin-top:12px; padding:16px; background:var(--bg-secondary); border-radius:10px }
    .advanced-panel.open { display:block }
    .adv-btn { padding:6px 14px; font-size:12px; border-radius:6px; border:1px solid var(--border); background:var(--bg-primary); color:var(--text-primary); cursor:pointer; transition:border-color .2s }
    .adv-btn:hover { border-color:var(--accent) }
    .adv-btn:disabled { opacity:.5 }
    .adv-output { margin-top:12px; background:var(--bg-primary); border-radius:8px; padding:12px; font-size:11px; max-height:300px; overflow:auto; white-space:pre-wrap; word-break:break-all; display:none }
  `
  document.head.appendChild(style)
}

/* ── 渲染 ── */
export async function render() {
  _debugLog('render', '页面渲染开始')
  injectScanCSS()
  const page = document.createElement('div')
  page.className = 'page'
  _page = page
  _results = null

  renderPage(page)
  _debugLog('render', '页面渲染完成')
  return page
}

export function cleanup() {
  _debugLog('cleanup', '页面清理')
  _page = null
}

function renderPage(page) {
  const shieldIcon = `<svg class="scan-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`
  const loadingIcon = `<svg class="scan-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:scan-ring 1s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>`

  let html = `<div class="scan-hero">
    <div class="scan-circle${_scanning ? ' scanning' : ''}${_scanning || _fixing ? ' disabled' : ''}" id="scan-btn">
      <div class="scan-ring-outer"></div>
      <div class="scan-ring-spin"></div>
      <div class="scan-inner">
        ${_scanning ? loadingIcon : shieldIcon}
        <span class="scan-label">${_scanning ? t('chatDebug.scanning') : t('chatDebug.startScan')}</span>
      </div>
    </div>
    <div class="scan-sub">${_scanning ? t('chatDebug.scanningHint') : (_results ? t('chatDebug.clickRescan') : t('chatDebug.clickToScan'))}</div>
  </div>`

  if (_results && !_scanning) {
    const issueCount = _results.items.filter(i => !i.ok && !i.warn).length
    const warnCount = _results.items.filter(i => !i.ok && i.warn).length
    const totalCount = _results.items.length
    if (issueCount === 0 && warnCount === 0) {
      html += `<div class="result-summary ok"><span class="result-icon">✅</span><div><div class="result-text-title">${t('chatDebug.allHealthy')}</div><div class="result-text-desc">${t('chatDebug.allHealthyDesc', { count: totalCount })}</div></div></div>`
    } else if (issueCount === 0 && warnCount > 0) {
      html += `<div class="result-summary warn"><span class="result-icon">💡</span><div><div class="result-text-title">${t('chatDebug.warningsOnly', { count: warnCount })}</div><div class="result-text-desc">${t('chatDebug.warningsOnlyDesc')}</div></div></div>`
    } else {
      html += `<div class="result-summary err"><span class="result-icon">⚠️</span><div><div class="result-text-title">${t('chatDebug.issuesCount', { count: issueCount })}</div><div class="result-text-desc">${t('chatDebug.issuesCountDesc')}</div></div></div>`
    }

    html += `<div class="scan-items">`
    _results.items.forEach((item, i) => {
      const cls = item.ok ? 'ok' : (item.warn ? 'warn' : 'err')
      const icon = item.ok ? '✓' : (item.warn ? '!' : '✕')
      html += `<div class="scan-item" style="animation-delay:${i * 60}ms">
        <div class="si-icon ${cls}">${icon}</div>
        <div class="si-label">${esc(item.label)}${item.detail ? `<div class="si-detail">${esc(item.detail)}</div>` : ''}</div>
      </div>`
    })
    html += `</div>`

    if ((issueCount > 0) && _results.fixable) {
      html += `<div class="fix-btn-area"><button class="fix-btn" id="fix-btn"${_fixing ? ' disabled' : ''}>${_fixing ? t('chatDebug.fixingNow') : t('chatDebug.oneClickFix')}</button></div>`
    }
  }

  // 高级工具（折叠）
  html += `<div class="advanced-toggle" id="adv-toggle">▾ ${t('chatDebug.advancedTools')}</div>
  <div class="advanced-panel" id="adv-panel">
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
      <button class="adv-btn" id="adv-doctor-check">${t('chatDebug.btnDiagConfig')}</button>
      <button class="adv-btn" id="adv-doctor-fix">${t('chatDebug.btnAutoFix')}</button>
      <button class="adv-btn" id="adv-conn-diag">${t('chatDebug.btnConnDiag')}</button>
      <button class="adv-btn" id="adv-test-ws">${t('chatDebug.btnTestWs')}</button>
      <button class="adv-btn" id="adv-fix-pairing">${t('chatDebug.btnFixPairing')}</button>
      <button class="adv-btn" id="adv-network-log">${t('chatDebug.btnNetworkLog')}</button>
    </div>
    <div class="adv-output" id="adv-output"></div>
  </div>`

  page.innerHTML = html
  bindEvents(page)
}

function bindEvents(page) {
  page.querySelector('#scan-btn')?.addEventListener('click', () => runScan(page))
  page.querySelector('#fix-btn')?.addEventListener('click', () => runFix(page))
  page.querySelector('#adv-toggle')?.addEventListener('click', () => {
    const panel = page.querySelector('#adv-panel')
    panel?.classList.toggle('open')
  })
  // 高级工具
  page.querySelector('#adv-doctor-check')?.addEventListener('click', () => handleDoctorAdv(page, false))
  page.querySelector('#adv-doctor-fix')?.addEventListener('click', () => handleDoctorAdv(page, true))
  page.querySelector('#adv-conn-diag')?.addEventListener('click', () => runConnDiagAdv(page))
  page.querySelector('#adv-test-ws')?.addEventListener('click', () => testWebSocketAdv(page))
  page.querySelector('#adv-fix-pairing')?.addEventListener('click', () => fixPairingAdv(page))
  page.querySelector('#adv-network-log')?.addEventListener('click', () => toggleNetworkLogAdv(page))
}

/* ── 一键检测 ── */
async function runScan(page) {
  if (_scanning || _fixing) return
  _debugLog('runScan', '开始一键检测')
  _scanning = true
  _results = null
  renderPage(page)

  const items = []
  let fixable = false

  try {
    // 并行检测
    _debugLog('runScan', '并行检测: readOpenclawConfig, getServicesStatus, getVersionInfo, checkNode')
    const [configRes, servicesRes, versionRes, nodeRes] = await Promise.allSettled([
      api.readOpenclawConfig(),
      api.getServicesStatus(),
      api.getVersionInfo(),
      api.checkNode(),
    ])
    _debugLog('runScan', `检测完成: config=${configRes.status}, services=${servicesRes.status}, version=${versionRes.status}, node=${nodeRes.status}`)

    const config = configRes.status === 'fulfilled' ? configRes.value : null
    const services = servicesRes.status === 'fulfilled' ? servicesRes.value : null
    const version = versionRes.status === 'fulfilled' ? versionRes.value : null
    const node = nodeRes.status === 'fulfilled' ? nodeRes.value : null
    const gw = services?.[0]

    // 1. OpenClaw 安装
    const cliInstalled = gw?.cli_installed !== false
    items.push({ label: t('chatDebug.scanCliInstall'), ok: cliInstalled, detail: cliInstalled ? (version?.current || '') : t('chatDebug.scanCliMissing') })
    if (!cliInstalled) fixable = true

    // 2. Node.js
    items.push({ label: 'Node.js', ok: !!node?.installed, detail: node?.installed ? (node.version || '') : t('chatDebug.scanNodeMissing') })

    // 3. 配置文件
    const configOk = !!config && configRes.status !== 'rejected'
    items.push({ label: t('chatDebug.scanConfig'), ok: configOk, detail: configOk ? '' : (configRes.reason?.message || t('chatDebug.scanConfigMissing')) })
    if (!configOk) fixable = true

    // 4. Gateway 运行
    const gwRunning = !!gw?.running
    items.push({ label: 'Gateway', ok: gwRunning, detail: gwRunning ? `PID ${gw.pid}` : t('chatDebug.scanGwStopped') })
    if (!gwRunning) fixable = true

    // 5. WebSocket 连接
    const wsOk = wsClient.connected && wsClient.gatewayReady
    items.push({ label: 'WebSocket', ok: wsOk, detail: wsOk ? (wsClient.serverVersion ? `Gateway ${wsClient.serverVersion}` : t('chatDebug.connected')) : t('chatDebug.scanWsDown') })
    if (!wsOk && gwRunning) fixable = true

    // 6. Token 配置
    const hasToken = !!config?.gateway?.auth?.token
    items.push({ label: t('chatDebug.scanToken'), ok: hasToken, warn: !hasToken, detail: hasToken ? '' : t('chatDebug.scanTokenMissing') })

    // 7. 设备密钥
    let deviceOk = false
    try {
      const rawToken = config?.gateway?.auth?.token
      const token = (typeof rawToken === 'string') ? rawToken : ''
      await api.createConnectFrame('test-nonce', token)
      deviceOk = true
    } catch {}
    items.push({ label: t('chatDebug.scanDeviceKey'), ok: deviceOk, detail: deviceOk ? '' : t('chatDebug.scanDeviceKeyFail') })
    if (!deviceOk) fixable = true

    // 8. 版本
    if (version?.ahead_of_recommended) {
      items.push({ label: t('chatDebug.scanVersion'), ok: true, warn: true, detail: t('chatDebug.scanVersionAhead', { current: version.current, recommended: version.recommended }) })
    } else if (version?.is_recommended) {
      items.push({ label: t('chatDebug.scanVersion'), ok: true, detail: version.current || '' })
    } else if (version?.update_available) {
      items.push({ label: t('chatDebug.scanVersion'), ok: true, warn: true, detail: t('chatDebug.scanVersionUpdate', { version: version.recommended }) })
    }

    // 9. 连接诊断（仅在 Gateway 运行时）
    if (gwRunning) {
      try {
        const diag = await api.diagnoseGatewayConnection()
        const failedSteps = diag.steps?.filter(s => !s.ok) || []
        if (failedSteps.length > 0) {
          items.push({ label: t('chatDebug.scanConnDiag'), ok: false, detail: failedSteps.map(s => s.name).join(', ') })
          fixable = true
        } else {
          items.push({ label: t('chatDebug.scanConnDiag'), ok: true, detail: t('chatDebug.scanConnOk') })
        }
      } catch {}
    }

    _results = { items, hasIssues: items.some(i => !i.ok), fixable }
    _debugLog('runScan', `扫描结果: hasIssues=${_results.hasIssues}, fixable=${_results.fixable}, items=${_results.items.length}`)
  } catch (e) {
    _debugLog('runScan', `扫描异常: ${e?.message || e}`)
    items.push({ label: t('chatDebug.scanError'), ok: false, detail: String(e) })
    _results = { items, hasIssues: true, fixable: true }
  }

  _scanning = false
  _debugLog('runScan', '扫描结束')
  if (_page === page) renderPage(page)
}

/* ── 一键修复 ── */
async function runFix(page) {
  if (_fixing || _scanning) return
  _debugLog('runFix', '开始一键修复')
  _fixing = true
  renderPage(page)


  // 弹出模态修复弹框
  const modal = showUpgradeModal(t('chatDebug.fixModalTitle'))
    _debugLog('runFix', '修复弹框已打开')
 try {
  


 


    modal.setProgress(5)
    modal.appendLog('🔍 ' + t('chatDebug.fixCheckNode'))
    try {
      let nodeInfo = null
      try {
        nodeInfo = await api.checkNode()
      } catch {}

      if (nodeInfo?.installed) {
        // 已安装：保存检测到的路径，确保后续步骤能正确找到 Node.js
        modal.appendLog('✅ Node.js ' + (nodeInfo.version || 'OK'))
        if (nodeInfo.path) {
          try {
            await api.saveCustomNodePath(nodeInfo.path)
            modal.appendLog('📍 ' + t('chatDebug.fixNodePathSaved') + ': ' + nodeInfo.path)
          } catch {}
        }
      } else {
        // 未安装：扫描系统路径
        modal.appendLog('⚠️ ' + t('chatDebug.fixNodeNotInstalled'))
        modal.appendLog('🔍 ' + t('chatDebug.fixScanNodePaths'))
        let _unlistenNode = null
        try {
          if (window.__TAURI_INTERNALS__) {
            const { listen } = await import('@tauri-apps/api/event')
            _unlistenNode = await listen('fix-log', (e) => {
              if (e.payload) modal.appendLog(e.payload)
            })
          }
          const paths = await api.scanNodePaths()
          if (paths && paths.length > 0) {
            modal.appendLog('📍 ' + t('chatDebug.fixNodeFound') + ': ' + paths[0].path)
            await api.saveCustomNodePath(paths[0].path)
            modal.appendLog('✅ ' + t('chatDebug.fixNodePathSaved'))
          } else {
            // 扫描无结果，尝试自动安装 Node.js，流式输出安装日志
            modal.appendLog('⚠️ ' + t('chatDebug.fixNodeNotFound'))
            modal.appendLog('🔧 ' + t('chatDebug.fixNodeInstalling'))
            let _unlistenNodeInstallLog = null
            let _unlistenNodeInstallDone = null
            let _unlistenNodeInstallError = null
            try {
              if (window.__TAURI_INTERNALS__) {
                const { listen } = await import('@tauri-apps/api/event')
                _unlistenNodeInstallLog = await listen('upgrade-log', (e) => {
                  if (e.payload) modal.appendLog(e.payload)
                })
                _unlistenNodeInstallDone = await listen('upgrade-done', (e) => {
                  if (e.payload && typeof e.payload === 'string') modal.appendLog('✅ ' + e.payload)
                })
                _unlistenNodeInstallError = await listen('upgrade-error', (e) => {
                  if (e.payload) modal.appendLog('❌ ' + e.payload)
                })
              }
              await api.autoInstallNode()
              modal.appendLog('✅ ' + t('chatDebug.fixNodeInstallDone'))
            } catch (e) {
              modal.appendLog('❌ ' + t('chatDebug.fixNodeInstallFail') + ': ' + (e?.message || e))
              // 检测是否是 winget 失败但已尝试离线安装
              if (e?.message?.includes('winget')) {
                modal.appendLog('🔄 ' + t('chatDebug.fixNodeInstallOffline'))
              }
              modal.appendLog('💡 ' + t('chatDebug.fixNodeInstallHint'))
            } finally {
              _unlistenNodeInstallLog?.()
              _unlistenNodeInstallDone?.()
              _unlistenNodeInstallError?.()
            }
          }
        } catch (e) {
          modal.appendLog('⚠️ ' + t('chatDebug.fixNodeScanFail') + ': ' + (e?.message || e))
        } finally {
          _unlistenNode?.()
        }
      }
    } catch (e) {
      modal.appendLog('⚠️ ' + t('chatDebug.fixNodeScanFail') + ': ' + (e?.message || e))
    }




   
    // 步骤 2: 检查并修复配置文件
    modal.setProgress(12)
    modal.appendLog('📄 ' + t('chatDebug.fixCheckConfig'))
    let configOk = false
    try {
      const cfg = await api.readOpenclawConfig()
      if (cfg) {
        configOk = true
        modal.appendLog('✅ ' + t('chatDebug.fixConfigOk'))
      }
    } catch {}
    if (!configOk) {
      modal.appendLog('⚠️ ' + t('chatDebug.fixConfigMissing'))
      modal.appendLog('🔧 ' + t('chatDebug.fixConfigInit'))
      try {
        await api.initOpenclawConfig()
        modal.appendLog('✅ ' + t('chatDebug.fixConfigInitDone'))
      } catch (e) {
        modal.appendLog('❌ ' + t('chatDebug.fixConfigInitFail') + ': ' + (e?.message || e))
      }
    }

    modal.appendLog('🔍 ' + t('chatDebug.fixCheckOpenclaw'))
    modal.setProgress(18)
    let servicesInfo = null
    try {
      servicesInfo = await api.getServicesStatus()
    } catch {}
    const _gw = servicesInfo?.[0]
    const cliInstalled = _gw?.cli_installed !== false
    let _installFailed = false

    if (!cliInstalled) {
      modal.appendLog('⚠️ ' + t('chatDebug.fixOpenclawNotInstalled'))
      // 先尝试扫描已有 OpenClaw 安装路径
      modal.appendLog('🔍 ' + t('chatDebug.fixScanOpenclawPaths'))
      modal.setProgress(17)
      let openclawFound = false
      try {
        const clawPaths = await api.scanOpenclawPaths()
        if (clawPaths && clawPaths.length > 0) {
          modal.appendLog('📍 ' + t('chatDebug.fixOpenclawFoundAt') + ': ' + clawPaths[0].path)
          // 保存找到的路径
          const cfg = await api.readPanelConfig()
          cfg.openclawCliPath = clawPaths[0].path
          await api.writePanelConfig(cfg)
          modal.appendLog('✅ ' + t('chatDebug.fixOpenclawPathSaved'))
          openclawFound = true
        }
      } catch {}

      if (!openclawFound) {
        let _unlistenLog = null, _unlistenProgress = null, _unlistenDone = null, _unlistenError = null
        const _cleanup = () => { _unlistenLog?.(); _unlistenProgress?.(); _unlistenDone?.(); _unlistenError?.() }

        try {
          if (window.__TAURI_INTERNALS__) {
            const { listen } = await import('@tauri-apps/api/event')
            _unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
            _unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))

            let _resolveInstall, _rejectInstall
            const _installDone = new Promise((resolve, reject) => {
              _resolveInstall = resolve
              _rejectInstall = reject
            })
            _unlistenDone = await listen('upgrade-done', (e) => _resolveInstall(e.payload))
            _unlistenError = await listen('upgrade-error', (e) => _rejectInstall(new Error(String(e.payload || t('common.unknown')))))

            let registry = 'https://registry.npmmirror.com'
            modal.appendLog(t('setup.setRegistry', { url: registry }))
            try { await api.setNpmRegistry(registry) } catch {}

            await api.upgradeOpenclaw('official', null, 'npm')
            modal.appendLog(t('setup.bgTaskStarted'))

            const _payload = await _installDone
            modal.appendLog(typeof _payload === 'string' ? _payload :'修复中')

            modal.appendLog(t('setup.installingGateway'))
            try {
              await api.installGateway()
              modal.appendHtmlLog(`${statusIcon('ok', 14)} ${t('setup.gatewayInstalled')}`)
            } catch (ge) {
              modal.appendHtmlLog(`${statusIcon('warn', 14)} ${t('setup.gatewayInstallFailed', { err: ge })}`)
            }

            try {
              const config = await api.readOpenclawConfig()
              if (config) {
                let patched = false
                if (!config.gateway) config.gateway = {}
                if (!config.gateway.mode) {
                  config.gateway.mode = 'local'
                  patched = true
                  modal.appendHtmlLog(`${statusIcon('ok', 14)} ${t('setup.gwModeSet')}`)
                }
                if (!config.tools || config.tools.profile !== 'full') {
                  config.tools = { profile: 'full', sessions: { visibility: 'all' }, ...(config.tools || {}) }
                  config.tools.profile = 'full'
                  if (!config.tools.sessions) config.tools.sessions = {}
                  config.tools.sessions.visibility = 'all'
                  patched = true
                  modal.appendHtmlLog(`${statusIcon('ok', 14)} ${t('setup.toolsFullEnabled')}`)
                }
                if (patched) await api.writeOpenclawConfig(config)
              }
            } catch (ce) {
              modal.appendHtmlLog(`${statusIcon('warn', 14)} ${t('setup.autoConfigFailed', { err: ce })}`)
            }

            toast(t('setup.installSuccess'), 'success')
          }
        } catch (e) {
          _cleanup()
          _installFailed = true
          const errStr = String(e?.message || e)
          modal.appendLog(errStr)
          await new Promise(r => setTimeout(r, 150))
          const fullLog = modal.getLogText() + '\n' + errStr
          const diagnosis = diagnoseInstallError(fullLog)
          modal.setError(diagnosis.title)
          if (diagnosis.hint) { modal.appendLog(''); modal.appendHtmlLog(`${statusIcon('info', 14)} ${diagnosis.hint}`) }
          if (diagnosis.command) modal.appendHtmlLog(`${icon('clipboard', 14)} ${diagnosis.command}`)
          if (window.__openAIDrawerWithError) {
            window.__openAIDrawerWithError({ title: diagnosis.title, error: fullLog, scene: t('setup.installScene'), hint: diagnosis.hint })
          }
        } finally {
          _cleanup()
        }
      }
    } else {
      modal.appendLog('✅ ' + t('chatDebug.fixOpenclawOk'))
    }

    if (_installFailed) {
      modal.setProgress(100)
      _fixing = false
      modal.onClose(() => {
        if (_page === page) runScan(page)
      })
      return
    }

    // 步骤 3: 自动配对设备
    modal.setProgress(30)
    modal.appendLog('🔗 ' + t('chatDebug.fixStepPairing'))
    let _unlistenPair = null
    try {
      if (window.__TAURI_INTERNALS__) {
        const { listen } = await import('@tauri-apps/api/event')
        _unlistenPair = await listen('fix-log', (e) => {
          if (e.payload) modal.appendLog(e.payload)
        })
      }
      await api.autoPairDevice()
      modal.appendLog('✅ ' + t('chatDebug.fixPairDone'))
    } catch (e) {
      modal.appendLog('⚠️ ' + t('chatDebug.fixPairFail') + ': ' + (e?.message || e))
    } finally {
      _unlistenPair?.()
    }

    // 步骤 4: 执行 doctor --fix（如果前面没执行过）
    if (cliInstalled) {
      modal.setProgress(45)
      modal.appendLog('🔧 ' + t('chatDebug.fixStepDoctor'))
      let _unlistenDoctor = null
      try {
        if (window.__TAURI_INTERNALS__) {
          const { listen } = await import('@tauri-apps/api/event')
          _unlistenDoctor = await listen('fix-log', (e) => {
            if (e.payload) modal.appendLog(e.payload)
          })
        }
        await api.doctorFix()
        modal.appendLog('✅ ' + t('chatDebug.fixDoctorDone'))
      } catch (e) {
        modal.appendLog('⚠️ ' + t('chatDebug.fixDoctorFail') + ': ' + (e?.message || e))
      } finally {
        _unlistenDoctor?.()
      }
    }

    // 步骤 5: 重启 Gateway
    modal.setProgress(60)
    modal.appendLog('⚡ ' + t('chatDebug.fixStepGateway'))
    let _unlistenGw = null
    try {
      if (window.__TAURI_INTERNALS__) {
        const { listen } = await import('@tauri-apps/api/event')
        _unlistenGw = await listen('fix-log', (e) => {
          if (e.payload) modal.appendLog(e.payload)
        })
      }
      await api.restartService('ai.openclaw.gateway')
      modal.appendLog('✅ ' + t('chatDebug.fixGwRestarted'))
    } catch (e) {
      if (isForeignGatewayError(e)) {
        modal.appendLog('⚠️ ' + t('chatDebug.fixGwForeign'))
        await openGatewayConflict(e)
      } else {
        modal.appendLog('⚠️ ' + (e?.message || e))
      }
    } finally {
      _unlistenGw?.()
    }

    // 步骤 6: 等待 Gateway 启动（自适应轮询：前几轮 2s，后续 3s，最多等 40s）
    modal.setProgress(70)
    modal.appendLog('⏳ ' + t('chatDebug.fixStepWaiting'))
    let gwStarted = false
    const GW_POLL_ROUNDS = 14
    for (let i = 0; i < GW_POLL_ROUNDS; i++) {
      // 前 4 轮每 2s 检查，之后每 3s（Gateway 通常 6~8s 内启动）
      const waitMs = i < 4 ? 2000 : 3000
      await new Promise(r => setTimeout(r, waitMs))
      try {
        const services = await api.getServicesStatus()
        if (services?.[0]?.running) {
          gwStarted = true
          break
        }
      } catch {}
      modal.appendLog('⏳ Gateway ' + t('chatDebug.fixStepWaiting') + ` (${i + 1}/${GW_POLL_ROUNDS})`)
      modal.setProgress(70 + Math.floor((i + 1) / GW_POLL_ROUNDS * 12))
    }
    modal.appendLog(gwStarted ? '✅ Gateway ' + t('chatDebug.fixGwStarted') : '⚠️ Gateway ' + t('chatDebug.fixGwTimeout'))

    // 步骤 7: WebSocket 重连
    modal.setProgress(85)
    if (!gwStarted) {
      modal.appendLog('⚠️ Gateway ' + t('chatDebug.fixGwTimeout') + ', skip WebSocket reconnect')
    } else {
      modal.appendLog('🔄 ' + t('chatDebug.fixStepWebSocket'))

      // 先订阅状态日志，再触发重连，确保不漏掉任何状态变化
      let unsubStatusLog = wsClient.onStatusChange((status, errorMsg) => {
        if (status === 'connecting' || status === 'reconnecting') {
          modal.appendLog('🔄 WebSocket ' + status + '...')
        } else if (status === 'error') {
          modal.appendLog('⚠️ WebSocket error: ' + (errorMsg || ''))
        } else if (status === 'auth_failed') {
          modal.appendLog('🔐 WebSocket auth_failed: ' + (errorMsg || ''))
        }
      })

      wsClient.reconnect()

      // 第一次等待：40s（INITIAL_RECONNECT_DELAY 10s + CHALLENGE_TIMEOUT 15s + 15s 余量）
      let result = await wsClient.waitForReady(40000)

      if (!result.ok && result.reason === 'timeout') {
        // 超时但非终态错误（网络抖动/Gateway 慢启动），主动再重连一次
        modal.appendLog('⏱ WebSocket 首次等待超时，主动重试...')
        wsClient.reconnect()
        result = await wsClient.waitForReady(25000)
      }

      unsubStatusLog()

      if (result.ok) {
        modal.appendLog('✅ WebSocket ' + t('chatDebug.connected'))
      } else if (result.reason === 'timeout') {
        modal.appendLog('⚠️ WebSocket ' + t('chatDebug.fixWsTimeout'))
      } else {
        modal.appendLog('⚠️ WebSocket ' + result.reason)
      }
    }

    // 完成
    modal.setProgress(100)
    modal.setDone(t('chatDebug.fixDone'))
    _debugLog('runFix', '修复完成')
  } catch (e) {
    _debugLog('runFix', `修复异常: ${e?.message || e}`)
    modal.setError(t('chatDebug.fixFailed') + ': ' + (e?.message || e))
  }

  _fixing = false

  // 弹框关闭后自动重新扫描
  modal.onClose(() => {
    _debugLog('runFix', '修复弹框关闭，自动重新扫描')
    if (_page === page) runScan(page)
  })
}

/* ── 高级工具 ── */
function showAdvOutput(page) {
  const el = page.querySelector('#adv-output')
  if (el) el.style.display = 'block'
  return el
}
function advLog(page, text, color) {
  const el = page.querySelector('#adv-output')
  if (!el) return
  el.style.display = 'block'
  el.style.color = color || 'var(--text-primary)'
  el.textContent = text
}

async function handleDoctorAdv(page, fix) {
  _debugLog('handleDoctorAdv', `开始 doctor ${fix ? 'fix' : 'check'}`)
  const btn = page.querySelector(fix ? '#adv-doctor-fix' : '#adv-doctor-check')
  if (btn) btn.disabled = true
  advLog(page, fix ? t('chatDebug.runningDoctorFix') : t('chatDebug.runningDoctor'))
  let _unlisten = null
  try {
    if (fix && window.__TAURI_INTERNALS__) {
      const { listen } = await import('@tauri-apps/api/event')
      const el = showAdvOutput(page)
      _unlisten = await listen('fix-log', (e) => {
        if (e.payload && el) {
          el.textContent += e.payload + '\n'
          el.scrollTop = el.scrollHeight
        }
      })
    }
    const result = fix ? await api.doctorFix() : await api.doctorCheck()
    let text = result.output || ''
    if (result.errors) text += '\n' + result.errors
    advLog(page, text.trim() || (result.success ? t('chatDebug.noIssues') : t('chatDebug.diagDone')), result.success ? 'var(--success)' : 'var(--warning)')
    if (fix && result.success) toast(t('chatDebug.configFixDone'), 'success')
    _debugLog('handleDoctorAdv', `doctor ${fix ? 'fix' : 'check'} 完成, success=${result.success}`)
  } catch (e) {
    _debugLog('handleDoctorAdv', `doctor 异常: ${e?.message || e}`)
    advLog(page, t('chatDebug.execFailed') + (e?.message || e), 'var(--error)')
  } finally {
    _unlisten?.()
    if (btn) btn.disabled = false
  }
}

const CONN_STEP_LABELS = {
  config: () => t('diagnose.stepConfig'),
  device_key: () => t('diagnose.stepDeviceKey'),
  allowed_origins: () => t('diagnose.stepOrigins'),
  tcp_port: () => t('diagnose.stepTcp'),
  http_health: () => t('diagnose.stepHttp'),
  err_log: () => t('diagnose.stepErrLog'),
}

async function runConnDiagAdv(page) {
  _debugLog('runConnDiagAdv', '开始连接诊断')
  const btn = page.querySelector('#adv-conn-diag')
  if (btn) btn.disabled = true
  advLog(page, t('diagnose.running'))
  try {
    const result = await api.diagnoseGatewayConnection()
    const lines = result.steps.map(s => `${s.ok ? '✅' : '❌'} ${CONN_STEP_LABELS[s.name]?.() || s.name} (${s.durationMs}ms)\n   ${s.message}`)
    advLog(page, (result.overallOk ? '✅ ' + t('diagnose.allPassed') : '⚠️ ' + result.summary) + '\n\n' + lines.join('\n\n'), result.overallOk ? 'var(--success)' : 'var(--warning)')
    _debugLog('runConnDiagAdv', `诊断完成: overallOk=${result.overallOk}, steps=${result.steps?.length}`)
  } catch (e) {
    _debugLog('runConnDiagAdv', `诊断异常: ${e?.message || e}`)
    advLog(page, String(e), 'var(--error)')
  } finally {
    if (btn) btn.disabled = false
  }
}

async function testWebSocketAdv(page) {
  _debugLog('testWebSocketAdv', '开始 WebSocket 测试')
  const el = showAdvOutput(page)
  if (!el) return
  el.textContent = ''
  const log = (msg) => { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight }

  log(t('chatDebug.wsTestStart'))
  try {
    const config = await api.readOpenclawConfig()
    const port = config?.gateway?.port || 18789
    const rawToken = config?.gateway?.auth?.token
    const token = (typeof rawToken === 'string') ? rawToken : ''
    const wsHost = isTauriRuntime() ? `127.0.0.1:${port}` : location.host
    const wsScheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${wsScheme}://${wsHost}/ws?token=${encodeURIComponent(token)}`
    log(`→ ${url}`)

    const ws = new WebSocket(url)
    ws.onopen = () => log('✅ ' + t('chatDebug.wsConnected'))
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        log('← ' + JSON.stringify(msg, null, 2))
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
          api.createConnectFrame(msg.payload?.nonce || '', token).then(frame => {
            ws.send(JSON.stringify(frame))
            log('→ connect frame sent')
          }).catch(e => log('❌ frame: ' + e))
        }
        if (msg.type === 'res' && msg.id?.startsWith('connect-')) {
          log(msg.ok ? '✅ Handshake OK' : '❌ Handshake failed: ' + (msg.error?.message || msg.error?.code))
        }
      } catch (e) { log('⚠ parse: ' + e) }
    }
    ws.onerror = () => { log('❌ WebSocket error'); _debugLog('testWebSocketAdv', 'WebSocket error') }
    ws.onclose = (e) => { log(`WebSocket closed (${e.code})`); _debugLog('testWebSocketAdv', `WebSocket closed, code=${e.code}`) }
  } catch (e) { log('❌ ' + e); _debugLog('testWebSocketAdv', `异常: ${e?.message || e}`) }
}

async function fixPairingAdv(page) {
  _debugLog('fixPairingAdv', '开始配对修复')
  const btn = page.querySelector('#adv-fix-pairing')
  if (btn) btn.disabled = true
  const el = showAdvOutput(page)
  if (!el) { if (btn) btn.disabled = false; return }
  el.textContent = ''
  const log = (msg) => { el.textContent += msg + '\n'; el.scrollTop = el.scrollHeight }

  try {
    log('🔧 ' + t('chatDebug.fixStarting'))
    log('📝 ' + t('chatDebug.fixWritingPair'))
    const result = await api.autoPairDevice()
    log('✅ ' + result)

    log('⚡ ' + t('chatDebug.fixStoppingGw'))
    try { await api.stopService('ai.openclaw.gateway') } catch (e) {
      if (isForeignGatewayError(e)) { await openGatewayConflict(e); throw e }
    }
    await new Promise(r => setTimeout(r, 3000))

    log('⚡ ' + t('chatDebug.fixStartingGw'))
    try { await api.startService('ai.openclaw.gateway') } catch (e) {
      if (isForeignGatewayError(e)) await openGatewayConflict(e)
      throw e
    }
    log('✅ ' + t('chatDebug.fixGwStartSent'))
    await new Promise(r => setTimeout(r, 5000))

    const services = await api.getServicesStatus()
    log(services?.[0]?.running ? '✅ Gateway running' : '⚠ Gateway may still be starting')

    log('🔄 ' + t('chatDebug.fixReconnecting'))
    wsClient.reconnect()
    const wsResult = await wsClient.waitForReady(35000)
    log(wsResult.ok ? '✅ WebSocket ' + t('chatDebug.connected') : '⚠️ WebSocket ' + (wsResult.reason === 'timeout' ? t('chatDebug.fixWsTimeout') : wsResult.reason))
    _debugLog('fixPairingAdv', `配对修复完成: wsOk=${wsResult.ok}`)
  } catch (e) {
    _debugLog('fixPairingAdv', `配对修复异常: ${e?.message || e}`)
    log('❌ ' + t('chatDebug.fixFailed') + ': ' + e)
  } finally {
    if (btn) btn.disabled = false
  }
}

function toggleNetworkLogAdv(page) {
  const el = showAdvOutput(page)
  if (!el) return
  const logs = getRequestLogs()
  if (logs.length === 0) { el.textContent = t('chatDebug.noRequests'); return }
  const total = logs.length
  const cached = logs.filter(l => l.cached).length
  let text = `Total: ${total} | Cached: ${cached}\n${'─'.repeat(60)}\n`
  for (let i = logs.length - 1; i >= Math.max(0, logs.length - 50); i--) {
    const l = logs[i]
    text += `${l.time} ${l.cmd} ${l.duration}${l.cached ? ' [cache]' : ''}\n`
  }
  el.textContent = text
}

async function openGatewayConflict(error = null) {
  const services = await api.getServicesStatus().catch(() => [])
  const gw = services?.find?.(s => s.label === 'ai.openclaw.gateway') || services?.[0] || null
  await showGatewayConflictGuidance({ error, service: gw })
}

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
