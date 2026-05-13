/**
 * 插件中心 — OpenClaw 扩展插件管理与浏览
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { navigate } from '../router.js'
import { t } from '../lib/i18n.js'
import { openAIDrawerWithError } from '../components/ai-drawer.js'

const PLUGIN_ICONS = {
  qqbot: '🐧', feishu: '🪶', dingtalk: '📌', telegram: '✈️',
  discord: '🎮', slack: '💬', weixin: '💚', wechat: '💚',
  webchat: '🌐', whatsapp: '📱', signal: '🔒', line: '🟢',
  teams: '👥', matrix: '🔗', irc: '📡',
}

let _allPlugins = []
let _searchQuery = ''

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'
  _searchQuery = ''

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('extensions.title')}</h1>
      <div class="page-actions" style="display:flex;align-items:center;gap:var(--space-sm)">
        <button class="btn btn-sm btn-secondary" id="ph-refresh">${t('extensions.refresh')}</button>
        <button class="btn btn-sm btn-secondary" id="ph-go-channels">${t('extensions.goToChannels')}</button>
      </div>
    </div>
    <p class="form-hint" style="margin-bottom:var(--space-md)">${t('extensions.subtitle')}</p>
    <div id="ph-stats" class="route-map-stats"></div>
    <div style="display:flex;gap:10px;margin-bottom:var(--space-md);flex-wrap:wrap">
      <div style="flex:1;min-width:200px;position:relative">
        <input type="text" class="form-input" id="ph-search" placeholder="${t('extensions.searchPlaceholder')}" style="width:100%;padding-left:32px">
        <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-tertiary)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="text" class="form-input" id="ph-pkg-input" placeholder="${t('extensions.installPlaceholder')}" style="width:220px">
        <button class="btn btn-primary btn-sm" id="ph-install-btn" style="white-space:nowrap">${t('extensions.installBtn')}</button>
      </div>
    </div>
    <div id="ph-install-msg" style="display:none;margin-bottom:var(--space-md)"></div>
    <div id="ph-list">
      <div class="stat-card loading-placeholder" style="height:200px"></div>
    </div>
  `

  page.querySelector('#ph-refresh').onclick = () => loadPlugins(page)
  page.querySelector('#ph-go-channels').onclick = () => navigate('/channels')
  page.querySelector('#ph-install-btn').onclick = () => handleInstall(page)
  page.querySelector('#ph-pkg-input').onkeydown = (e) => { if (e.key === 'Enter') handleInstall(page) }
  page.querySelector('#ph-search').oninput = (e) => {
    _searchQuery = e.target.value.trim().toLowerCase()
    renderPluginList(page)
  }

  // Event delegation for toggle buttons
  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-toggle-plugin]')
    if (!btn) return
    const pluginId = btn.dataset.togglePlugin
    const newEnabled = btn.dataset.toggleTo === 'true'
    btn.disabled = true
    btn.textContent = '...'
    try {
      await api.togglePlugin(pluginId, newEnabled)
      toast(t('extensions.toggleSuccess'), 'success')
      await loadPlugins(page)
    } catch (err) {
      toast(`${t('extensions.toggleFailed')}: ${err}`, 'error')
      btn.disabled = false
      btn.textContent = newEnabled ? t('extensions.enable') : t('extensions.disable')
    }
  })

  // Expand/collapse install messages
  page.addEventListener('click', (e) => {
    if (e.target.closest('#ph-install-msg-toggle')) {
      const detail = page.querySelector('#ph-install-msg-detail')
      const toggle = page.querySelector('#ph-install-msg-toggle')
      if (detail && toggle) {
        const expanded = detail.style.display !== 'none'
        detail.style.display = expanded ? 'none' : 'block'
        toggle.textContent = expanded ? t('extensions.showDetail') : t('extensions.hideDetail')
      }
    }
  })

  setTimeout(() => loadPlugins(page), 0)
  return page
}

async function handleInstall(page) {
  const input = page.querySelector('#ph-pkg-input')
  const btn = page.querySelector('#ph-install-btn')
  const msgEl = page.querySelector('#ph-install-msg')
  const pkg = input.value.trim()
  if (!pkg) return

  btn.disabled = true
  btn.textContent = t('extensions.installing')
  msgEl.style.display = 'block'
  msgEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:var(--bg-secondary);color:var(--text-tertiary);font-size:13px">${t('extensions.installing')}</div>`

  try {
    const result = await api.installPlugin(pkg)
    const output = result.output ? esc(result.output).substring(0, 120) : ''
    msgEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:var(--success-bg,#f0fdf4);border:1px solid var(--success-border,#86efac);color:var(--success);font-size:13px">
      ✅ ${t('extensions.installSuccess')}${output ? ' — ' + output : ''}
    </div>`
    toast(t('extensions.installSuccess'), 'success')
    input.value = ''
    await loadPlugins(page)
    setTimeout(() => { msgEl.style.display = 'none' }, 5000)
  } catch (e) {
    const errStr = String(e.message || e)
    const short = errStr.length > 100 ? errStr.substring(0, 100) + '...' : errStr
    const hasDetail = errStr.length > 100
    msgEl.innerHTML = `<div style="padding:10px 14px;border-radius:8px;background:var(--error-bg,#fef2f2);border:1px solid var(--error-border,#fca5a5);font-size:13px">
      <div style="display:flex;align-items:center;gap:8px;color:var(--error)">
        <span>❌ ${t('extensions.installFailed')}: ${esc(short)}</span>
        ${hasDetail ? `<button id="ph-install-msg-toggle" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;white-space:nowrap;padding:0">${t('extensions.showDetail')}</button>` : ''}
      </div>
      ${hasDetail ? `<pre id="ph-install-msg-detail" style="display:none;margin-top:8px;font-size:11px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-all;color:var(--text-secondary);background:var(--bg-secondary);padding:8px;border-radius:6px">${esc(errStr)}</pre>` : ''}
    </div>`
    toast(t('extensions.installFailed'), 'error')
    openAIDrawerWithError({
      scene: 'plugin-install',
      title: t('extensions.installFailed') + ': ' + pkg,
      hint: t('extensions.installPlaceholder'),
      error: errStr,
    })
  } finally {
    btn.disabled = false
    btn.textContent = t('extensions.installBtn')
  }
}

async function loadPlugins(page) {
  const listEl = page.querySelector('#ph-list')
  const statsEl = page.querySelector('#ph-stats')
  listEl.innerHTML = `<div class="stat-card loading-placeholder" style="height:200px;display:flex;align-items:center;justify-content:center;color:var(--text-tertiary)">${t('extensions.loading')}</div>`

  try {
    const result = await api.listAllPlugins()
    _allPlugins = result?.plugins || []

    if (_allPlugins.length === 0) {
      statsEl.innerHTML = ''
      listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-xl);text-align:center;color:var(--text-tertiary)">${t('extensions.noPlugins')}</div>`
      return
    }

    const enabled = _allPlugins.filter(p => p.enabled).length
    const builtin = _allPlugins.filter(p => p.builtin).length

    statsEl.innerHTML = `
      <div class="route-map-stat"><span class="route-map-stat-num">${_allPlugins.length}</span><span class="route-map-stat-label">${t('extensions.statsInstalled')}</span></div>
      <div class="route-map-stat"><span class="route-map-stat-num">${enabled}</span><span class="route-map-stat-label">${t('extensions.statsEnabled')}</span></div>
      ${builtin ? `<div class="route-map-stat"><span class="route-map-stat-num">${builtin}</span><span class="route-map-stat-label">${t('extensions.statsBuiltin')}</span></div>` : ''}
    `

    renderPluginList(page)
  } catch (e) {
    listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-lg);color:var(--error)">${esc(e.message || e)}</div>`
  }
}

function renderPluginList(page) {
  const listEl = page.querySelector('#ph-list')
  if (!listEl) return

  const filtered = _searchQuery
    ? _allPlugins.filter(p => {
        const q = _searchQuery
        return (p.id || '').toLowerCase().includes(q) ||
               (p.description || '').toLowerCase().includes(q) ||
               (p.version || '').toLowerCase().includes(q)
      })
    : _allPlugins

  if (filtered.length === 0 && _searchQuery) {
    listEl.innerHTML = `<div class="stat-card" style="padding:var(--space-lg);text-align:center;color:var(--text-tertiary)">
      ${t('extensions.noSearchResults', { query: esc(_searchQuery) })}
    </div>`
    return
  }

  listEl.innerHTML = `<div class="plugin-grid">${filtered.map(p => renderPluginCard(p)).join('')}</div>
    <div class="form-hint" style="margin-top:var(--space-md);font-size:var(--font-size-xs)">${t('extensions.restartHint')}</div>`
}

function renderPluginCard(p) {
  const icon = PLUGIN_ICONS[p.id.toLowerCase()] || '🧩'
  const statusClass = p.enabled ? 'plugin-status-enabled' : (p.installed ? 'plugin-status-disabled' : 'plugin-status-missing')
  const statusText = p.enabled ? t('extensions.enabled') : (p.installed ? t('extensions.disabled') : t('extensions.notInstalled'))
  const badges = []
  if (p.builtin) badges.push(`<span class="plugin-badge plugin-badge-builtin">${t('extensions.builtin')}</span>`)
  if (p.version) badges.push(`<span class="plugin-badge plugin-badge-version">${t('extensions.version')} ${esc(p.version)}</span>`)

  // Toggle button: installed plugins can be enabled/disabled
  let toggleBtn = ''
  if (p.installed) {
    if (p.enabled) {
      toggleBtn = `<button class="btn btn-sm btn-secondary" data-toggle-plugin="${esc(p.id)}" data-toggle-to="false">${t('extensions.disable')}</button>`
    } else {
      toggleBtn = `<button class="btn btn-sm btn-primary" data-toggle-plugin="${esc(p.id)}" data-toggle-to="true">${t('extensions.enable')}</button>`
    }
  }

  return `
    <div class="plugin-card ${p.enabled ? '' : 'plugin-card-inactive'}">
      <div class="plugin-card-header">
        <span class="plugin-card-icon">${icon}</span>
        <div class="plugin-card-title">
          <span class="plugin-card-name">${esc(p.id)}</span>
          <div class="plugin-card-badges">${badges.join('')}</div>
        </div>
        <span class="plugin-status-dot ${statusClass}" title="${statusText}"></span>
      </div>
      <div class="plugin-card-desc">${esc(p.description) || t('extensions.noDescription')}</div>
      <div class="plugin-card-footer">
        <span class="plugin-card-status">${statusText}</span>
        ${toggleBtn}
      </div>
    </div>
  `
}
