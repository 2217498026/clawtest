/**
 * Skills 页面
 * 本地扫描已安装 Skills + SkillHub SDK 技能商店
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { t } from '../lib/i18n.js'
import { wsClient } from '../lib/ws-client.js'

/* global: CODE_SERVER_URL 定义在 main.js */
const OPCL_SKILL_NAME = 'opclskill'

let _loadSeq = 0
let _selectedAgentId = null // null = default (main)
let _opclSkillActivated = false // 缓存 opclskill 激活状态

function esc(str) {
  if (!str) return ''
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  // 加载 Agent 列表
  let agents = []
  try {
    const list = await api.listAgents()
    if (Array.isArray(list)) agents = list
  } catch {}

  const agentOptions = agents.length > 1
    ? `<div class="skills-agent-selector" style="display:flex;align-items:center;gap:var(--space-xs);margin-bottom:var(--space-sm)">
        <label style="font-size:var(--font-size-sm);color:var(--text-secondary);white-space:nowrap">${t('skills.agentLabel')}</label>
        <select id="skills-agent-select" class="input" style="max-width:220px;font-size:var(--font-size-sm);padding:4px 8px">
          ${agents.map(a => {
            const id = a.id || 'main'
            const name = a.name || a.id || 'main'
            const isDefault = a.default ? ` (${t('skills.allAgents').split('(')[0].trim()})` : ''
            return `<option value="${esc(id)}"${id === (_selectedAgentId || 'main') ? ' selected' : ''}>${esc(name)}${isDefault}</option>`
          }).join('')}
        </select>
      </div>`
    : ''

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('skills.title')}</h1>
      <p class="page-desc">${t('skills.desc')}</p>
    </div>
    ${agentOptions}
    <div class="tab-bar" id="skills-main-tabs">
      <div class="tab active" data-main-tab="installed">${t('skills.tabInstalled')}</div>
      <div class="tab" data-main-tab="store">${t('skills.tabStore')}</div>
    </div>
    <div id="skills-tab-installed" class="config-section">
      <div class="stat-card loading-placeholder" style="height:96px"></div>
    </div>
    <div id="skills-tab-store" class="config-section" style="display:none">
      <div class="clawhub-toolbar" style="margin-bottom:var(--space-sm)">
        <input class="input clawhub-search-input" id="skill-store-search" placeholder="${t('skills.searchPlaceholder')}" type="text" style="flex:1">
        <button class="btn btn-primary btn-sm" data-action="store-search">${t('skills.search')}</button>
        <a class="btn btn-secondary btn-sm" href="https://skillhub.tencent.com" target="_blank" rel="noopener">${t('skills.browse')}</a>
      </div>
      <div id="store-results" class="clawhub-list" style="max-height:calc(100vh - 300px);overflow-y:auto">
        <div class="form-hint" style="padding:var(--space-xl);text-align:center">${t('skills.storeLoading')}</div>
      </div>
    </div>
  `
  bindEvents(page)
  loadSkills(page)

  // Agent 选择器变化时刷新
  const agentSelect = page.querySelector('#skills-agent-select')
  if (agentSelect) {
    agentSelect.addEventListener('change', () => {
      const val = agentSelect.value
      _selectedAgentId = (val === 'main') ? null : val
      _storeIndex = null // 清除商店缓存
      _installedNames = new Set()
      loadSkills(page)
    })
  }

  return page
}

async function loadSkills(page) {
  const el = page.querySelector('#skills-tab-installed')
  if (!el) return
  const seq = ++_loadSeq

  el.innerHTML = `<div class="skills-loading-panel">
    <div class="stat-card loading-placeholder" style="height:96px"></div>
    <div class="form-hint" style="margin-top:8px">${t('skills.loading')}</div>
  </div>`

  try {
    const [data, panelConfig] = await Promise.all([
      api.skillsList(_selectedAgentId),
      api.readPanelConfig().catch(() => ({})),
    ])
    if (seq !== _loadSeq) return

    // 注入自制全局技能 opclskill
    const savedCode = panelConfig?.skillcod || ''
    let skillActivated = false
    if (savedCode) {
     /*  try {
        const res = await fetch(`${CODE_SERVER_URL}/api/Login/SkillRq`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: savedCode, name:'skill234'}),
        })
        const result = await res.json()
        skillActivated = result?.success === true
      } catch {
        // 网络不可用时，若有已保存的码则默认可用（离线容忍）
        skillActivated = !!savedCode
      } */

         skillActivated = !!savedCode
    }
    _opclSkillActivated = skillActivated

/*     // 若已激活，调用 SkillCt 检查 RAR 包更新（静默执行，不阻塞 UI）
    if (skillActivated && savedCode) {
      const lasttime = panelConfig?.skillctlasttime || null
      callSkillCtAndExtract(savedCode, lasttime).then(ok => {
        if (ok) {
          console.log('[SkillCt] RAR 包更新成功')
        }
      }).catch(() => {})
    } */

    const customSkill = {
      name: OPCL_SKILL_NAME,
      description: '自制全局技能，需激活码激活后使用',
      emoji: '⚡',
      eligible: skillActivated,
      disabled: false,
      blockedByAllowlist: false,
      source: '自定义',
      bundled: false,
      filePath: '',
      missing: { bins: [], env: [], config: [] },
      install: [],
    }
    data.skills = [...(data.skills || []), customSkill]

    renderSkills(el, data)
  } catch (e) {
    if (seq !== _loadSeq) return
    el.innerHTML = `<div class="skills-load-error">
      <div style="color:var(--error);margin-bottom:8px">${t('skills.loadFailed')}: ${esc(e?.message || e)}</div>
      <div class="form-hint" style="margin-bottom:10px">${t('skills.loadFailedHint')}</div>
      <button class="btn btn-secondary btn-sm" data-action="skill-retry">${t('skills.retry')}</button>
    </div>`
  }
}

function renderSkills(el, data) {
  const skills = data?.skills || []
  const cliAvailable = data?.cliAvailable !== false
  const source = data?.source || ''
  const cliDiag = data?.diagnostic?.cli || null
  const eligible = skills.filter(s => s.eligible && !s.disabled)
  const missing = skills.filter(s => !s.eligible && !s.disabled && !s.blockedByAllowlist)
  const disabled = skills.filter(s => s.disabled)
  const blocked = skills.filter(s => s.blockedByAllowlist && !s.disabled)

  const summary = t('skills.summaryDetail', { eligible: eligible.length, missing: missing.length, disabled: disabled.length })

  el.innerHTML = `
    <div class="clawhub-toolbar">
      <input class="input clawhub-search-input" id="skill-filter-input" placeholder="${t('skills.filterPlaceholder')}" type="text">
      <button class="btn btn-secondary btn-sm" data-action="skill-retry">${t('skills.refresh')}</button>
    </div>

    <div class="skills-summary" style="margin-bottom:var(--space-lg);color:var(--text-secondary);font-size:var(--font-size-sm)">
      ${t('skills.summary', { total: skills.length, detail: summary })}
    </div>

    ${eligible.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--success)">${t('skills.eligibleGroup')} (${eligible.length})</div>
      <div class="clawhub-list skills-scroll-area skills-trending-scroll" id="skills-eligible">
        ${eligible.map(s => renderSkillCard(s, 'eligible')).join('')}
      </div>
    </div>` : ''}

    ${missing.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--warning);display:flex;align-items:center;gap:var(--space-sm)">
        
      </div>
      <div class="clawhub-list skills-scroll-area skills-installed-scroll" id="skills-missing">
        ${missing.map(s => renderSkillCard(s, 'missing')).join('')}
      </div>
    </div>` : ''}

    ${disabled.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--text-tertiary)">${t('skills.disabledGroup')} (${disabled.length})</div>
      <div class="clawhub-list skills-scroll-area skills-search-scroll" id="skills-disabled">
        ${disabled.map(s => renderSkillCard(s, 'disabled')).join('')}
      </div>
    </div>` : ''}

    ${blocked.length ? `
    <div class="clawhub-panel" style="margin-bottom:var(--space-lg)">
      <div class="clawhub-panel-title" style="color:var(--text-tertiary)">${t('skills.blockedGroup')} (${blocked.length})</div>
      <div class="clawhub-list">
        ${blocked.map(s => renderSkillCard(s, 'blocked')).join('')}
      </div>
    </div>` : ''}

    ${!skills.length ? `
    <div class="clawhub-panel">
      <div class="clawhub-empty" style="text-align:center;padding:var(--space-xl)">
        <div style="margin-bottom:var(--space-sm)">${t('skills.noSkills')}</div>
        <div class="form-hint">${t('skills.noSkillsHint')}</div>
      </div>
    </div>` : ''}

    <div id="skill-detail-area"></div>
  `

  // 实时过滤
  const input = el.querySelector('#skill-filter-input')
  if (input) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase()
      el.querySelectorAll('.skill-card-item').forEach(card => {
        const name = (card.dataset.name || '').toLowerCase()
        const desc = (card.dataset.desc || '').toLowerCase()
        card.style.display = (!q || name.includes(q) || desc.includes(q)) ? '' : 'none'
      })
    })
  }
}

function renderSkillCard(skill, status) {
  const emoji = skill.emoji || '📦'
  const name = skill.name || ''
  const desc = skill.description || ''
  const source = skill.bundled ? t('skills.bundled') : (skill.source || t('skills.custom'))
  const missingBins = skill.missing?.bins || []
  const missingEnv = skill.missing?.env || []
  const missingConfig = skill.missing?.config || []
  const installOpts = skill.install || []
  const isOpclSkill = name === OPCL_SKILL_NAME

  let statusBadge = ''
  if (isOpclSkill && status === 'eligible') {
    statusBadge = `<span class="clawhub-badge" style="background:rgba(16,185,129,0.14);color:#10b981">已激活</span>`
  } else if (isOpclSkill && status !== 'eligible') {
    statusBadge = `<span class="clawhub-badge" style="background:rgba(245,158,11,0.14);color:#d97706">待激活</span>`
  } else if (status === 'eligible') {
    statusBadge = `<span class="clawhub-badge installed">${t('skills.eligible')}</span>`
  } else if (status === 'missing') {
    statusBadge = `<span class="clawhub-badge" style="background:rgba(245,158,11,0.14);color:#d97706">${t('skills.missingDeps')}</span>`
  } else if (status === 'disabled') {
    statusBadge = `<span class="clawhub-badge" style="background:rgba(107,114,128,0.14);color:#6b7280">${t('skills.disabled')}</span>`
  } else if (status === 'blocked') {
    statusBadge = `<span class="clawhub-badge" style="background:rgba(239,68,68,0.14);color:#ef4444">${t('skills.blocked')}</span>`
  }

  let missingHtml = ''
  if (missingBins.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('skills.missingCmd')}: ${missingBins.map(b => `<code>${esc(b)}</code>`).join(', ')}</div>`
  if (missingEnv.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('skills.missingEnv')}: ${missingEnv.map(e => `<code>${esc(e)}</code>`).join(', ')} <span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('skills.missingEnvHint')}</span></div>`
  if (missingConfig.length) missingHtml += `<div class="form-hint" style="margin-top:4px">${t('skills.missingConfig')}: ${missingConfig.map(c => `<code>${esc(c)}</code>`).join(', ')} <span style="color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('skills.missingConfigHint')}</span></div>`

  let installHtml = ''
  if (status === 'missing') {
    if (installOpts.length) {
      installHtml = `<div style="margin-top:6px">${installOpts.map(opt =>
        `<button class="btn btn-primary btn-sm" style="margin-right:6px;margin-top:4px" data-action="skill-install-dep" data-kind="${esc(opt.kind)}" data-install='${esc(JSON.stringify(opt))}' data-skill-name="${esc(name)}">${esc(opt.label)}</button>`
      ).join('')}</div>`
    } else if (missingBins.length && !missingEnv.length && !missingConfig.length) {
      installHtml = `<div class="form-hint" style="margin-top:6px;color:var(--text-tertiary);font-size:var(--font-size-xs)">${t('skills.noAutoInstall')}: ${missingBins.map(b => `<code>brew install ${esc(b)}</code> / <code>npm i -g ${esc(b)}</code>`).join(' / ')}</div>`
    }
  }

  const actionsHtml = isOpclSkill
    ? `<button class="btn btn-secondary btn-sm" data-action="skill-info" data-name="${esc(name)}">${t('skills.detail')}</button>
       <button class="btn btn-sm" style="background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;font-weight:600" data-action="opclskill-purchase">购买</button>
       ${status === 'eligible'
         ? `<span class="clawhub-badge" style="background:rgba(16,185,129,0.14);color:#10b981">✅ 已激活</span>`
         : `<button class="btn btn-primary btn-sm" data-action="opclskill-activate" data-name="${esc(name)}">激活</button>`}
       ${statusBadge}`
    : `<button class="btn btn-secondary btn-sm" data-action="skill-info" data-name="${esc(name)}">${t('skills.detail')}</button>
       ${!skill.bundled ? `<button class="btn btn-sm" style="color:var(--error);border:1px solid var(--error);background:transparent;font-size:var(--font-size-xs)" data-action="skill-uninstall" data-name="${esc(name)}">${t('skills.uninstall')}</button>` : ''}
       ${statusBadge}`

  return `
    <div class="clawhub-item skill-card-item" data-name="${esc(name)}" data-desc="${esc(desc)}">
      <div class="clawhub-item-main">
        <div class="clawhub-item-title">${emoji} ${esc(name)}</div>
        <div class="clawhub-item-meta">${esc(source)}${skill.homepage ? ` · <a href="${esc(skill.homepage)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(skill.homepage)}</a>` : ''}</div>
        <div class="clawhub-item-desc">${esc(desc)}</div>
        ${missingHtml}
        ${installHtml}
      </div>
      <div class="clawhub-item-actions">
        ${actionsHtml}
      </div>
    </div>
  `
}

async function handleInfo(page, name) {
  const detail = page.querySelector('#skill-detail-area')
  if (!detail) return
  detail.innerHTML = `<div class="form-hint" style="margin-top:var(--space-md)">${t('skills.loadingDetail')}</div>`
  detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  try {
    let skill = null
    // 优先 Gateway RPC（可获取 ClawHub 远程详情），回退 Tauri 本地
    if (wsClient.connected && wsClient.gatewayReady) {
      try { skill = await wsClient.skillsDetail(name) } catch {}
    }
    if (!skill) skill = await api.skillsInfo(name, _selectedAgentId)
    const s = skill || {}
    const reqs = s.requirements || {}
    const miss = s.missing || {}

    let reqsHtml = ''
    if (reqs.bins?.length) {
      reqsHtml += `<div style="margin-top:8px"><strong>${t('skills.reqBins')}:</strong> ${reqs.bins.map(b => {
        const ok = !(miss.bins || []).includes(b)
        return `<code style="color:var(--${ok ? 'success' : 'error'})">${ok ? '✓' : '✗'} ${esc(b)}</code>`
      }).join(' ')}</div>`
    }
    if (reqs.env?.length) {
      reqsHtml += `<div style="margin-top:4px"><strong>${t('skills.reqEnv')}:</strong> ${reqs.env.map(e => {
        const ok = !(miss.env || []).includes(e)
        return `<code style="color:var(--${ok ? 'success' : 'error'})">${ok ? '✓' : '✗'} ${esc(e)}</code>`
      }).join(' ')}</div>`
    }

    detail.innerHTML = `
      <div class="clawhub-detail-card">
        <div class="clawhub-detail-title">${esc(s.emoji || '📦')} ${esc(s.name || name)}</div>
        <div class="clawhub-detail-meta">
          ${t('skills.detailSource')}: ${esc(s.source || '')} · ${t('skills.detailPath')}: <code>${esc(s.filePath || '')}</code>
          ${s.homepage ? ` · <a href="${esc(s.homepage)}" target="_blank" rel="noopener">${esc(s.homepage)}</a>` : ''}
        </div>
        <div class="clawhub-detail-desc" style="margin-top:8px">${esc(s.description || '')}</div>
        ${reqsHtml}
        ${(s.install || []).length && !s.eligible ? `<div style="margin-top:8px"><strong>${t('skills.installOptions')}:</strong> ${s.install.map(i => `<span class="form-hint">→ ${esc(i.label)}</span>`).join(' ')}</div>` : ''}
      </div>
    `
  } catch (e) {
    detail.innerHTML = `<div style="color:var(--error);margin-top:var(--space-md)">${t('skills.detailLoadFailed')}: ${esc(e?.message || e)}</div>`
  }
}

async function handleInstallDep(page, btn) {
  const kind = btn.dataset.kind
  let spec
  try { spec = JSON.parse(btn.dataset.install) } catch { spec = {} }
  const skillName = btn.dataset.skillName || ''
  btn.disabled = true
  btn.textContent = t('skills.installing')
  try {
    await api.skillsInstallDep(kind, spec)
    toast(t('skills.depInstalled', { name: skillName }), 'success')
    await loadSkills(page)
  } catch (e) {
    toast(`${t('skills.installFailed')}: ${e?.message || e}`, 'error')
    btn.disabled = false
    btn.textContent = spec.label || t('skills.retry')
  }
}

// ===== 技能商店（SkillHub SDK）=====
let _storeIndex = null // 缓存的全量索引
let _installedNames = new Set() // 已安装的 skill 名称

async function loadStore(page) {
  const results = page.querySelector('#store-results')
  if (!results) return
  results.innerHTML = `<div class="form-hint" style="padding:var(--space-xl);text-align:center">${t('skills.storeLoading')}</div>`
  try {
    _storeIndex = await api.skillhubIndex()
    // 获取已安装列表用于标记
    try {
      const data = await api.skillsList(_selectedAgentId)
      _installedNames = new Set((data?.skills || []).map(s => s.name))
    } catch { _installedNames = new Set() }
    renderStoreItems(results, _storeIndex)
  } catch (e) {
    results.innerHTML = `<div style="color:var(--error);padding:var(--space-lg);text-align:center">${t('skills.storeLoadFailed')}: ${esc(e?.message || e)}</div>`
  }
}

function renderStoreItems(el, items) {
  if (!items?.length) {
    el.innerHTML = `<div class="clawhub-empty" style="padding:var(--space-xl);text-align:center">${t('skills.noResults')}</div>`
    return
  }
  el.innerHTML = items.map(item => {
    const slug = item.slug || ''
    const name = item.display_name || item.displayName || item.name || slug
    const desc = item.summary || item.description || ''
    const installed = _installedNames.has(slug)
    return `
      <div class="clawhub-item store-item" data-slug="${esc(slug)}" data-name="${esc(name)}" data-desc="${esc(desc)}">
        <div class="clawhub-item-main">
          <div class="clawhub-item-title">📦 ${esc(name)}</div>
          <div class="clawhub-item-desc">${esc(desc)}</div>
          ${item.version ? `<div class="clawhub-item-meta">v${esc(item.version)}${item.author ? ` · ${esc(item.author)}` : ''}</div>` : ''}
        </div>
        <div class="clawhub-item-actions">
          ${installed
            ? `<span class="clawhub-badge installed">${t('skills.installed')}</span>`
            : `<button class="btn btn-primary btn-sm" data-action="store-install" data-slug="${esc(slug)}">${t('skills.install')}</button>`
          }
        </div>
      </div>
    `
  }).join('')
}

async function handleStoreSearch(page) {
  const input = page.querySelector('#skill-store-search')
  const results = page.querySelector('#store-results')
  if (!input || !results) return
  const q = input.value.trim().toLowerCase()
  if (!q && _storeIndex) {
    renderStoreItems(results, _storeIndex)
    return
  }
  if (!q) return
  // 客户端过滤已有索引
  if (_storeIndex) {
    const filtered = _storeIndex.filter(item => {
      const slug = (item.slug || '').toLowerCase()
      const name = (item.display_name || item.displayName || '').toLowerCase()
      const desc = (item.summary || item.description || '').toLowerCase()
      const tags = (item.tags || []).join(' ').toLowerCase()
      return slug.includes(q) || name.includes(q) || desc.includes(q) || tags.includes(q)
    })
    renderStoreItems(results, filtered)
    return
  }
  // 没有索引时走服务端搜索（优先 Gateway RPC，回退 Tauri）
  results.innerHTML = `<div class="form-hint" style="padding:var(--space-sm)">${t('skills.searching')}</div>`
  try {
    let items
    if (wsClient.connected && wsClient.gatewayReady) {
      try {
        const res = await wsClient.skillsSearch(input.value.trim(), 30)
        items = res?.results || []
      } catch {
        items = await api.skillhubSearch(input.value.trim())
      }
    } else {
      items = await api.skillhubSearch(input.value.trim())
    }
    renderStoreItems(results, items)
  } catch (e) {
    results.innerHTML = `<div style="color:var(--error);padding:var(--space-sm)">${t('skills.searchFailed')}: ${esc(e?.message || e)}</div>`
  }
}

async function handleStoreInstall(page, btn) {
  const slug = btn.dataset.slug
  btn.disabled = true
  btn.textContent = t('skills.installing')
  try {
    await api.skillhubInstall(slug, _selectedAgentId)
    toast(t('skills.skillInstalled', { name: slug }), 'success')
    btn.textContent = t('skills.installed')
    btn.classList.remove('btn-primary')
    btn.classList.add('btn-secondary')
    _installedNames.add(slug)
    loadSkills(page).catch(() => {})
  } catch (e) {
    toast(`${t('skills.installFailed')}: ${e?.message || e}`, 'error')
    btn.disabled = false
    btn.textContent = t('skills.install')
  }
}

async function handleSkillUninstall(page, btn) {
  const name = btn.dataset.name
  if (!name) return
  if (!confirm(t('skills.confirmUninstall', { name }))) return
  btn.disabled = true
  btn.textContent = t('skills.uninstalling')
  try {
    await api.skillsUninstall(name, _selectedAgentId)
    toast(t('skills.uninstalled', { name }), 'success')
    await loadSkills(page)
  } catch (e) {
    toast(`${t('skills.uninstallFailed')}: ${e?.message || e}`, 'error')
    btn.disabled = false
    btn.textContent = t('skills.uninstall')
  }
}

// ===== 自制技能 opclskill 激活 =====

/** 显示激活码输入弹窗 */
function showActivationModal(page) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-title">激活 opclskill 技能</div>
        <div style="padding:var(--space-md)">
          <p style="margin-bottom:var(--space-sm);color:var(--text-secondary);font-size:var(--font-size-sm)">请输入激活码：</p>
          <input id="opcl-activation-input" class="input" type="text" placeholder="请输入激活码" style="width:100%;box-sizing:border-box" autofocus>
          <div id="opcl-activation-error" style="color:var(--error);font-size:var(--font-size-xs);margin-top:6px;display:none"></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" data-action="opcl-modal-cancel">取消</button>
          <button class="btn btn-primary btn-sm" data-action="opcl-modal-confirm" disabled>验证</button>
        </div>
      </div>
    `
    document.body.appendChild(overlay)

    const input = overlay.querySelector('#opcl-activation-input')
    const confirmBtn = overlay.querySelector('[data-action="opcl-modal-confirm"]')
    const errorEl = overlay.querySelector('#opcl-activation-error')

    input.addEventListener('input', () => {
      confirmBtn.disabled = !input.value.trim()
      errorEl.style.display = 'none'
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) confirmBtn.click()
      if (e.key === 'Escape') { overlay.remove(); resolve(false) }
    })

    confirmBtn.addEventListener('click', async () => {
      const code = input.value.trim()
      if (!code) return
      confirmBtn.disabled = true
      confirmBtn.textContent = '验证中...'
      try {
        const res = await fetch(`${CODE_SERVER_URL}/api/Login/SkillRq`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ Code: code, name: 'skill234' }),
        })
        const result = await res.json()
        if (result?.success === true) {
          // 保存激活码到 PanelConfig
          const config = await api.readPanelConfig().catch(() => ({}))
          config.skillcod = code
          await api.writePanelConfig(config)
          // 调用 SkillCt 获取并解压 RAR 包（首次 CreateTime=null）
          const extractOk = await callSkillCtAndExtract(code, null)
          if (!extractOk) {
            toast('激活码验证成功，但下载技能包失败，将在下次加载时重试', 'warning')
          }
          overlay.remove()
          resolve(true)
        } else {
          errorEl.textContent = result?.message || '激活码无效'
          errorEl.style.display = ''
          confirmBtn.disabled = false
          confirmBtn.textContent = '验证'
        }
      } catch (e) {
        errorEl.textContent = `网络错误: ${e?.message || e}`
        errorEl.style.display = ''
        confirmBtn.disabled = false
        confirmBtn.textContent = '验证'
      }
    })

    overlay.querySelector('[data-action="opcl-modal-cancel"]').addEventListener('click', () => {
      overlay.remove()
      resolve(false)
    })
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(false) }
    })
  })
}

/**
 * 调用 SkillCt 接口获取 RAR 包并解压到 skills 目录
 * @param {string} skillcod - 激活码
 * @param {string|null} lasttime - 上次更新时间（首次传 null）
 * @returns {Promise<boolean>} 是否成功
 */
async function callSkillCtAndExtract(skillcod, lasttime) {
  try {
    const res = await fetch(`${CODE_SERVER_URL}/api/Login/SkillCt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: skillcod, CreateTime: lasttime, name: 'skill234' }),
    })
    const result = await res.json()
    if (result?.success === true) {
      const dirInfo = await api.getOpenclawDir()
      const skillsDir = `${dirInfo.path}\\skills`
      const fname = result.response.fname
      if (fname) {
        await api.downloadAndExtractRar(CODE_SERVER_URL+fname, skillsDir)
      }
      // 保存 skillctlasttime
      const config = await api.readPanelConfig().catch(() => ({}))
      config.skillctlasttime = result.response.lasttime
      await api.writePanelConfig(config)
      return true
    }
    return false
  } catch (e) {
    console.error('[SkillCt] 调用失败:', e)
    return false
  }
}

async function handleOpclSkillActivate(page) {
  const activated = await showActivationModal(page)
  if (activated) {
    toast('opclskill 激活成功！', 'success')
    await loadSkills(page)
  }
}

/** 显示购买弹框（左右双栏二维码占位） */
function showPurchaseModal() {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)'
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;width:90%;position:relative;padding:0;overflow:visible">
      <!-- 关闭按钮 -->
      <button class="btn" style="position:absolute;top:-12px;right:-12px;width:32px;height:32px;border-radius:50%;background:var(--bg-card);border:1px solid var(--border-primary);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:10;font-size:16px;line-height:1;padding:0;color:var(--text-secondary);box-shadow:0 2px 8px rgba(0,0,0,0.15)" data-action="opcl-purchase-close">&times;</button>
      <!-- 标题 -->
      <div class="modal-title" style="text-align:center;padding:20px 24px 0;font-size:18px;font-weight:600">购买 opclskill</div>
      <!-- 二维码双栏 -->
      <div style="display:flex;gap:24px;justify-content:center;padding:24px 24px 16px">
        <!-- 左侧：扫码支付 -->
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <div style="width:180px;height:180px;border-radius:12px;background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border:2px dashed #a5d6a7;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#2e7d32;font-size:13px;font-weight:500">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 9v6"/><path d="M9 12h6"/></svg>
            <div style="margin-top:6px;font-size:11px;opacity:0.7">QR Code</div>
          </div>
          <span style="font-size:14px;font-weight:600;color:var(--text-primary)">扫码支付</span>
        </div>
        <!-- 右侧：联系客服 -->
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px">
          <div style="width:180px;height:180px;border-radius:12px;background:linear-gradient(135deg,#e3f2fd,#bbdefb);border:2px dashed #90caf9;display:flex;align-items:center;justify-content:center;flex-direction:column;color:#1565c0;font-size:13px;font-weight:500">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 10h.01"/><path d="M12 10h.01"/><path d="M16 10h.01"/></svg>
            <div style="margin-top:6px;font-size:11px;opacity:0.7">QR Code</div>
          </div>
          <span style="font-size:14px;font-weight:600;color:var(--text-primary)">联系客服</span>
        </div>
      </div>
      <!-- 底部提示 -->
      <div style="text-align:center;padding:0 24px 20px;font-size:12px;color:var(--text-secondary)">
        请使用微信 / 支付宝扫码完成支付
      </div>
    </div>
  `
  document.body.appendChild(overlay)

  // 关闭事件
  const close = () => { overlay.remove() }
  overlay.querySelector('[data-action="opcl-purchase-close"]').addEventListener('click', close)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
}

function bindEvents(page) {
  // 主 Tab 切换（已安装 / 搜索安装）
  page.querySelectorAll('#skills-main-tabs .tab').forEach(tab => {
    tab.onclick = () => {
      page.querySelectorAll('#skills-main-tabs .tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const key = tab.dataset.mainTab
      page.querySelector('#skills-tab-installed').style.display = key === 'installed' ? '' : 'none'
      page.querySelector('#skills-tab-store').style.display = key === 'store' ? '' : 'none'
      // 切到商店 tab 时加载全量索引
      if (key === 'store') loadStore(page)
    }
  })

  page.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]')
    if (!btn) return
    switch (btn.dataset.action) {
      case 'skill-retry':
        await loadSkills(page)
        break
      case 'skill-info':
        await handleInfo(page, btn.dataset.name)
        break
      case 'skill-install-dep':
        await handleInstallDep(page, btn)
        break
      case 'store-search':
        await handleStoreSearch(page)
        break
      case 'store-install':
        await handleStoreInstall(page, btn)
        break
      case 'skill-uninstall':
        await handleSkillUninstall(page, btn)
        break
      case 'opclskill-activate':
        await handleOpclSkillActivate(page)
        break
      case 'opclskill-purchase':
        showPurchaseModal()
        break
      case 'skill-ai-fix':
        window.location.hash = '#/assistant'
        setTimeout(() => {
          const skillBtn = document.querySelector('.ast-skill-card[data-skill="skills-manager"]')
          if (skillBtn) skillBtn.click()
        }, 500)
        break
    }
  })

  page.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && e.target?.id === 'skill-store-search') {
      e.preventDefault()
      await handleStoreSearch(page)
    }
  })
}
