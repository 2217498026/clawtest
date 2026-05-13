import { api } from './tauri-api.js'
import { showContentModal, showConfirm } from '../components/modal.js'
import { toast } from '../components/toast.js'
import { t } from './i18n.js'

function escapeHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function cliSourceLabel(source) {
  if (source === 'standalone') return t('dashboard.cliSourceStandalone')
  if (source === 'npm-zh') return t('dashboard.cliSourceNpmZh')
  if (source === 'npm-official') return t('dashboard.cliSourceNpmOfficial')
  if (source === 'npm-global') return t('dashboard.cliSourceNpmGlobal')
  return t('dashboard.cliSourceUnknown')
}

function openclawInstallationIdentity(installation) {
  const rawPath = String(installation?.path || '').trim()
  if (!rawPath) return ''
  const isWin = navigator.platform?.startsWith('Win') || navigator.userAgent?.includes('Windows')
  if (!isWin) return rawPath
  return rawPath
    .replace(/\//g, '\\')
    .replace(/\\openclaw(?:\.exe|\.ps1)?$/i, '\\openclaw.cmd')
    .toLowerCase()
}

function dedupeOpenclawInstallations(list = []) {
  const map = new Map()
  const preferCmd = inst => /openclaw\.cmd$/i.test(String(inst?.path || ''))
  for (const installation of Array.isArray(list) ? list : []) {
    const key = openclawInstallationIdentity(installation)
    if (!key) continue
    const existing = map.get(key)
    if (!existing || (!existing.active && installation.active) || (!preferCmd(existing) && preferCmd(installation))) {
      map.set(key, installation)
    }
  }
  return [...map.values()]
}

function readBoundCliPath(panelConfig) {
  return String(panelConfig?.openclawCliPath || '').trim()
}

let _foreignGatewayPromptKey = ''

export function isForeignGatewayService(service) {
  return service?.ownership === 'foreign' || (service?.running === true && service?.owned_by_current_instance === false)
}

export function isForeignGatewayError(error) {
  const text = String(error?.message || error || '')
  return text.includes('不属于当前面板实例')
    || text.includes('误接管')
    || text.includes('其他 OpenClaw Gateway')
}

export async function maybeShowForeignGatewayBindingPrompt({ service = null, onRefresh = null } = {}) {
  if (!isForeignGatewayService(service)) {
    _foreignGatewayPromptKey = ''
    return false
  }
  const panelConfig = await api.readPanelConfig().catch(() => null)
  if (readBoundCliPath(panelConfig)) {
    return false
  }
  const promptKey = `${service?.label || 'ai.openclaw.gateway'}::${service?.pid || 'unknown'}::${service?.ownership || 'foreign'}`
  if (_foreignGatewayPromptKey === promptKey) {
    return false
  }
  _foreignGatewayPromptKey = promptKey
  await showGatewayConflictGuidance({ service, onRefresh })
  return true
}

export async function showGatewayConflictGuidance({ error = null, service = null, onRefresh = null, reason = null } = {}) {
  const [versionInfo, dirInfo, panelConfig] = await Promise.all([
    api.getVersionInfo().catch(() => null),
    api.getOpenclawDir().catch(() => null),
    api.readPanelConfig().catch(() => null),
  ])

  const currentCli = versionInfo?.cli_path || t('common.unknown')
  const currentCliSource = cliSourceLabel(versionInfo?.cli_source)
  const currentDir = dirInfo?.path || t('common.unknown')
  const boundCliPath = readBoundCliPath(panelConfig)
  const displayBoundCliPath = boundCliPath || t('services.guidanceCliBindingAuto')
  const installations = dedupeOpenclawInstallations(Array.isArray(versionInfo?.all_installations) ? versionInfo.all_installations : [])
  const message = error ? escapeHtml(String(error.message || error)) : ''
  const pid = service?.pid || null
  const hasForeignGateway = reason === 'foreign-gateway'
    || (!!error && reason !== 'multiple-installations')
    || (reason !== 'multiple-installations' && isForeignGatewayService(service))
  const hasUnboundForeignGateway = hasForeignGateway && !boundCliPath
  const hasMultiInstall = reason === 'multiple-installations' || installations.length > 1
  const settingsLabel = t('sidebar.settings')
  const title = hasUnboundForeignGateway
    ? t('services.guidanceTitleForeignUnbound')
    : hasForeignGateway
      ? t('services.guidanceTitleForeign')
    : hasMultiInstall
      ? t('services.guidanceTitleMultiInstall')
      : t('services.guidanceTitleCheck')
  const summaryText = hasUnboundForeignGateway
    ? t('services.guidanceSummaryForeignUnbound')
    : hasForeignGateway
      ? t('services.guidanceSummaryForeign')
    : hasMultiInstall
      ? t('services.guidanceSummaryMultiInstall')
      : t('services.guidanceSummaryCheck')
  const suggestionOne = hasUnboundForeignGateway
    ? t('services.guidanceSuggestionBindAutoDetected', { settings: settingsLabel })
    : hasForeignGateway
      ? t('services.guidanceSuggestionBindForeign', { settings: settingsLabel })
    : t('services.guidanceSuggestionBind', { settings: settingsLabel })
  const suggestionTwo = hasForeignGateway
    ? t('services.guidanceSuggestionStopForeign')
    : t('services.guidanceSuggestionRefresh')
  const suggestionThree = t('services.guidanceSuggestionInstallations')
  const settingsButtonLabel = hasUnboundForeignGateway ? t('services.guidanceBindCliBtn') : t('sidebar.settings')

  const whyText = hasUnboundForeignGateway
    ? t('services.guidanceWhyForeignUnbound')
    : hasForeignGateway
      ? t('services.guidanceWhyForeign')
    : t('services.guidanceWhyMultiInstall')

  const installationHtml = installations.length
    ? installations.map(inst => {
      const isActive = !!inst.active
      const borderColor = isActive ? 'rgba(34,197,94,0.4)' : 'var(--border-light)'
      const bgColor = isActive ? 'rgba(34,197,94,0.06)' : 'var(--bg-secondary)'
      const activeBadge = isActive
        ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(34,197,94,0.14);color:#16a34a">● ${escapeHtml(t('services.guidanceActiveBadge'))}</span>`
        : ''
      const versionBadge = inst.version
        ? `<span style="display:inline-flex;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;background:rgba(99,102,241,0.10);color:var(--text-secondary)">${escapeHtml(inst.version)}</span>`
        : ''
      const sourceBadge = inst.source
        ? `<span style="display:inline-flex;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:500;background:var(--bg-tertiary, rgba(0,0,0,0.06));color:var(--text-tertiary)">${escapeHtml(cliSourceLabel(inst.source))}</span>`
        : ''
      return `
        <div style="padding:10px 14px;border:1px solid ${borderColor};border-radius:10px;background:${bgColor};margin-top:8px;transition:border-color .15s">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:15px">📂</span>
            <code style="font-size:12px;word-break:break-all;flex:1;min-width:0">${escapeHtml(inst.path)}</code>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${activeBadge}${versionBadge}${sourceBadge}</div>
        </div>`
    }).join('')
    : `<div style="padding:14px;border:1px dashed var(--border-light);border-radius:10px;background:var(--bg-secondary);margin-top:8px;color:var(--text-tertiary);text-align:center">${escapeHtml(t('services.guidanceNoInstallations', { settings: settingsLabel }))}</div>`

  const infoCard = (icon, label, value, sub) => `
    <div style="display:flex;gap:10px;padding:10px 14px;border-radius:10px;background:var(--bg-secondary);border:1px solid var(--border-light)">
      <span style="font-size:16px;flex-shrink:0;margin-top:1px">${icon}</span>
      <div style="min-width:0;flex:1">
        <div style="font-size:11px;color:var(--text-tertiary);font-weight:600;text-transform:uppercase;letter-spacing:0.3px">${escapeHtml(label)}</div>
        <div style="margin-top:3px;font-size:13px;word-break:break-all;font-family:var(--font-mono);color:var(--text-primary)">${escapeHtml(value)}</div>
        ${sub ? `<div style="margin-top:2px;font-size:11px;color:var(--text-tertiary)">${escapeHtml(sub)}</div>` : ''}
      </div>
    </div>`

  const stepCard = (n, text) => `
    <div style="display:flex;gap:10px;align-items:flex-start">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--primary, #6366f1);color:#fff;font-size:12px;font-weight:700;flex-shrink:0;margin-top:1px">${n}</span>
      <div style="font-size:13px;color:var(--text-secondary);line-height:1.6;flex:1">${escapeHtml(text)}</div>
    </div>`

  const content = `
    <div style="display:flex;flex-direction:column;gap:14px;font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.7">
      <div style="display:flex;gap:10px;padding:12px 14px;border-radius:10px;background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.2)">
        <span style="font-size:18px;flex-shrink:0">⚠️</span>
        <div style="color:var(--warning);font-size:13px;line-height:1.6">${escapeHtml(summaryText)}</div>
      </div>
      ${message ? `<div style="padding:10px 14px;border-radius:10px;background:var(--bg-secondary);border:1px solid var(--border-light);font-family:var(--font-mono);font-size:12px;word-break:break-all;color:var(--text-tertiary)">${message}</div>` : ''}
      <details style="border-radius:10px;background:var(--bg-secondary);border:1px solid var(--border-light);overflow:hidden">
        <summary style="padding:10px 14px;cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary);user-select:none">${escapeHtml(t('services.guidanceWhyTitle'))}</summary>
        <div style="padding:0 14px 12px;font-size:13px;color:var(--text-secondary);line-height:1.6">${escapeHtml(whyText)}</div>
      </details>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${infoCard('🔗', t('services.guidanceInfoCliBinding'), displayBoundCliPath)}
        ${infoCard('🛠️', t('services.guidanceInfoCliDetected'), currentCli, currentCliSource)}
        ${infoCard('📁', t('services.guidanceInfoDataDir'), currentDir)}
        ${pid ? infoCard('⚡', t('services.guidanceInfoProcess'), `PID ${pid}`) : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(t('services.guidanceHandlingTitle'))}</div>
        ${stepCard(1, suggestionOne.replace(/^1\.\s*/, ''))}
        ${stepCard(2, suggestionTwo.replace(/^2\.\s*/, ''))}
        ${stepCard(3, suggestionThree.replace(/^3\.\s*/, ''))}
      </div>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:4px">${escapeHtml(t('services.guidanceInstallationsTitle'))}</div>
        ${installationHtml}
      </div>
    </div>
  `

  const overlay = showContentModal({
    title,
    content,
    width: 760,
    buttons: [
      { id: 'gateway-conflict-open-cleanup', label: t('services.cleanupTitle'), className: 'btn btn-primary btn-sm' },
      { id: 'gateway-conflict-open-settings', label: settingsButtonLabel, className: 'btn btn-secondary btn-sm' },
      { id: 'gateway-conflict-refresh', label: t('services.refreshStatus'), className: 'btn btn-secondary btn-sm' },
    ],
  })

  overlay.querySelector('#gateway-conflict-open-cleanup')?.addEventListener('click', async () => {
    overlay.close()
    await showInstallationCleanup({ onRefresh })
  })

  overlay.querySelector('#gateway-conflict-open-settings')?.addEventListener('click', () => {
    overlay.close()
    window.location.hash = '#/settings'
  })

  overlay.querySelector('#gateway-conflict-refresh')?.addEventListener('click', async () => {
    overlay.close()
    if (typeof onRefresh === 'function') {
      await onRefresh()
    }
  })

  return overlay
}

/** 根据安装来源返回卸载命令 */
function uninstallCommandForSource(source, path) {
  if (source === 'standalone') {
    const isWin = navigator.platform?.startsWith('Win') || navigator.userAgent?.includes('Windows')
    const p = escapeHtml(path || '')
    return isWin ? `rmdir /s /q "${p}"` : `rm -rf "${p}"`
  }
  if (source === 'npm-official' || source === 'official') return 'npm uninstall -g openclaw'
  // npm-zh, npm-global, and others
  return 'npm uninstall -g @qingchencloud/openclaw-zh'
}

/**
 * 显示安装清理弹窗
 * 列出所有检测到的 OpenClaw 安装，提供逐个卸载命令 + 一键绑定 + 全量卸载
 */
export async function showInstallationCleanup({ onRefresh = null } = {}) {
  const [versionInfo, panelConfig] = await Promise.all([
    api.getVersionInfo().catch(() => null),
    api.readPanelConfig().catch(() => null),
  ])

  const installations = dedupeOpenclawInstallations(Array.isArray(versionInfo?.all_installations) ? versionInfo.all_installations : [])
  const boundPath = readBoundCliPath(panelConfig)
  const currentPath = versionInfo?.cli_path || ''

  const sourceLabel = (src) => cliSourceLabel(src)

  // 每个安装的卡片 HTML
  const installCards = installations.map((inst, idx) => {
    const isActive = !!inst.active
    const isBound = boundPath && openclawInstallationIdentity({ path: inst.path }) === openclawInstallationIdentity({ path: boundPath })
    const borderColor = isActive ? 'rgba(34,197,94,0.4)' : 'var(--border-light)'
    const bgColor = isActive ? 'rgba(34,197,94,0.04)' : 'var(--bg-secondary)'

    const badges = []
    if (isActive) badges.push(`<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(34,197,94,0.14);color:#16a34a">● ${t('services.cleanupActive')}</span>`)
    if (isBound) badges.push(`<span style="display:inline-flex;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:rgba(99,102,241,0.14);color:#6366f1">✓ ${t('services.cleanupBound')}</span>`)
    if (inst.version) badges.push(`<span style="display:inline-flex;padding:2px 8px;border-radius:999px;font-size:11px;background:var(--bg-tertiary);color:var(--text-secondary)">${escapeHtml(inst.version)}</span>`)
    if (inst.source) badges.push(`<span style="display:inline-flex;padding:2px 8px;border-radius:999px;font-size:11px;background:var(--bg-tertiary);color:var(--text-tertiary)">${escapeHtml(sourceLabel(inst.source))}</span>`)

    const uninstallCmd = uninstallCommandForSource(inst.source, inst.path)

    // 操作区：非活跃的安装显示卸载命令 + 复制按钮；活跃的显示绑定按钮
    let actions = ''
    if (isActive && !isBound) {
      actions = `<button class="btn btn-primary btn-xs cleanup-bind-btn" data-path="${escapeHtml(inst.path)}" style="margin-top:8px">${t('services.cleanupBindThis')}</button>`
    } else if (!isActive) {
      actions = `
        <div style="margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <code style="flex:1;min-width:0;font-size:11px;padding:4px 8px;background:var(--bg-tertiary);border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:all" title="${escapeHtml(uninstallCmd)}">${escapeHtml(uninstallCmd)}</code>
          <button class="btn btn-secondary btn-xs cleanup-copy-cmd" data-cmd="${escapeHtml(uninstallCmd)}" style="flex-shrink:0">${t('services.cleanupCopyCmd')}</button>
        </div>`
    }

    return `
      <div style="padding:12px 14px;border:1px solid ${borderColor};border-radius:10px;background:${bgColor};transition:border-color .15s">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:14px">${isActive ? '✅' : '📦'}</span>
          <code style="font-size:12px;word-break:break-all;flex:1;min-width:0">${escapeHtml(inst.path)}</code>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${badges.join('')}</div>
        ${actions}
      </div>`
  }).join('')

  const noInstalls = !installations.length
    ? `<div style="padding:14px;border:1px dashed var(--border-light);border-radius:10px;text-align:center;color:var(--text-tertiary)">${t('services.cleanupNoInstalls')}</div>`
    : ''

  // 概要提示
  const summaryStyle = installations.length > 1
    ? 'background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.2);color:var(--warning)'
    : 'background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);color:var(--success)'
  const summaryIcon = installations.length > 1 ? '⚠️' : '✅'
  const summaryText = installations.length > 1
    ? t('services.cleanupMultiSummary', { count: installations.length })
    : t('services.cleanupSingleSummary')

  const content = `
    <div style="display:flex;flex-direction:column;gap:12px;font-size:var(--font-size-sm);color:var(--text-secondary);line-height:1.6">
      <div style="display:flex;gap:10px;padding:10px 14px;border-radius:10px;${summaryStyle}">
        <span style="font-size:16px;flex-shrink:0">${summaryIcon}</span>
        <div style="font-size:13px;line-height:1.5">${escapeHtml(summaryText)}</div>
      </div>
      ${installations.length > 1 ? `
        <div style="padding:10px 14px;border-radius:10px;background:var(--bg-secondary);border:1px solid var(--border-light);font-size:12px;line-height:1.6;color:var(--text-tertiary)">
          <strong style="color:var(--text-secondary)">${t('services.cleanupHowTo')}</strong><br>
          ${t('services.cleanupHowToDesc')}
        </div>` : ''}
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${t('services.cleanupInstallationsTitle', { count: installations.length })}</div>
        ${installCards}${noInstalls}
      </div>
      <details style="border-radius:10px;background:var(--bg-secondary);border:1px solid var(--border-light);overflow:hidden">
        <summary style="padding:10px 14px;cursor:pointer;font-size:13px;font-weight:600;color:var(--error);user-select:none">${t('services.cleanupDangerZone')}</summary>
        <div style="padding:0 14px 12px;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:12px;color:var(--text-tertiary);line-height:1.6">${t('services.cleanupDangerDesc')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-xs" id="cleanup-uninstall-all">${t('services.cleanupUninstallAll')}</button>
            <button class="btn btn-secondary btn-xs" id="cleanup-uninstall-all-config" style="color:var(--error)">${t('services.cleanupUninstallAllWithConfig')}</button>
          </div>
        </div>
      </details>
    </div>
  `

  const overlay = showContentModal({
    title: t('services.cleanupTitle'),
    content,
    width: 640,
    buttons: [
      { id: 'cleanup-goto-settings', label: t('sidebar.settings'), className: 'btn btn-secondary btn-sm' },
      { id: 'cleanup-refresh', label: t('services.refreshStatus'), className: 'btn btn-secondary btn-sm' },
    ],
  })

  // 复制命令按钮
  overlay.addEventListener('click', async (e) => {
    const copyBtn = e.target.closest('.cleanup-copy-cmd')
    if (copyBtn) {
      const cmd = copyBtn.dataset.cmd
      try {
        await navigator.clipboard.writeText(cmd)
        const orig = copyBtn.textContent
        copyBtn.textContent = '✓'
        copyBtn.style.color = 'var(--success)'
        setTimeout(() => { copyBtn.textContent = orig; copyBtn.style.color = '' }, 1500)
      } catch {
        toast(t('services.cleanupCopyFailed'), 'warning')
      }
      return
    }

    // 绑定 CLI 按钮
    const bindBtn = e.target.closest('.cleanup-bind-btn')
    if (bindBtn) {
      const path = bindBtn.dataset.path
      if (!path) return
      try {
        const cfg = await api.readPanelConfig()
        cfg.openclawCliPath = path
        await api.writePanelConfig(cfg)
        toast(t('services.cleanupBindSuccess'), 'success')
        overlay.close()
        if (typeof onRefresh === 'function') await onRefresh()
      } catch (err) {
        toast(t('services.cleanupBindFailed') + ': ' + (err?.message || err), 'error')
      }
      return
    }
  })

  // 全量卸载按钮
  overlay.querySelector('#cleanup-uninstall-all')?.addEventListener('click', async () => {
    const ok = await showConfirm(t('services.cleanupConfirmUninstall'))
    if (!ok) return
    overlay.close()
    try {
      toast(t('services.cleanupUninstalling'), 'info')
      await api.uninstallOpenclaw(false)
    } catch (err) {
      toast(t('services.cleanupUninstallFailed') + ': ' + (err?.message || err), 'error')
    }
  })

  overlay.querySelector('#cleanup-uninstall-all-config')?.addEventListener('click', async () => {
    const ok = await showConfirm(t('services.cleanupConfirmUninstallConfig'))
    if (!ok) return
    overlay.close()
    try {
      toast(t('services.cleanupUninstalling'), 'info')
      await api.uninstallOpenclaw(true)
    } catch (err) {
      toast(t('services.cleanupUninstallFailed') + ': ' + (err?.message || err), 'error')
    }
  })

  // 导航按钮
  overlay.querySelector('#cleanup-goto-settings')?.addEventListener('click', () => {
    overlay.close()
    window.location.hash = '#/settings'
  })

  overlay.querySelector('#cleanup-refresh')?.addEventListener('click', async () => {
    overlay.close()
    if (typeof onRefresh === 'function') await onRefresh()
  })

  return overlay
}
