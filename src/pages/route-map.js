/**
 * 路由地图 — Channel → Binding → Agent 全局拓扑可视化
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { navigate } from '../router.js'
import { t } from '../lib/i18n.js'

const CHANNEL_COLORS = {
  qqbot: '#22d3ee', qq: '#22d3ee', telegram: '#3b82f6', discord: '#818cf8',
  slack: '#f59e0b', feishu: '#6366f1', dingtalk: '#3b82f6', weixin: '#22c55e',
  wechat: '#22c55e', webchat: '#a78bfa', whatsapp: '#22c55e', signal: '#60a5fa',
  line: '#22c55e', teams: '#6366f1', matrix: '#f472b6', irc: '#94a3b8',
}

const NODE_W = 180, NODE_H = 56, COL_GAP = 260, ROW_GAP = 16, PAD_TOP = 80, PAD_LEFT = 40

function escAttr(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') }

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('routeMap.title')}</h1>
      <div class="page-actions" style="display:flex;align-items:center;gap:var(--space-sm)">
        <span style="font-size:var(--font-size-xs);color:var(--text-tertiary)">${t('routeMap.clickToNavigate')}</span>
        <button class="btn btn-sm btn-secondary" id="rm-refresh">${t('routeMap.refresh')}</button>
      </div>
    </div>
    <p class="form-hint" style="margin-bottom:var(--space-md)">${t('routeMap.subtitle')}</p>
    <div id="rm-stats" class="route-map-stats"></div>
    <div id="rm-canvas" class="route-map-canvas">
      <div class="stat-card loading-placeholder" style="height:300px"></div>
    </div>
  `

  async function loadAndRender() {
    const canvas = page.querySelector('#rm-canvas')
    const statsEl = page.querySelector('#rm-stats')
    canvas.innerHTML = '<div class="stat-card loading-placeholder" style="height:300px;display:flex;align-items:center;justify-content:center;color:var(--text-tertiary)">' + t('routeMap.loading') + '</div>'

    try {
      const [agentsRaw, bindingsRaw, platformsRaw] = await Promise.all([
        api.listAgents(),
        api.listAllBindings().catch(() => []),
        api.listConfiguredPlatforms().catch(() => []),
      ])

      const agents = Array.isArray(agentsRaw) ? agentsRaw : (agentsRaw?.agents || [])
      const bindings = Array.isArray(bindingsRaw) ? bindingsRaw : (bindingsRaw?.bindings || [])
      const platforms = Array.isArray(platformsRaw) ? platformsRaw : []

      if (agents.length === 0 && platforms.length === 0) {
        canvas.innerHTML = `<div class="stat-card" style="padding:var(--space-xl);text-align:center;color:var(--text-tertiary)">${t('routeMap.noData')}</div>`
        statsEl.innerHTML = ''
        return
      }

      // Fetch agent details to get sub-agent relationships
      const agentDetails = await Promise.all(
        agents.map(a => api.getAgentDetail(a.id || a.name || 'main').catch(() => null))
      )
      // Merge detail data into agents
      for (let i = 0; i < agents.length; i++) {
        if (agentDetails[i]) {
          agents[i] = { ...agents[i], ...agentDetails[i] }
        }
      }

      // Stats bar
      const subAgentCount = agents.filter(a => {
        const allow = a.tools?.agentToAgent?.allow
        return Array.isArray(allow) && allow.length > 0
      }).length
      statsEl.innerHTML = `
        <div class="route-map-stat"><span class="route-map-stat-num">${agents.length}</span><span class="route-map-stat-label">${t('routeMap.statsAgents')}</span></div>
        <div class="route-map-stat"><span class="route-map-stat-num">${platforms.length}</span><span class="route-map-stat-label">${t('routeMap.statsChannels')}</span></div>
        <div class="route-map-stat"><span class="route-map-stat-num">${bindings.length}</span><span class="route-map-stat-label">${t('routeMap.statsBindings')}</span></div>
        ${subAgentCount ? `<div class="route-map-stat"><span class="route-map-stat-num">${subAgentCount}</span><span class="route-map-stat-label">${t('routeMap.subAgentRelations')}</span></div>` : ''}
      `

      renderTopology(canvas, agents, bindings, platforms)
    } catch (e) {
      canvas.innerHTML = `<div class="stat-card" style="padding:var(--space-lg);color:var(--text-danger)">${escAttr(e.message || e)}</div>`
    }
  }

  page.querySelector('#rm-refresh').onclick = () => loadAndRender()
  setTimeout(loadAndRender, 0)
  return page
}

function renderTopology(container, agents, bindings, platforms) {
  // Build channel nodes (left column)
  const channelNodes = platforms.map((p, i) => {
    const id = p.platform || p.id || p.channel || `ch-${i}`
    const label = p.label || p.platform || id
    const enabled = p.enabled !== false
    return { id, label, enabled, color: CHANNEL_COLORS[id.toLowerCase()] || '#94a3b8', type: 'channel', originalIndex: i }
  })

  // Build agent nodes (right column)
  const defaultAgentId = agents.find(a => a.default || a.isDefault)?.id || agents[0]?.id || 'main'
  const agentNodes = agents.map((a, i) => {
    const id = a.id || a.name || `agent-${i}`
    const identity = a.identity || {}
    const emoji = identity.emoji || '🤖'
    const label = identity.name || id
    const isDefault = a.default || a.isDefault || id === defaultAgentId
    return { id, label, emoji, isDefault, type: 'agent', originalIndex: i }
  })

  // Build edges from bindings
  const edges = []
  for (const b of bindings) {
    const agentId = b.agentId || b.agent || ''
    const channel = b.match?.channel || b.channel || ''
    const enabled = b.enabled !== false
    const peer = b.match?.peer
    const accountId = b.match?.accountId
    let hint = ''
    if (peer) hint = t('routeMap.peer')
    else if (accountId) hint = `${t('routeMap.account')}: ${accountId}`
    edges.push({ from: channel, to: agentId, enabled, hint, channel, agentId })
  }

  // Add implicit default agent edges for channels without bindings
  const boundChannels = new Set(edges.map(e => e.from))
  for (const ch of channelNodes) {
    if (!boundChannels.has(ch.id) && ch.enabled) {
      edges.push({ from: ch.id, to: defaultAgentId, enabled: true, hint: t('routeMap.defaultAgent'), channel: ch.id, agentId: defaultAgentId, implicit: true })
    }
  }

  // Layout: 3 columns — Channels | gap | Agents
  const leftCount = Math.max(channelNodes.length, 1)
  const rightCount = Math.max(agentNodes.length, 1)
  const maxRows = Math.max(leftCount, rightCount)
  const svgW = PAD_LEFT * 2 + NODE_W * 2 + COL_GAP
  const svgH = PAD_TOP + maxRows * (NODE_H + ROW_GAP) + 40

  // Position nodes
  channelNodes.forEach((n, i) => {
    n.x = PAD_LEFT
    n.y = PAD_TOP + i * (NODE_H + ROW_GAP) + (maxRows - leftCount) * (NODE_H + ROW_GAP) / 2
  })
  agentNodes.forEach((n, i) => {
    n.x = PAD_LEFT + NODE_W + COL_GAP
    n.y = PAD_TOP + i * (NODE_H + ROW_GAP) + (maxRows - rightCount) * (NODE_H + ROW_GAP) / 2
  })

  // Build agent-to-agent edges from tools.agentToAgent.allow
  const a2aEdges = []
  for (const a of agents) {
    const allow = a.tools?.agentToAgent?.allow
    if (!Array.isArray(allow) || a.tools?.agentToAgent?.enabled === false) continue
    const fromId = a.id || a.name || 'main'
    for (const targetId of allow) {
      if (targetId && targetId !== fromId) {
        a2aEdges.push({ from: fromId, to: targetId })
      }
    }
  }

  // Build node lookup
  const nodeMap = {}
  for (const n of [...channelNodes, ...agentNodes]) nodeMap[n.id] = n

  // Extra height for legend if we have a2a edges
  const legendH = a2aEdges.length > 0 ? 60 : 20

  // Render SVG
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH + legendH}" viewBox="0 0 ${svgW} ${svgH + legendH}" class="route-map-svg">`

  // Column headers
  svg += `<text x="${PAD_LEFT + NODE_W / 2}" y="30" text-anchor="middle" class="route-map-col-label">${t('routeMap.channels')}</text>`
  svg += `<text x="${PAD_LEFT + NODE_W + COL_GAP + NODE_W / 2}" y="30" text-anchor="middle" class="route-map-col-label">${t('routeMap.agents')}</text>`
  svg += `<text x="${PAD_LEFT + NODE_W + COL_GAP / 2}" y="30" text-anchor="middle" class="route-map-col-label" style="font-size:11px;opacity:0.5">${t('routeMap.bindings')}</text>`

  // Draw edges
  for (const e of edges) {
    const src = nodeMap[e.from]
    const dst = nodeMap[e.to]
    if (!src || !dst) continue
    const x1 = src.x + NODE_W
    const y1 = src.y + NODE_H / 2
    const x2 = dst.x
    const y2 = dst.y + NODE_H / 2
    const cx1 = x1 + COL_GAP * 0.35
    const cx2 = x2 - COL_GAP * 0.35
    const opacity = e.enabled ? 0.7 : 0.25
    const dash = e.implicit ? '6,4' : 'none'
    const color = e.enabled ? (src.color || '#6366f1') : '#94a3b8'
    svg += `<path d="M${x1},${y1} C${cx1},${y1} ${cx2},${y2} ${x2},${y2}" fill="none" stroke="${color}" stroke-width="2" stroke-opacity="${opacity}" stroke-dasharray="${dash}"/>`
    // Arrow
    svg += `<circle cx="${x2 - 3}" cy="${y2}" r="3" fill="${color}" fill-opacity="${opacity}"/>`
    // Edge label
    if (e.hint) {
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      svg += `<text x="${mx}" y="${my - 6}" text-anchor="middle" class="route-map-edge-label">${escAttr(e.hint)}</text>`
    }
  }

  // Draw channel nodes
  for (const n of channelNodes) {
    const opacity = n.enabled ? 1 : 0.45
    svg += `<g class="route-map-node" data-nav="channels" style="cursor:pointer;opacity:${opacity}">
      <rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="10" class="route-map-card" style="stroke:${n.color}"/>
      <circle cx="${n.x + 22}" cy="${n.y + NODE_H / 2}" r="8" fill="${n.color}" fill-opacity="0.15"/>
      <text x="${n.x + 22}" y="${n.y + NODE_H / 2 + 1}" text-anchor="middle" class="route-map-node-emoji" style="font-size:10px">${n.enabled ? '📡' : '⏸'}</text>
      <text x="${n.x + 40}" y="${n.y + NODE_H / 2 - 4}" class="route-map-node-label">${escAttr(n.label)}</text>
      <text x="${n.x + 40}" y="${n.y + NODE_H / 2 + 12}" class="route-map-node-sub">${n.enabled ? t('routeMap.enabled') : t('routeMap.disabled')}</text>
    </g>`
  }

  // Draw agent nodes
  for (const n of agentNodes) {
    svg += `<g class="route-map-node" data-nav="agents" style="cursor:pointer">
      <rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="10" class="route-map-card ${n.isDefault ? 'route-map-card-default' : ''}"/>
      <text x="${n.x + 22}" y="${n.y + NODE_H / 2 + 5}" text-anchor="middle" style="font-size:16px">${n.emoji}</text>
      <text x="${n.x + 40}" y="${n.y + NODE_H / 2 - 4}" class="route-map-node-label">${escAttr(n.label)}</text>
      <text x="${n.x + 40}" y="${n.y + NODE_H / 2 + 12}" class="route-map-node-sub">${n.isDefault ? '⭐ ' + t('routeMap.defaultAgent') : n.id}</text>
    </g>`
  }

  // Draw agent-to-agent sub-agent edges (amber dashed, curved right of agent column)
  for (let i = 0; i < a2aEdges.length; i++) {
    const e = a2aEdges[i]
    const src = nodeMap[e.from]
    const dst = nodeMap[e.to]
    if (!src || !dst) continue
    const x1 = src.x + NODE_W
    const y1 = src.y + NODE_H / 2
    const x2 = dst.x + NODE_W
    const y2 = dst.y + NODE_H / 2
    const bulge = 40 + i * 12
    const cx = Math.max(x1, x2) + bulge
    svg += `<path d="M${x1},${y1} Q${cx},${(y1 + y2) / 2} ${x2},${y2}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3" stroke-opacity="0.7"/>`
    svg += `<circle cx="${x2}" cy="${y2}" r="2.5" fill="#f59e0b" fill-opacity="0.7"/>`
    const mx = cx - 4
    const my = (y1 + y2) / 2
    svg += `<text x="${mx}" y="${my - 4}" text-anchor="end" class="route-map-edge-label" style="fill:#f59e0b">${t('routeMap.subAgentCall')}</text>`
  }

  // Legend
  const ly = svgH + (a2aEdges.length > 0 ? 10 : 0)
  svg += `<g class="route-map-legend">`
  let lx = PAD_LEFT
  // Solid line = explicit binding
  svg += `<line x1="${lx}" y1="${ly}" x2="${lx + 24}" y2="${ly}" stroke="var(--accent)" stroke-width="2"/>`
  svg += `<text x="${lx + 30}" y="${ly + 4}" class="route-map-edge-label" style="font-size:10px;fill:var(--text-secondary)">${t('routeMap.legendBinding')}</text>`
  lx += 110
  // Dashed line = default route
  svg += `<line x1="${lx}" y1="${ly}" x2="${lx + 24}" y2="${ly}" stroke="#94a3b8" stroke-width="2" stroke-dasharray="6,4"/>`
  svg += `<text x="${lx + 30}" y="${ly + 4}" class="route-map-edge-label" style="font-size:10px;fill:var(--text-secondary)">${t('routeMap.legendDefault')}</text>`
  if (a2aEdges.length > 0) {
    lx += 110
    svg += `<line x1="${lx}" y1="${ly}" x2="${lx + 24}" y2="${ly}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3"/>`
    svg += `<text x="${lx + 30}" y="${ly + 4}" class="route-map-edge-label" style="font-size:10px;fill:#f59e0b">${t('routeMap.subAgentCall')}</text>`
  }
  svg += `</g>`

  svg += '</svg>'

  container.innerHTML = `<div class="route-map-scroll">${svg}</div>`

  // Click to navigate
  container.querySelectorAll('.route-map-node').forEach(el => {
    el.addEventListener('click', () => {
      const target = el.dataset.nav
      if (target) navigate('/' + target)
    })
  })
}
