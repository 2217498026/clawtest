/**
 * 初始设置页面 — openclaw 未安装时的引导
 * 自动检测环境 → 版本选择 → 一键安装 → 自动跳转
 */
const _setupLog = (() => {
  let _invoke = null
  let _invokeReady = false
  const _pendingLogs = []
  
  // 异步加载 tauri invoke
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    import('@tauri-apps/api/core').then(m => {
      _invoke = m.invoke
      _invokeReady = true
      // 发送之前缓存的日志
      while (_pendingLogs.length > 0) {
        const log = _pendingLogs.shift()
        _invoke('panel_log_command', { message: log }).catch(() => {})
      }
    }).catch(() => {})
  }
  
  const MAX_LEN = 2000
  return (tag, msg) => {
    const line = `[setup][${tag}] ${msg}`
    // 始终输出到 console（方便调试）
    console.log(line)
    
    // 发送到后端文件日志
    const logMsg = line.length > MAX_LEN ? line.slice(0, MAX_LEN) + '...(truncated)' : line
    if (_invokeReady && _invoke) {
      _invoke('panel_log_command', { message: logMsg }).catch(() => {})
    } else if (_invokeReady === false && window.__TAURI_INTERNALS__) {
      // invoke 还没加载好，先缓存（最多缓存100条）
      if (_pendingLogs.length < 100) {
        _pendingLogs.push(logMsg)
      }
    }
  }
})()

import { api, invalidate } from '../lib/tauri-api.js'
import { showConfirm, showUpgradeModal } from '../components/modal.js'
import { toast } from '../components/toast.js'
import { setUpgrading, isMacPlatform } from '../lib/app-state.js'
import { getActiveEngine } from '../lib/engine-manager.js'
import { diagnoseInstallError } from '../lib/error-diagnosis.js'
import { icon, statusIcon } from '../lib/icons.js'
import { t } from '../lib/i18n.js'

function escapeHtml(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function openclawSourceLabel(src) {
  return ({
    standalone: t('dashboard.cliSourceStandalone'),
    'npm-zh': t('dashboard.cliSourceNpmZh'),
    'npm-official': t('dashboard.cliSourceNpmOfficial'),
    'npm-global': t('dashboard.cliSourceNpmGlobal'),
  })[src] || t('dashboard.cliSourceUnknown')
}

function parseOpenclawSearchPaths(raw) {
  const values = []
  const seen = new Set()
  for (const part of String(raw || '').split(/[\r\n;]+/)) {
    const value = part.trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    values.push(value)
  }
  return values
}

function buildStatusMeta(...parts) {
  return parts
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(' · ')
}

function renderDetectionHint(pathValue, sourceLabel = '') {
  const normalizedPath = String(pathValue || '').trim()
  const normalizedSource = String(sourceLabel || '').trim()
  if (!normalizedPath && !normalizedSource) return ''
  return `
    <div class="setup-inline-note" style="margin-top:8px;line-height:1.6">
      ${normalizedPath ? `<div><span style="color:var(--text-secondary)">${t('setup.detectedPathLabel')}:</span> <code class="setup-path-code" title="${escapeHtml(normalizedPath)}">${escapeHtml(normalizedPath)}</code></div>` : ''}
      ${normalizedSource ? `<div${normalizedPath ? ' style="margin-top:4px"' : ''}><span style="color:var(--text-secondary)">${t('setup.detectedFromLabel')}:</span> ${escapeHtml(normalizedSource)}</div>` : ''}
    </div>
  `
}

function renderStatusCard(title, ok, meta) {
  return `
    <div class="setup-status-card ${ok ? 'is-ok' : 'is-pending'}">
      <div class="setup-status-icon">${ok ? '✓' : '✦'}</div>
      <div class="setup-status-body">
        <div class="setup-status-title">${title}</div>
        <div class="setup-status-meta" title="${escapeHtml(meta)}">${escapeHtml(meta)}</div>
      </div>
    </div>
  `
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="setup-shell">
      <div class="setup-hero">
        <div class="setup-hero-brand">
          <img src="/images/logo-brand.png" alt="OpenClaw" class="setup-hero-logo">
          <div class="setup-hero-copy">
            <h1 class="setup-hero-title"></h1>
            <p class="setup-hero-desc">${t('setup.headerDesc')}</p>
            <div class="setup-hero-site-row">
           
            
            </div>
          </div>
        </div>
        <div class="setup-hero-actions">
          <button class="btn btn-secondary btn-sm" id="btn-recheck" style="min-width:120px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
            ${t('setup.recheck')}
          </button>
        </div>
      </div>

      <div id="setup-steps"></div>
    </div>
  `

  page.querySelector('#btn-recheck').addEventListener('click', () => runDetect(page))
  _setupLog('render', '页面渲染完成，开始 runDetect')
  runDetect(page)
  return page
}

async function maybeRefreshGatewayServiceBinding() {
  if (!isMacPlatform()) return false

  const [versionInfo, dirInfo] = await Promise.all([
    api.getVersionInfo().catch(() => null),
    api.getOpenclawDir().catch(() => null),
  ])
  if (!versionInfo?.cli_path || dirInfo?.configExists === false) {
    return false
  }

  const shouldRefresh = await showConfirm(t('settings.gatewayServiceRefreshConfirm'))
  if (!shouldRefresh) return false

  toast(t('settings.gatewayServiceRefreshing'), 'info')
  try {
    const services = await api.getServicesStatus().catch(() => [])
    const gw = services?.find?.(s => s.label === 'ai.openclaw.gateway') || services?.[0] || null
    const shouldStartAgain = gw?.running === true && gw?.owned_by_current_instance !== false

    await api.uninstallGateway().catch(() => {})
    await api.installGateway()
    if (shouldStartAgain) {
      await api.startService('ai.openclaw.gateway')
    }

    toast(t('settings.gatewayServiceRefreshed'), 'success')
    return true
  } catch (e) {
    toast(`${t('settings.gatewayServiceRefreshFailed')}: ${e?.message || e}`, 'warning')
    return false
  }
}

async function promptRestart(msg) {
  if (!window.__TAURI_INTERNALS__) { toast(msg, 'success'); return }
  const ok = await showConfirm(`${msg}\n\n${t('settings.restartConfirm')}`)
  if (ok) {
    toast(t('settings.restarting'), 'info')
    try { await api.relaunchApp() } catch { toast(t('settings.restartFailed'), 'warning') }
  } else {
    toast(`${msg}, ${t('settings.effectNextLaunch')}`, 'success')
  }
}

async function runDetect(page) {
  const stepsEl = page.querySelector('#setup-steps')
  stepsEl.innerHTML = `
    <div class="stat-card loading-placeholder" style="height:48px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
    <div class="stat-card loading-placeholder" style="height:48px;margin-top:8px"></div>
  `
  // 清除缓存，确保拿到最新检测结果
  invalidate('get_version_info', 'check_node', 'check_git', 'get_services_status', 'check_installation')
  // 并行检测 Node.js、Git、OpenClaw CLI、配置文件
  _setupLog('runDetect', '开始并行检测：checkNode, checkGit, getServicesStatus, checkInstallation, getVersionInfo')
  let nodeRes, gitRes, clawRes, configRes, versionRes
  try {
    ;[nodeRes, gitRes, clawRes, configRes, versionRes] = await Promise.allSettled([
      api.checkNode(),
      api.checkGit(),
      api.getServicesStatus(),
      api.checkInstallation(),
      api.getVersionInfo(),
    ])
  } catch (e) {
    console.error('[setup] 检测失败:', e)
    _setupLog('runDetect', `Promise.allSettled 抛出异常: ${e?.message || e}`)
    stepsEl.innerHTML = `<div class="stat-card" style="grid-column:1/-1;text-align:center;padding:24px;color:var(--text-secondary)"><p>${t('common.loadFailed')}: ${escapeHtml(String(e?.message || e))}</p><button class="btn btn-sm btn-secondary" style="margin-top:8px" onclick="this.closest('.page')&&location.reload()">${t('setup.recheck')}</button></div>`
    return
  }

  _setupLog('runDetect', `检测完成: nodeRes.status=${nodeRes.status}, gitRes.status=${gitRes.status}, clawRes.status=${clawRes.status}, configRes.status=${configRes.status}, versionRes.status=${versionRes.status}`)

  const node = nodeRes.status === 'fulfilled' ? nodeRes.value : { installed: false }
  const git = gitRes.status === 'fulfilled' ? gitRes.value : { installed: false }
  const cliOk = clawRes.status === 'fulfilled'
    && clawRes.value?.length > 0
    && clawRes.value[0]?.cli_installed !== false
  let config = configRes.status === 'fulfilled' ? configRes.value : { installed: false }
  const version = versionRes.status === 'fulfilled' ? versionRes.value : null

  // 兜底：services 加载失败时，若 openclaw.json 存在则认为 CLI 已安装
  const cliOkFinal = cliOk || (config.installed === true)

  // Git 已安装时，自动配置 HTTPS 替代 SSH（静默执行）
  if (git.installed) {
    api.configureGitHttps().catch(() => {})
  }

  const nodeOk = node.installed
  const allOk = nodeOk && cliOkFinal && config.installed

  _setupLog('runDetect', `检测结果: node=${node.installed}, git=${git?.installed}, cliOk=${cliOkFinal}, config.installed=${config.installed}, nodeOk=${nodeOk}, allOk=${allOk}`)

  // 全部通过 → 自动跳转到仪表盘
  if (allOk) {
    _setupLog('runDetect', '所有检测通过，自动跳转到 /dashboard')
    const engine = getActiveEngine()
    if (engine?.detect) await engine.detect()
    window.location.hash = '/dashboard'
    return
  }

  renderSteps(page, { node, git, cliOk: cliOkFinal, config, version })
}

function stepIcon(ok) {
  const color = ok ? 'var(--success)' : 'var(--text-tertiary)'
  return `<span style="color:${color};font-weight:700;width:18px;display:inline-block">${ok ? '✓' : '✗'}</span>`
}

function renderSteps(page, { node, git, cliOk, config, version }) {
  const stepsEl = page.querySelector('#setup-steps')
  const nodeOk = node.installed
  const gitOk = git?.installed || false
  const allOk = nodeOk && cliOk && config.installed
  const nodeStatusMeta = nodeOk
    ? buildStatusMeta(node.version || t('setup.statusReady'), node.path)
    : t('setup.statusActionNeeded')
  const gitStatusMeta = gitOk
    ? buildStatusMeta(git.version || t('setup.statusReady'), git.path)
    : t('setup.statusActionNeeded')
  const cliPrimaryMeta = cliOk
    ? buildStatusMeta(version?.cli_source ? openclawSourceLabel(version.cli_source) : '', version?.current ? `v${version.current}` : t('setup.statusReady'))
    : ''
  const cliStatusMeta = cliOk
    ? buildStatusMeta(cliPrimaryMeta, version?.cli_path)
    : t('setup.statusActionNeeded')
  const configStatusMeta = config.installed
    ? (config.path || t('setup.statusReady'))
    : t('setup.statusActionNeeded')

  const statusCards = [
    renderStatusCard(t('setup.stepNode'), nodeOk, nodeStatusMeta),
    renderStatusCard(t('setup.stepGit'), gitOk, gitStatusMeta),
    renderStatusCard('OpenClaw CLI', cliOk, cliStatusMeta),
    renderStatusCard(t('setup.stepConfig'), config.installed, configStatusMeta),
  ].join('')

  let html = `
    <div class="setup-status-grid">${statusCards}</div>
    <div class="setup-main-grid">
      <div class="setup-column">
  `

  // 第一步：Node.js
  if (!nodeOk) {
    html += `
      <div class="config-section" style="text-align:left">
        <div class="config-section-title" style="display:flex;align-items:center;gap:4px">
          ${stepIcon(nodeOk)} ${t('setup.stepNode')}
        </div>
        <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
          ${t('setup.stepNodeHint')}
        </p>
        <a class="btn btn-primary btn-sm" href="https://nodejs.org/" target="_blank" rel="noopener">${t('setup.downloadNode')}</a>
        <span class="form-hint" style="margin-left:8px">${t('setup.recheckAfterInstall')}</span>
        <div style="margin-top:var(--space-sm);padding:10px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.6">
          <strong>${t('setup.nodeInstalledButNotDetected')}</strong>
          ${isMacPlatform()
            ? `${t('setup.macNodeHint')}<br>
               <code style="background:var(--bg-secondary);padding:2px 6px;border-radius:3px;user-select:all">open /Applications/ClawPanel.app</code>`
            : `${t('setup.winNodeHint')}`
          }
          <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" id="btn-scan-node" style="font-size:11px;padding:3px 10px">${icon('search', 12)} ${t('setup.scanNodeBtn')}</button>
            <span style="color:var(--text-tertiary)">${t('setup.orManualPath')}</span>
          </div>
          <div class="setup-input-row" style="margin-top:6px">
            <input id="input-node-path" type="text" placeholder="${isMacPlatform() ? '/usr/local/bin' : 'F:\\AI\\Node'}"
              style="flex:1;padding:4px 8px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-family:monospace">
            <button class="btn btn-primary btn-sm" id="btn-check-path" style="font-size:11px;padding:3px 10px">${t('setup.checkPathBtn')}</button>
          </div>
          <div id="scan-result" style="margin-top:6px;display:none"></div>
        </div>
      </div>
    `
  }

  // 第二步：Git
  if (!gitOk) {
    html += `
      <div class="config-section" style="text-align:left;${nodeOk ? '' : 'opacity:0.65;pointer-events:none'}">
        <div class="config-section-title" style="display:flex;align-items:center;gap:4px">
          ${stepIcon(gitOk)} ${t('setup.stepGit')}
        </div>
        <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm);line-height:1.5">
          ${t('setup.stepGitHint')}
        </p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="btn-auto-install-git">${t('setup.autoInstallGitBtn')}</button>
          <a class="btn btn-secondary btn-sm" href="https://git-scm.com/downloads" target="_blank" rel="noopener">${t('setup.manualDownload')}</a>
        </div>
        <div id="git-install-result" style="margin-top:var(--space-sm);display:none"></div>
        <div style="margin-top:8px;font-size:var(--font-size-xs);color:var(--text-tertiary);line-height:1.5">
          ${t('setup.gitOptionalHint')}
        </div>
      </div>
    `
  }

  // 第三步：OpenClaw CLI
  html += `
    <div class="config-section" style="text-align:left;${nodeOk ? '' : 'opacity:0.65;pointer-events:none'}">
      <div class="config-section-title" style="display:flex;align-items:center;gap:4px">
        ${stepIcon(cliOk)} OpenClaw CLI
      </div>
      ${cliOk
        ? `<p style="color:var(--success);font-size:var(--font-size-sm)">${t('setup.cliAvailable')}</p>
           ${renderDetectionHint(version?.cli_path, version?.cli_source ? openclawSourceLabel(version.cli_source) : '')}
           ${version?.ahead_of_recommended && version?.recommended
             ? `<div style="margin-top:8px;padding:8px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);color:var(--warning,#f59e0b);line-height:1.6">
                  ${t('setup.cliAheadWarning', { current: version.current || '', recommended: version.recommended })}
                </div>`
             : ''}`
        : renderInstallSection()
      }
    </div>
  `

  html += `
      </div>
      <div class="setup-column">
  `

  // 第四步：配置文件 + 自定义路径
  html += `
    <div class="config-section" style="text-align:left">
      <div class="config-section-title" style="display:flex;align-items:center;gap:4px">
        ${stepIcon(config.installed)} ${t('setup.stepConfig')}
      </div>
      ${config.installed
        ? `<p class="setup-path-text" style="color:var(--success);font-size:var(--font-size-sm)" title="${escapeHtml(config.path || '')}">${t('setup.configAt', { path: config.path || '' })}</p>
           ${renderDetectionHint(config.path)}`
        : `<p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
            ${t('setup.configMissing')}
          </p>
          ${renderDetectionHint(config.path)}
          <button class="btn btn-primary btn-sm" id="btn-init-config" style="margin-top:10px">${t('setup.initConfigLabel')}</button>`
      }
      <details style="margin-top:var(--space-sm);cursor:pointer" id="custom-dir-details">
        <summary style="font-size:var(--font-size-xs);color:var(--text-secondary);font-weight:600;user-select:none">
          ${t('setup.customDirTitle')}
        </summary>
        <div style="margin-top:var(--space-sm);padding:10px 12px;background:var(--bg-tertiary);border-radius:var(--radius-sm);font-size:var(--font-size-xs);line-height:1.6">
          <p style="color:var(--text-secondary);margin-bottom:8px">
            ${t('setup.customDirHint')}
          </p>
          <div class="setup-inline-note" style="margin-bottom:8px">${t('setup.customDirNotice')}</div>
          <div class="setup-input-row">
            <input id="input-openclaw-dir" type="text" placeholder="${t('setup.customDirPlaceholder')}"
              style="flex:1;padding:4px 8px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-family:monospace">
            <button class="btn btn-primary btn-sm" id="btn-save-openclaw-dir" style="font-size:11px;padding:3px 10px">${t('setup.saveBtn')}</button>
            <button class="btn btn-secondary btn-sm" id="btn-reset-openclaw-dir" style="font-size:11px;padding:3px 10px">${t('setup.resetDefaultBtn')}</button>
          </div>
          <div id="openclaw-dir-result" style="margin-top:6px;display:none"></div>
        </div>
      </details>
    </div>
  `

/*   // AI 助手入口
  html += `
    <div class="config-section" style="text-align:left">
      <div class="config-section-title" style="display:flex;align-items:center;gap:6px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
        ${t('setup.aiAssistant')}
      </div>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm);line-height:1.5">
        ${t('setup.aiAssistantDesc')}${!allOk ? t('setup.aiAssistantDescProblem') : ''}。
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary btn-sm" id="btn-goto-assistant">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/></svg>
          ${t('setup.openAiAssistant')}
        </button>
        ${!allOk ? `<button class="btn btn-primary btn-sm" id="btn-ask-ai-help">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="margin-right:4px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          ${t('setup.askAiHelp')}
        </button>` : ''}
      </div>
    </div>
  ` */

  html += `
      </div>
    </div>
  `

  if (!cliOk) {
    html += renderEnvironmentHint()
  }

  // 全部就绪 → 进入面板
  if (allOk) {
    html += `
      <div class="config-section" style="text-align:left;margin-top:var(--space-md)">
        <div class="config-section-title">${t('setup.nextStepsTitle')}</div>
        <div style="color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.7">
          ${t('setup.nextStepsDesc')}
          <ol style="margin:8px 0 0 18px;padding:0">
            <li>${t('setup.nextStep1')}</li>
            <li>${t('setup.nextStep2')}</li>
            <li>${t('setup.nextStep3')}</li>
          </ol>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-secondary btn-sm" id="btn-goto-models">${t('setup.configModels')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-gateway">${t('setup.gatewaySetup')}</button>
          <button class="btn btn-secondary btn-sm" id="btn-goto-channels">${t('setup.messageChannels')}</button>
        </div>
      </div>
      <div style="margin-top:var(--space-lg)">
        <button class="btn btn-primary" id="btn-enter" style="min-width:200px">${t('setup.enterPanel')}</button>
      </div>
    `
  }

  stepsEl.innerHTML = html
  bindEvents(page, nodeOk, { node, git, cliOk, config })
}

function renderInstallSection() {
  return `
    <div class="setup-search-panel">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:4px">${t('setup.searchOpenclawTitle')}</div>
      <div style="color:var(--text-secondary)">${t('setup.searchOpenclawDesc')}</div>
      <div class="setup-input-row" style="margin-top:8px">
        <button class="btn btn-secondary btn-sm" id="btn-scan-openclaw" style="font-size:11px;padding:3px 10px">${icon('search', 12)} ${t('setup.searchOpenclawBtn')}</button>
      </div>
      <div class="setup-inline-note" style="margin-top:12px">${t('setup.searchOpenclawHint')}</div>
      <details style="margin-top:12px;cursor:pointer" id="advanced-openclaw-search-details">
        <summary style="font-size:var(--font-size-xs);color:var(--text-secondary);font-weight:600;user-select:none">
          ${t('setup.searchOpenclawAdvancedTitle')}
        </summary>
        <div style="margin-top:var(--space-sm);display:flex;flex-direction:column;gap:12px">
          <div class="setup-inline-note">${t('setup.searchOpenclawAdvancedHint')}</div>
          <div>
            <label style="font-size:var(--font-size-xs);color:var(--text-secondary);display:block;margin-bottom:6px">${t('setup.searchOpenclawExtraPathsLabel')}</label>
            <textarea id="input-openclaw-search-paths" rows="3" placeholder="${t('setup.searchOpenclawExtraPathsPlaceholder')}"
              style="width:100%;padding:6px 8px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-family:monospace;resize:vertical;min-height:78px"></textarea>
            <div class="setup-input-row" style="margin-top:6px">
              <button class="btn btn-secondary btn-sm" id="btn-save-openclaw-search-paths" style="font-size:11px;padding:3px 10px">${t('setup.searchOpenclawExtraPathsSave')}</button>
            </div>
            <div class="setup-inline-note">${t('setup.searchOpenclawExtraPathsHint')}</div>
            <div id="openclaw-search-paths-result" style="margin-top:6px;display:none"></div>
          </div>
          <div>
            <label style="font-size:var(--font-size-xs);color:var(--text-secondary);display:block;margin-bottom:6px">${t('setup.searchOpenclawManualLabel')}</label>
            <div class="setup-input-row">
              <input id="input-openclaw-cli-path" type="text" placeholder="${t('setup.searchOpenclawManualPlaceholder')}"
                style="flex:1;padding:4px 8px;border:1px solid var(--border-primary);border-radius:var(--radius-sm);background:var(--bg-secondary);color:var(--text-primary);font-size:11px;font-family:monospace">
              <button class="btn btn-primary btn-sm" id="btn-check-openclaw-path" style="font-size:11px;padding:3px 10px">${t('setup.searchOpenclawManualBtn')}</button>
            </div>
            <div class="setup-inline-note">${t('setup.searchOpenclawManualHint')}</div>
          </div>
        </div>
      </details>
      <div id="scan-openclaw-result" style="margin-top:8px;display:none"></div>
    </div>
    <div class="setup-install-panel">
      <div style="font-weight:600;color:var(--text-primary);margin-bottom:6px">${t('setup.installOpenclaw')}</div>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);margin-bottom:var(--space-sm)">
        ${t('setup.installHint')}
      </p>
      <p style="color:var(--text-tertiary);font-size:var(--font-size-xs);line-height:1.6;margin:-4px 0 var(--space-sm)">
        ${t('setup.installHint2')}
      </p>
      <div style="display:flex;gap:var(--space-sm);margin-bottom:var(--space-sm)">
   
        <label class="setup-source-option" style="flex:1;cursor:pointer">
          <input type="radio" name="install-source" value="official" style="margin-right:6px">
          <div>
            <div style="font-weight:600;font-size:var(--font-size-sm)">${t('setup.sourceOfficialLabel')}</div>
            <div style="font-size:var(--font-size-xs);color:var(--text-tertiary)">openclaw</div>
          </div>
        </label>
      </div>
      <div style="margin-bottom:var(--space-sm)" id="install-method-section">
        <label style="font-size:var(--font-size-xs);color:var(--text-tertiary);display:block;margin-bottom:4px">${t('setup.installMethodLabel')}</label>
        <select id="install-method" style="width:100%;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-primary);background:var(--bg-secondary);color:var(--text-primary);font-size:var(--font-size-sm)">
          <option value="auto">${t('setup.methodAuto')}</option>
          <option value="standalone-r2">${t('setup.methodStandaloneR2')}</option>
          <option value="standalone-github">${t('setup.methodStandaloneGithub')}</option>
          <option value="npm">${t('setup.methodNpm')}</option>
        </select>
        <div id="method-hint" style="font-size:var(--font-size-xs);color:var(--text-tertiary);margin-top:4px;line-height:1.5"></div>
      </div>
      <div style="margin-bottom:var(--space-sm)" id="registry-section">
        <label style="font-size:var(--font-size-xs);color:var(--text-tertiary);display:block;margin-bottom:4px">${t('setup.registryLabel')}</label>
        <select id="registry-select" style="width:100%;padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-primary);background:var(--bg-secondary);color:var(--text-primary);font-size:var(--font-size-sm)">
          <option value="https://registry.npmmirror.com">${t('setup.registryTaobao')}</option>
          <option value="https://registry.npmjs.org">${t('setup.registryNpm')}</option>
          <option value="https://repo.huaweicloud.com/repository/npm/">${t('setup.registryHuawei')}</option>
        </select>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-install">${t('setup.installBtn')}</button>
    </div>
  `
}

function renderEnvironmentHint() {
  const isWin = navigator.platform?.startsWith('Win') || navigator.userAgent?.includes('Windows')
  const isMac = navigator.platform?.startsWith('Mac') || navigator.userAgent?.includes('Macintosh')
  const isDesktop = !!window.__TAURI_INTERNALS__
  if (!isDesktop) return ''

return ''

 /*  return `
    <div class="config-section" style="text-align:left;margin-top:var(--space-md)">
      <div class="config-section-title">${t('setup.envHintTitle')}</div>
      <p style="color:var(--text-secondary);font-size:var(--font-size-sm);line-height:1.6;margin-bottom:var(--space-sm)">
        ${t('setup.envHintDesc')}
      </p>
      <details class="setup-help-details">
        <summary>${t('setup.envHintInstallManage')}</summary>
        <div class="setup-help-content">
          <ul style="margin:0 0 12px 18px;padding:0;line-height:1.8;color:var(--text-secondary)">
            ${isWin ? `
              <li><strong>${t('setup.envHintWsl')}</strong> — ${t('setup.envHintWslDesc')}</li>
              <li><strong>${t('setup.envHintDocker')}</strong> — ${t('setup.envHintDockerDesc')}</li>
            ` : ''}
            ${isMac ? `
              <li><strong>${t('setup.envHintDocker')}</strong> — ${t('setup.envHintDockerDesc')}</li>
              <li><strong>${t('setup.envHintRemote')}</strong> — ${t('setup.envHintRemoteDesc')}</li>
            ` : ''}
            ${!isWin && !isMac ? `
              <li><strong>${t('setup.envHintDocker')}</strong> — ${t('setup.envHintDockerDesc')}</li>
            ` : ''}
          </ul>
          ${isWin ? `
            <div class="setup-help-block">
              <div class="setup-help-label">${t('setup.wslWebHint')}</div>
              <div class="setup-help-copy">${t('setup.wslWebDesc')}</div>
              <code class="setup-help-code">curl -fsSL https://raw.githubusercontent.com/qingchencloud/clawpanel/main/deploy.sh | bash</code>
              <div class="setup-help-copy">${t('setup.domesticMirror')} <code>curl -fsSL https://gitee.com/QtCodeCreators/clawpanel/raw/main/deploy.sh | bash</code></div>
              <div class="setup-help-copy">${t('setup.wslWebPostDeploy')}</div>
            </div>
          ` : ''}
          <div class="setup-help-block">
            <div class="setup-help-label">${t('setup.dockerHint')}</div>
            <div class="setup-help-copy">${t('setup.dockerDesc')}</div>
            <code class="setup-help-code">npm i -g @qingchencloud/openclaw-zh</code>
            <code class="setup-help-code">curl -fsSL https://raw.githubusercontent.com/qingchencloud/clawpanel/main/deploy.sh | bash</code>
            <div class="setup-help-copy">${t('setup.domesticMirrorShort')} <code>curl -fsSL https://gitee.com/QtCodeCreators/clawpanel/raw/main/deploy.sh | bash</code></div>
          </div>
          <div class="setup-help-block">
            <div class="setup-help-label">${t('setup.remoteHint')}</div>
            <div class="setup-help-copy">${t('setup.remoteDesc')}</div>
            <code class="setup-help-code">curl -fsSL https://raw.githubusercontent.com/qingchencloud/clawpanel/main/deploy.sh | bash</code>
            <div class="setup-help-copy">${t('setup.domesticMirrorShort')} <code>curl -fsSL https://gitee.com/QtCodeCreators/clawpanel/raw/main/deploy.sh | bash</code></div>
          </div>
        </div>
      </details>
      <div class="setup-inline-note">${t('setup.envHintLocalReinstall')}</div>
    </div>
  ` */
}

function buildSetupProblemPrompt({ node, git, cliOk, config }) {
  const problems = []
  if (!node.installed) problems.push(`- ${t('setup.promptNodeMissing')}`)
  else problems.push(`- ${t('setup.promptNodeOk', { version: node.version || t('common.unknown') })}`)
  if (!git?.installed) problems.push(`- ${t('setup.promptGitMissing')}`)
  else problems.push(`- ${t('setup.promptGitOk', { version: git.version || t('common.unknown') })}`)
  if (!cliOk) problems.push(`- ${t('setup.promptCliMissing')}`)
  else problems.push(`- ${t('setup.promptCliOk')}`)
  if (!config.installed) problems.push(`- ${t('setup.promptConfigMissing')}`)
  else problems.push(`- ${t('setup.promptConfigOk', { path: config.path || '' })}`)

  return `${t('setup.promptIntro')}

${problems.join('\n')}

${t('setup.promptOutro')}`
}

function bindEvents(page, nodeOk, detectState) {
/*   // 打开 AI 助手
  page.querySelector('#btn-goto-assistant')?.addEventListener('click', () => {
    window.location.hash = '/assistant'
  })

  // 让 AI 帮我解决（带问题上下文）
  page.querySelector('#btn-ask-ai-help')?.addEventListener('click', () => {
    if (detectState) {
      const prompt = buildSetupProblemPrompt(detectState)
      sessionStorage.setItem('assistant-auto-prompt', prompt)
    }
    window.location.hash = '/assistant'
  }) */

  // 进入面板（刷新引擎 ready 状态，触发侧边栏更新）
  async function refreshAndNavigate(route) {
    const engine = getActiveEngine()
    if (engine?.detect) await engine.detect()
    window.location.hash = route
  }
  page.querySelector('#btn-enter')?.addEventListener('click', () => refreshAndNavigate('/dashboard'))
  page.querySelector('#btn-goto-models')?.addEventListener('click', () => refreshAndNavigate('/models'))
  page.querySelector('#btn-goto-gateway')?.addEventListener('click', () => refreshAndNavigate('/gateway'))
  page.querySelector('#btn-goto-channels')?.addEventListener('click', () => refreshAndNavigate('/channels'))

  // 一键安装 Git
  page.querySelector('#btn-auto-install-git')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-auto-install-git')
    const resultEl = page.querySelector('#git-install-result')
    btn.disabled = true
    btn.textContent = t('setup.installingGit')
    _setupLog('git-install', '点击安装 Git')
    if (resultEl) {
      resultEl.style.display = 'block'
      resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.gitInstallingHint')}</span>`
    }
    try {
      const msg = await api.autoInstallGit()
      _setupLog('git-install', `安装成功: ${msg}`)
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--success)">✓ ${msg}</span>`
      toast(t('setup.gitInstallSuccess'), 'success')
      api.configureGitHttps().catch(() => {})
      setTimeout(() => runDetect(page), 1000)
    } catch (e) {
      const errMsg = String(e.message || e)
      _setupLog('git-install', `安装失败: ${errMsg}`)
      if (resultEl) {
        resultEl.innerHTML = `<div>
          <span style="color:var(--danger)">${t('setup.gitAutoInstallFailed', { err: errMsg })}</span>
          <p style="margin-top:6px;font-size:var(--font-size-xs);color:var(--text-secondary);line-height:1.5">
            ${t('setup.gitManualHint')}<br>
            ${t('setup.gitManualInstallHtml')}
          </p>
        </div>`
      }
      toast(t('setup.gitAutoInstallFailedToast'), 'warning')
    } finally {
      btn.disabled = false
      btn.textContent = t('setup.autoInstallGitBtn')
    }
  })

  // 自定义 OpenClaw 安装路径
  const dirInput = page.querySelector('#input-openclaw-dir')
  const dirResultEl = page.querySelector('#openclaw-dir-result')
  // 预填当前自定义路径
  if (dirInput) {
    api.getOpenclawDir().then(info => {
      if (info.isCustom) {
        dirInput.value = info.path
        // 已有自定义路径时自动展开
        const details = page.querySelector('#custom-dir-details')
        if (details) details.open = true
      }
    }).catch(() => {})
  }
  const searchPathsInput = page.querySelector('#input-openclaw-search-paths')
  api.readPanelConfig().then(cfg => {
    if (searchPathsInput) {
      const values = Array.isArray(cfg?.openclawSearchPaths) ? cfg.openclawSearchPaths : []
      searchPathsInput.value = values.join('\n')
    }
  }).catch(() => {})

  page.querySelector('#btn-save-openclaw-dir')?.addEventListener('click', async () => {
    const value = dirInput?.value?.trim()
    if (!value) { toast(t('setup.enterPath'), 'warning'); return }
    const btn = page.querySelector('#btn-save-openclaw-dir')
    btn.disabled = true
    if (dirResultEl) { dirResultEl.style.display = 'block'; dirResultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.saving')}</span>` }
    try {
      const cfg = await api.readPanelConfig()
      cfg.openclawDir = value
      await api.writePanelConfig(cfg)
      invalidate()
      if (dirResultEl) dirResultEl.innerHTML = `<span style="color:var(--success)">✓ ${t('setup.pathSaved')}</span>`
      const savedMsg = t('setup.customPathSaved')
      const refreshed = await maybeRefreshGatewayServiceBinding()
      if (refreshed) toast(savedMsg, 'success')
      else await promptRestart(savedMsg)
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      if (dirResultEl) dirResultEl.innerHTML = `<span style="color:var(--error)">${t('setup.saveFailed', { err: e })}</span>`
      toast(t('setup.saveFailed', { err: e }), 'error')
    } finally {
      btn.disabled = false
    }
  })

  page.querySelector('#btn-save-openclaw-search-paths')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-save-openclaw-search-paths')
    const resultEl = page.querySelector('#openclaw-search-paths-result')
    const paths = parseOpenclawSearchPaths(searchPathsInput?.value || '')
    btn.disabled = true
    if (resultEl) {
      resultEl.style.display = 'block'
      resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.saving')}</span>`
    }
    try {
      const cfg = await api.readPanelConfig()
      if (paths.length > 0) {
        cfg.openclawSearchPaths = paths
      } else {
        delete cfg.openclawSearchPaths
      }
      await api.writePanelConfig(cfg)
      invalidate()
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:var(--success)">✓ ${paths.length > 0 ? t('setup.searchOpenclawExtraPathsSaved') : t('setup.searchOpenclawExtraPathsCleared')}</span>`
      }
      toast(paths.length > 0 ? t('setup.searchOpenclawExtraPathsSaved') : t('setup.searchOpenclawExtraPathsCleared'), 'success')
      setTimeout(() => runDetect(page), 300)
    } catch (e) {
      if (resultEl) {
        resultEl.innerHTML = `<span style="color:var(--error)">${t('setup.saveFailed', { err: e })}</span>`
      }
      toast(t('setup.saveFailed', { err: e }), 'error')
    } finally {
      btn.disabled = false
    }
  })

  page.querySelector('#btn-reset-openclaw-dir')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-reset-openclaw-dir')
    btn.disabled = true
    try {
      const cfg = await api.readPanelConfig()
      delete cfg.openclawDir
      await api.writePanelConfig(cfg)
      invalidate()
      if (dirInput) dirInput.value = ''
      if (dirResultEl) { dirResultEl.style.display = 'block'; dirResultEl.innerHTML = `<span style="color:var(--success)">✓ ${t('setup.defaultRestored')}</span>` }
      const restoredMsg = t('setup.defaultRestoredToast')
      const refreshed = await maybeRefreshGatewayServiceBinding()
      if (refreshed) toast(restoredMsg, 'success')
      else await promptRestart(restoredMsg)
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      toast(t('setup.restoreFailed', { err: e }), 'error')
    } finally {
      btn.disabled = false
    }
  })

  // 一键初始化配置
  page.querySelector('#btn-init-config')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-init-config')
    btn.disabled = true
    btn.textContent = t('setup.initializing')
    _setupLog('init-config', '点击初始化配置按钮')
    try {
      const result = await api.initOpenclawConfig()
      _setupLog('init-config', `初始化结果: ${JSON.stringify(result)}`)
      if (result?.restored) {
        toast(t('setup.configRestored'), 'success')
      } else if (result?.created) {
        toast(t('setup.configCreated'), 'success')
      } else {
        toast(result?.message || t('setup.configExists'), 'info')
      }
      setTimeout(() => runDetect(page), 500)
    } catch (e) {
      toast(t('setup.initFailed', { err: e }), 'error')
      btn.disabled = false
      btn.textContent = t('setup.initConfigLabel')
    }
  })

  // 自动扫描 Node.js
  page.querySelector('#btn-scan-node')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-scan-node')
    const resultEl = page.querySelector('#scan-result')
    btn.disabled = true
    btn.textContent = t('setup.scanning')
    resultEl.style.display = 'block'
    resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.scanningPaths')}</span>`
    try {
      const results = await api.scanNodePaths()
      if (results.length === 0) {
        resultEl.innerHTML = `<span style="color:var(--warning)">${t('setup.scanNotFound')}</span>`
      } else {
        resultEl.innerHTML = results.map(r =>
          `<div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <span style="color:var(--success)">✓</span>
            <code style="flex:1;background:var(--bg-secondary);padding:2px 6px;border-radius:3px;font-size:11px">${r.path}</code>
            <span style="font-size:11px;color:var(--text-tertiary)">${r.version}</span>
            <button class="btn btn-primary btn-sm btn-use-path" data-path="${r.path}" style="font-size:10px;padding:2px 8px">${t('setup.scanUseBtn')}</button>
          </div>`
        ).join('')
        resultEl.querySelectorAll('.btn-use-path').forEach(b => {
          b.addEventListener('click', async () => {
            await api.saveCustomNodePath(b.dataset.path)
            toast(t('setup.nodeSaved'), 'success')
            setTimeout(() => runDetect(page), 300)
          })
        })
      }
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">${t('setup.scanFailed', { err: e })}</span>`
    } finally {
      btn.disabled = false
      btn.innerHTML = `${icon('search', 12)} ${t('setup.scanNodeBtn')}`
    }
  })

  // 手动指定路径检测
  page.querySelector('#btn-check-path')?.addEventListener('click', async () => {
    const input = page.querySelector('#input-node-path')
    const resultEl = page.querySelector('#scan-result')
    const dir = input?.value?.trim()
    if (!dir) { toast(t('setup.enterNodeDir'), 'warning'); return }
    resultEl.style.display = 'block'
    resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.detecting2')}</span>`
    try {
      const result = await api.checkNodeAtPath(dir)
      if (result.installed) {
        await api.saveCustomNodePath(dir)
        resultEl.innerHTML = `<span style="color:var(--success)">✓ ${t('setup.nodeFoundSaved', { version: result.version })}</span>`
        toast(t('setup.nodeSaved'), 'success')
        setTimeout(() => runDetect(page), 300)
      } else {
        resultEl.innerHTML = `<span style="color:var(--warning)">${t('setup.nodeNotFoundAtPath')}</span>`
      }
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">${t('setup.checkFailed', { err: e })}</span>`
    }
  })

  const bindOpenclawCliPath = async (cliPath, btnEl, resultEl, successText = t('setup.searchOpenclawSelectSuccess'), originalText = btnEl?.textContent) => {
    if (!cliPath) return false
    if (btnEl) {
      btnEl.disabled = true
      btnEl.textContent = t('setup.searchOpenclawUsing')
    }
    try {
      const cfg = await api.readPanelConfig()
      cfg.openclawCliPath = cliPath
      await api.writePanelConfig(cfg)
      await api.invalidatePathCache().catch(() => {})
      if (resultEl) {
        resultEl.style.display = 'block'
        resultEl.innerHTML = `<span style="color:var(--success)">✓ ${successText}</span>`
      }
      const refreshed = await maybeRefreshGatewayServiceBinding()
      if (refreshed) toast(successText, 'success')
      else await promptRestart(successText)
      setTimeout(() => runDetect(page), 300)
      return true
    } catch (e) {
      if (btnEl) {
        btnEl.disabled = false
        btnEl.textContent = originalText || t('setup.scanUseBtn')
      }
      if (resultEl) {
        resultEl.style.display = 'block'
        resultEl.innerHTML = `<span style="color:var(--danger)">${t('setup.searchOpenclawSelectFailed', { err: e?.message || e })}</span>`
      }
      toast(t('setup.searchOpenclawSelectFailed', { err: e?.message || e }), 'error')
      return false
    }
  }

  page.querySelector('#btn-check-openclaw-path')?.addEventListener('click', async () => {
    const input = page.querySelector('#input-openclaw-cli-path')
    const resultEl = page.querySelector('#scan-openclaw-result')
    const btn = page.querySelector('#btn-check-openclaw-path')
    const cliPath = input?.value?.trim()
    if (!cliPath) { toast(t('setup.enterPath'), 'warning'); return }
    btn.disabled = true
    btn.textContent = t('setup.detecting2')
    resultEl.style.display = 'block'
    resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.detecting2')}</span>`
    try {
      const result = await api.checkOpenclawAtPath(cliPath)
      if (result?.installed && result?.path) {
        await bindOpenclawCliPath(result.path, btn, resultEl, t('setup.searchOpenclawManualSaved'), t('setup.searchOpenclawManualBtn'))
      } else {
        resultEl.innerHTML = `<span style="color:var(--warning)">${t('setup.searchOpenclawManualNotFound')}</span>`
        btn.disabled = false
        btn.textContent = t('setup.searchOpenclawManualBtn')
      }
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">${t('setup.scanFailed', { err: e })}</span>`
      btn.disabled = false
      btn.textContent = t('setup.searchOpenclawManualBtn')
    }
  })

  page.querySelector('#btn-scan-openclaw')?.addEventListener('click', async () => {
    const btn = page.querySelector('#btn-scan-openclaw')
    const resultEl = page.querySelector('#scan-openclaw-result')
    if (!btn || !resultEl) return
    btn.disabled = true
    btn.innerHTML = `${icon('search', 12)} ${t('setup.searchOpenclawScanning')}`
    resultEl.style.display = 'block'
    resultEl.innerHTML = `<span style="color:var(--text-tertiary)">${t('setup.searchOpenclawScanning')}</span>`
    try {
      const results = await api.scanOpenclawPaths()
      if (!Array.isArray(results) || results.length === 0) {
        resultEl.innerHTML = `<span style="color:var(--warning)">${t('setup.searchOpenclawEmpty')}</span>`
        return
      }
      resultEl.innerHTML = `${results.map((item, index) => `
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
          <span style="color:var(--success)">✓</span>
          <div style="flex:1;min-width:0">
            <code style="display:block;background:var(--bg-secondary);padding:2px 6px;border-radius:3px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(item.path)}">${escapeHtml(item.path)}</code>
            <span style="font-size:11px;color:var(--text-tertiary)">${escapeHtml(openclawSourceLabel(item.source))}${item.version ? ` · v${escapeHtml(item.version)}` : ''}</span>
          </div>
          <button class="btn btn-primary btn-sm btn-use-openclaw-path" data-index="${index}" style="font-size:10px;padding:2px 8px">${t('setup.scanUseBtn')}</button>
        </div>
      `).join('')}
      <div style="margin-top:6px;font-size:11px;color:var(--text-tertiary);line-height:1.6">${t('setup.searchOpenclawHint')}</div>`

      resultEl.querySelectorAll('.btn-use-openclaw-path').forEach(btnEl => {
        btnEl.addEventListener('click', async () => {
          const item = results[Number(btnEl.dataset.index)]
          if (!item?.path) return
          await bindOpenclawCliPath(item.path, btnEl, resultEl)
        })
      })
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--danger)">${t('setup.scanFailed', { err: e })}</span>`
    } finally {
      btn.disabled = false
      btn.innerHTML = `${icon('search', 12)} ${t('setup.searchOpenclawBtn')}`
    }
  })

  // 安装方式联动：源切换时更新方式选项可见性
  const methodSection = page.querySelector('#install-method-section')
  const registrySection = page.querySelector('#registry-section')
  const methodSelect = page.querySelector('#install-method')
  const methodHint = page.querySelector('#method-hint')
  const sourceRadios = page.querySelectorAll('input[name="install-source"]')

  const METHOD_HINTS = {
    'auto': t('setup.methodHintAuto'),
    'standalone-r2': t('setup.methodHintR2'),
    'standalone-github': t('setup.methodHintGithub'),
    'npm': t('setup.methodHintNpm'),
  }

  function updateMethodVisibility() {
    const source = page.querySelector('input[name="install-source"]:checked')?.value || 'chinese'
    if (source === 'official') {
      if (methodSection) methodSection.style.display = 'none'
      if (registrySection) registrySection.style.display = ''
    } else {
      if (methodSection) methodSection.style.display = ''
      const method = methodSelect?.value || 'auto'
      if (registrySection) registrySection.style.display = (method === 'npm') ? '' : 'none'
    }
    if (methodHint && methodSelect) methodHint.textContent = METHOD_HINTS[methodSelect.value] || ''
  }

  sourceRadios.forEach(r => r.addEventListener('change', updateMethodVisibility))
  if (methodSelect) methodSelect.addEventListener('change', updateMethodVisibility)
  updateMethodVisibility()

  // 一键安装
  const installBtn = page.querySelector('#btn-install')
  if (!installBtn || !nodeOk) return

  installBtn.addEventListener('click', async () => {
    _setupLog('install', '点击安装按钮，开始安装流程')
    const source = page.querySelector('input[name="install-source"]:checked')?.value || 'chinese'
    const method = (source === 'official') ? 'npm' : (page.querySelector('#install-method')?.value || 'auto')
    const registry = page.querySelector('#registry-select')?.value
    const modal = showUpgradeModal(t('setup.installOpenclaw'))
    let unlistenLog, unlistenProgress

    setUpgrading(true)

    const cleanup = () => {
      setUpgrading(false)
      unlistenLog?.()
      unlistenProgress?.()
      unlistenDone?.()
      unlistenError?.()
    }

    let unlistenDone, unlistenError

    try {
      if (window.__TAURI_INTERNALS__) {
        const { listen } = await import('@tauri-apps/api/event')
        unlistenLog = await listen('upgrade-log', (e) => modal.appendLog(e.payload))
        unlistenProgress = await listen('upgrade-progress', (e) => modal.setProgress(e.payload))

        // 后台任务完成：继续安装 Gateway + 自动配置
        unlistenDone = await listen('upgrade-done', async (e) => {
          cleanup()
          _setupLog('install', `upgrade-done 事件: ${typeof e.payload === 'string' ? e.payload : 'ok'}`)
          modal.setDone(typeof e.payload === 'string' ? e.payload : t('setup.installComplete'))

          // 安装成功后自动安装 Gateway
          modal.appendLog(t('setup.installingGateway'))
          try {
            await api.installGateway()
            modal.appendHtmlLog(`${statusIcon('ok', 14)} ${t('setup.gatewayInstalled')}`)
          } catch (ge) {
            modal.appendHtmlLog(`${statusIcon('warn', 14)} ${t('setup.gatewayInstallFailed', { err: ge })}`)
          }

          // 确保 openclaw.json 有关键默认值
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
          setTimeout(() => window.location.reload(), 1500)
        })

        // 后台任务失败
        unlistenError = await listen('upgrade-error', async (e) => {
          cleanup()
          const errStr = String(e.payload || t('common.unknown'))
          _setupLog('install', `upgrade-error 事件: ${errStr}`)
          modal.appendLog(errStr)
          await new Promise(r => setTimeout(r, 150))
          const fullLog = modal.getLogText() + '\n' + errStr
          const diagnosis = diagnoseInstallError(fullLog)
          modal.setError(diagnosis.title)
          if (diagnosis.hint) modal.appendLog('')
          if (diagnosis.hint) modal.appendHtmlLog(`${statusIcon('info', 14)} ${diagnosis.hint}`)
          if (diagnosis.command) modal.appendHtmlLog(`${icon('clipboard', 14)} ${diagnosis.command}`)
          if (window.__openAIDrawerWithError) {
            window.__openAIDrawerWithError({ title: diagnosis.title, error: fullLog, scene: t('setup.installScene'), hint: diagnosis.hint })
          }
        })

        // 先设置镜像源
        if (registry) {
          modal.appendLog(t('setup.setRegistry', { url: registry }))
          try { await api.setNpmRegistry(registry) } catch {}
        }

        // 发起后台任务（立即返回）
        await api.upgradeOpenclaw(source, null, method)
        modal.appendLog(t('setup.bgTaskStarted'))
      } else {
        // Web 模式：同步等待
        modal.appendLog(t('setup.webModeLogHint'))
        if (registry) {
          modal.appendLog(t('setup.setRegistry', { url: registry }))
          try { await api.setNpmRegistry(registry) } catch {}
        }
        const msg = await api.upgradeOpenclaw(source, null, method)
        modal.setDone(msg)
        toast(t('setup.installSuccess'), 'success')
        setTimeout(() => window.location.reload(), 1500)
        cleanup()
      }
    } catch (e) {
      cleanup()
      const errStr = String(e)
      modal.appendLog(errStr)
      const fullLog = modal.getLogText() + '\n' + errStr
      const diagnosis = diagnoseInstallError(fullLog)
      modal.setError(diagnosis.title)
    }
  })
}
