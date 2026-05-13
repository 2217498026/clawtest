/**
 * Hermes Agent 对话页面
 * 通过 /v1/runs + SSE 事件流驱动，支持工具调用可视化和流式文本
 * 支持多会话管理、/xxx 快捷指令
 */
import { t } from '../../../lib/i18n.js'
import { api } from '../../../lib/tauri-api.js'
import { PROVIDER_PRESETS } from '../../../lib/model-presets.js'

const STORAGE_KEY = 'hermes_chat_sessions'
const FILE_ACCESS_KEY = 'hermes_chat_file_access'
const SLASH_COMMANDS = [
  { cmd: '/help',    desc: '显示可用命令' },
  { cmd: '/status',  desc: '查看 Agent 状态' },
  { cmd: '/memory',  desc: '管理记忆' },
  { cmd: '/skills',  desc: '查看技能列表' },
  { cmd: '/clear',   desc: '清空当前会话' },
  { cmd: '/new',     desc: '新建会话' },
]

const TOOL_ICONS = {
  web_search: '🔍', browse: '🌐', web_browse: '🌐', google: '🔍',
  code: '💻', execute_code: '💻', run_code: '💻', python: '🐍',
  terminal: '⌨️', shell: '⌨️', bash: '⌨️', command: '⌨️',
  file: '📁', read_file: '📁', write_file: '📝',
  memory: '🧠', recall: '🧠',
  default: '🔧',
}
function toolIcon(name) {
  const n = (name || '').toLowerCase()
  for (const [k, v] of Object.entries(TOOL_ICONS)) {
    if (n.includes(k)) return v
  }
  return TOOL_ICONS.default
}

function mdToHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>')
}
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }

// Lazy Tauri event listen (avoid top-level await for vite build)
let _listenFn = null
async function tauriListen(event, cb) {
  if (!_listenFn) {
    const mod = await import('@tauri-apps/api/event')
    _listenFn = mod.listen
  }
  return _listenFn(event, cb)
}

// --- Session persistence ---
function loadSessions() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}
function sessionTitle(s) {
  if (s.title) return s.title
  const first = s.messages.find(m => m.role === 'user')
  return first ? first.content.slice(0, 30) : t('engine.chatNewSession')
}

export function render() {
  const el = document.createElement('div')
  el.className = 'page hermes-chat-page'

  let sessions = loadSessions()
  let activeId = sessions[0]?.id || null
  let streaming = false
  let gwOnline = false
  let showSlash = false
  let slashFilter = ''
  let currentModel = ''       // 当前模型名
  let modelList = []          // 已获取的模型列表
  let showModelDropdown = false
  let fileAccessEnabled = localStorage.getItem(FILE_ACCESS_KEY) === 'true'

  // 流式状态
  let pendingText = ''       // 累积的 delta 文本
  let activeTools = []       // 当前活跃的工具调用 [{ name, status, detail, input, output, error }]
  let unlisteners = []       // Tauri 事件监听取消函数

  function active() { return sessions.find(s => s.id === activeId) }

  function newSession() {
    const s = { id: genId(), title: '', messages: [], createdAt: Date.now() }
    sessions.unshift(s)
    activeId = s.id
    saveSessions(sessions)
  }

  if (!sessions.length) newSession()

  async function init() {
    try {
      const info = await api.checkHermes()
      gwOnline = !!info?.gatewayRunning
    } catch (_) {}
    // Load current model config
    try {
      const cfg = await api.hermesReadConfig()
      if (cfg?.model) currentModel = cfg.model
      if (cfg?.base_url && cfg?.api_key) {
        // Pre-fetch model list for quick switch
        try {
          const base = cfg.base_url.replace(/\/+$/, '').replace(/\/(chat\/completions|completions|responses|messages|models)\/?$/, '')
          const resp = await fetch(base + '/models', { headers: { 'Authorization': `Bearer ${cfg.api_key}` }, signal: AbortSignal.timeout(8000) })
          if (resp.ok) {
            const data = await resp.json()
            modelList = (data.data || []).map(m => m.id).filter(Boolean).sort()
          }
        } catch (_) {}
      }
    } catch (_) {}
    draw()
  }

  // --- 工具调用卡片渲染 ---
  function formatToolData(data) {
    if (!data) return ''
    if (typeof data === 'string') {
      // 尝试解析 JSON 以美化显示
      try { const obj = JSON.parse(data); return JSON.stringify(obj, null, 2) } catch { return data }
    }
    return JSON.stringify(data, null, 2)
  }

  function renderToolCard(t, collapsed = true) {
    const icon = toolIcon(t.name)
    const statusCls = t.status === 'complete' ? 'done' : t.status === 'error' ? 'err' : 'active'
    const statusText = t.status === 'complete' ? '✓ 完成' : t.status === 'error' ? '✗ 失败' : '⟳ 运行中'
    const detail = t.detail && t.detail !== '失败' && t.detail !== '完成' ? ` — ${escHtml(t.detail)}` : ''
    const inputStr = formatToolData(t.input)
    const outputStr = formatToolData(t.output)
    const errorStr = t.error ? (typeof t.error === 'string' ? t.error : JSON.stringify(t.error)) : ''
    // fallback: 用 raw 快照显示原始事件数据
    const rawStr = (!inputStr && !outputStr && !errorStr) ? formatToolData(t._raw || t._rawCompleted) : ''
    const hasDetails = inputStr || outputStr || errorStr || rawStr
    const cardId = 'tc-' + genId()
    let detailsHtml = ''
    if (hasDetails) {
      detailsHtml = `<div class="hm-tool-details" id="${cardId}-details" style="${collapsed ? 'display:none' : ''}">
        ${inputStr ? `<div class="hm-tool-section"><div class="hm-tool-section-label">输入</div><pre class="hm-tool-pre">${escHtml(inputStr)}</pre></div>` : ''}
        ${errorStr ? `<div class="hm-tool-section hm-tool-section-err"><div class="hm-tool-section-label">错误</div><pre class="hm-tool-pre">${escHtml(errorStr)}</pre></div>` : ''}
        ${outputStr ? `<div class="hm-tool-section"><div class="hm-tool-section-label">输出</div><pre class="hm-tool-pre">${escHtml(outputStr)}</pre></div>` : ''}
        ${rawStr ? `<div class="hm-tool-section"><div class="hm-tool-section-label">详情</div><pre class="hm-tool-pre">${escHtml(rawStr)}</pre></div>` : ''}
      </div>`
    }
    return `<div class="hm-tool-card ${statusCls}" data-tool-card="${cardId}">
      <div class="hm-tool-card-header">${icon} <span class="hm-tool-name">${escHtml(t.name)}</span><span class="hm-tool-status">${statusText}${detail}</span>${hasDetails ? `<span class="hm-tool-toggle">▶</span>` : ''}</div>
      ${detailsHtml}
    </div>`
  }

  // --- 增量更新流式区域（避免全量 draw 导致闪烁）---
  function updateStreamArea() {
    const msgsEl = el.querySelector('#hm-chat-msgs')
    if (!msgsEl) return
    let streamEl = msgsEl.querySelector('.hm-stream-area')
    if (!streaming) {
      if (streamEl) streamEl.remove()
      return
    }
    if (!streamEl) {
      streamEl = document.createElement('div')
      streamEl.className = 'hm-stream-area'
      msgsEl.appendChild(streamEl)
    }
    const toolsHtml = activeTools.map(t => renderToolCard(t, false)).join('')
    const textHtml = pendingText
      ? `<div class="hermes-chat-msg assistant"><div class="hermes-chat-bubble assistant">${mdToHtml(pendingText)}</div></div>`
      : (activeTools.length === 0 ? `<div class="hermes-chat-msg assistant"><div class="hermes-chat-bubble assistant"><span class="hermes-chat-typing">${t('engine.chatThinking')}</span></div></div>` : '')
    streamEl.innerHTML = toolsHtml + textHtml
    msgsEl.scrollTop = msgsEl.scrollHeight
  }

  // --- Draw ---
  function draw() {
    const cur = active()
    const msgs = cur?.messages || []
    el.innerHTML = `
      <div class="hm-chat-layout">
        <div class="hm-chat-sidebar">
          <div class="hm-chat-sidebar-header">
            <span>${t('engine.hermesChatTitle')}</span>
            <button class="hm-new-btn" title="${t('engine.chatNewSession')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
          <div class="hm-chat-session-list">
            ${sessions.map(s => `
              <div class="hm-session-item ${s.id === activeId ? 'active' : ''}" data-sid="${s.id}">
                <span class="hm-session-title">${escHtml(sessionTitle(s))}</span>
                <button class="hm-session-del" data-del="${s.id}" title="${t('common.delete')}">&times;</button>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="hm-chat-main">
          <div class="hm-chat-model-bar">
            <span class="hm-model-label">${t('engine.configModel')}:</span>
            <div style="position:relative;flex:1;max-width:240px">
              <input type="text" id="hm-chat-model" class="hm-model-input" value="${escHtml(currentModel)}" placeholder="QC-B01" readonly>
              ${showModelDropdown && modelList.length ? `<div id="hm-chat-model-dd" class="hm-model-dropdown">${modelList.map(m => `<div class="hm-chat-model-opt${m === currentModel ? ' active' : ''}" data-model="${escHtml(m)}">${escHtml(m)}</div>`).join('')}</div>` : ''}
            </div>
            <button class="hm-file-access-toggle ${fileAccessEnabled ? 'active' : ''}" id="hm-file-access-btn" title="${fileAccessEnabled ? t('engine.fileAccessOn') : t('engine.fileAccessOff')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
              <span>${t('engine.fileAccess')}</span>
            </button>
            <a href="#/h/dashboard" class="hm-model-link">${t('engine.dashModelConfig')} →</a>
          </div>
          <div class="hermes-chat-messages" id="hm-chat-msgs">
            ${msgs.length === 0 ? `<div class="hermes-chat-empty">${t('engine.chatEmptyHint')}</div>` : ''}
            ${msgs.map(m => renderMessage(m)).join('')}
          </div>
          <div class="hermes-chat-input-area">
            ${!gwOnline ? `<div class="hm-gw-offline">${t('engine.chatGatewayOffline')}</div>` : ''}
            <div style="position:relative">
              ${showSlash ? renderSlashMenu() : ''}
              <div class="hm-chat-input-wrap">
                <textarea id="hm-chat-input" rows="1" placeholder="${t('engine.chatPlaceholder')}" ${!gwOnline ? 'disabled' : ''}></textarea>
                <button class="btn btn-primary hm-chat-send" ${!gwOnline || streaming ? 'disabled' : ''}>${streaming ? '...' : t('engine.chatSend')}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `
    bind()
    if (streaming) updateStreamArea()
    scrollToBottom()
  }

  function renderMessage(m) {
    const isUser = m.role === 'user'
    // 工具摘要行（存储在 messages 中的已完成工具记录）
    if (m.role === 'tool-summary') {
      return `<div class="hm-tool-summary">${m.tools.map(t => renderToolCard(t, true)).join('')}</div>`
    }
    return `<div class="hermes-chat-msg ${isUser ? 'user' : 'assistant'}">
      <div class="hermes-chat-bubble ${isUser ? 'user' : 'assistant'}">${isUser ? escHtml(m.content) : mdToHtml(m.content)}</div>
    </div>`
  }

  function renderSlashMenu() {
    const cmds = SLASH_COMMANDS.filter(c => !slashFilter || c.cmd.includes(slashFilter))
    if (!cmds.length) return ''
    return `<div class="hm-slash-menu">${cmds.map(c =>
      `<div class="hm-slash-item" data-cmd="${c.cmd}"><span class="hm-slash-cmd">${c.cmd}</span><span class="hm-slash-desc">${c.desc}</span></div>`
    ).join('')}</div>`
  }

  function scrollToBottom() {
    const msgsEl = el.querySelector('#hm-chat-msgs')
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight
  }

  // 事件委托：工具卡片展开/折叠（对静态和动态流式卡片都生效）
  el.addEventListener('click', (e) => {
    const header = e.target.closest('.hm-tool-card-header')
    if (!header) return
    const card = header.closest('.hm-tool-card')
    const details = card?.querySelector('.hm-tool-details')
    const toggle = header.querySelector('.hm-tool-toggle')
    if (details) {
      const open = details.style.display !== 'none'
      details.style.display = open ? 'none' : 'block'
      if (toggle) toggle.textContent = open ? '▶' : '▼'
    }
  })

  function bind() {
    // Model quick-switch
    el.querySelector('#hm-chat-model')?.addEventListener('click', () => {
      if (modelList.length) { showModelDropdown = !showModelDropdown; draw() }
    })
    el.querySelectorAll('.hm-chat-model-opt').forEach(opt => {
      opt.addEventListener('click', async () => {
        const m = opt.dataset.model
        if (m && m !== currentModel) {
          try {
            await api.hermesUpdateModel(m)
            currentModel = m
          } catch (_) {}
        }
        showModelDropdown = false; draw()
      })
    })
    document.addEventListener('click', (e) => {
      if (showModelDropdown && !e.target.closest('#hm-chat-model') && !e.target.closest('#hm-chat-model-dd')) {
        showModelDropdown = false; draw()
      }
    })
    // File access toggle
    el.querySelector('#hm-file-access-btn')?.addEventListener('click', () => {
      fileAccessEnabled = !fileAccessEnabled
      localStorage.setItem(FILE_ACCESS_KEY, fileAccessEnabled ? 'true' : 'false')
      draw()
    })

    // Session sidebar
    el.querySelector('.hm-new-btn')?.addEventListener('click', () => { newSession(); draw() })
    el.querySelectorAll('.hm-session-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.hm-session-del')) return
        activeId = item.dataset.sid
        draw()
      })
    })
    el.querySelectorAll('.hm-session-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const sid = btn.dataset.del
        sessions = sessions.filter(s => s.id !== sid)
        if (activeId === sid) {
          if (!sessions.length) newSession()
          activeId = sessions[0].id
        }
        saveSessions(sessions)
        draw()
      })
    })

    // Slash menu clicks
    el.querySelectorAll('.hm-slash-item').forEach(item => {
      item.addEventListener('click', () => {
        const input = el.querySelector('#hm-chat-input')
        if (input) { input.value = item.dataset.cmd + ' '; input.focus() }
        showSlash = false
        draw()
      })
    })

    // Send
    el.querySelector('.hm-chat-send')?.addEventListener('click', sendMessage)
    const input = el.querySelector('#hm-chat-input')
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
        if (e.key === 'Escape') { showSlash = false; draw() }
      })
      input.addEventListener('input', () => {
        input.style.height = 'auto'
        input.style.height = Math.min(input.scrollHeight, 120) + 'px'
        const val = input.value
        if (val.startsWith('/') && !val.includes(' ')) {
          showSlash = true; slashFilter = val
          const parent = input.closest('.hermes-chat-input-area')?.querySelector('[style*="position:relative"]')
          if (parent) {
            const existing = parent.querySelector('.hm-slash-menu')
            if (existing) existing.remove()
            const cmds = SLASH_COMMANDS.filter(c => c.cmd.includes(val))
            if (cmds.length) {
              const div = document.createElement('div')
              div.className = 'hm-slash-menu'
              div.innerHTML = cmds.map(c =>
                `<div class="hm-slash-item" data-cmd="${c.cmd}"><span class="hm-slash-cmd">${c.cmd}</span><span class="hm-slash-desc">${c.desc}</span></div>`
              ).join('')
              div.querySelectorAll('.hm-slash-item').forEach(item => {
                item.addEventListener('click', () => {
                  input.value = item.dataset.cmd + ' '
                  input.focus()
                  showSlash = false
                  div.remove()
                })
              })
              parent.prepend(div)
            }
          }
        } else if (showSlash) {
          showSlash = false
          el.querySelector('.hm-slash-menu')?.remove()
        }
      })
      input.focus()
    }
  }

  // --- 清理事件监听 ---
  function cleanupListeners() {
    for (const fn of unlisteners) fn()
    unlisteners = []
  }

  // --- 设置 Tauri 事件监听 ---
  async function setupRunListeners() {
    cleanupListeners()
    const u1 = await tauriListen('hermes-run-delta', (e) => {
      pendingText += e.payload?.delta || ''
      updateStreamArea()
    })
    const u2 = await tauriListen('hermes-run-tool', (e) => {
      const evt = e.payload || {}
      const evtType = evt.event || ''
      const toolName = evt.tool || evt.tool_name || evt.name || 'tool'
      const preview = evt.preview || evt.detail || evt.message || ''
      // 提取 input/output 时兼容多种字段名
      const extractData = (obj, keys) => {
        for (const k of keys) {
          if (obj[k] != null && obj[k] !== '') return obj[k]
        }
        return null
      }
      // 构建去掉元字段后的 raw 快照，作为 fallback
      const rawSnapshot = (exclude) => {
        const copy = {}
        for (const [k, v] of Object.entries(evt)) {
          if (!exclude.includes(k) && v != null && v !== '') copy[k] = v
        }
        return Object.keys(copy).length ? copy : null
      }
      if (evtType === 'tool.started') {
        const inputData = extractData(evt, ['input', 'args', 'arguments', 'parameters', 'params', 'data'])
        activeTools.push({ name: toolName, status: 'active', detail: preview, input: inputData, output: null, error: null, _raw: rawSnapshot(['event', 'tool', 'tool_name', 'name']) })
      } else if (evtType === 'tool.completed') {
        const t = activeTools.find(t => t.name === toolName && t.status === 'active')
        if (t) {
          t.status = evt.error ? 'error' : 'complete'
          t.detail = evt.error ? '失败' : (evt.duration ? `${evt.duration}s` : '完成')
          t.output = extractData(evt, ['output', 'result', 'content', 'data', 'response'])
          if (evt.error) t.error = typeof evt.error === 'string' ? evt.error : JSON.stringify(evt.error)
          // 合并 started 时可能没有的 input
          if (!t.input) t.input = extractData(evt, ['input', 'args', 'arguments', 'parameters', 'params'])
          t._rawCompleted = rawSnapshot(['event', 'tool', 'tool_name', 'name', 'error', 'duration'])
        }
      } else if (evtType === 'tool.error') {
        const t = activeTools.find(t => t.name === toolName && t.status === 'active')
        if (t) {
          t.status = 'error'
          t.detail = preview || '失败'
          t.error = evt.error || preview || '未知错误'
        }
      } else if (evtType === 'tool.progress') {
        const t = activeTools.find(t => t.name === toolName && t.status === 'active')
        if (t && preview) t.detail = preview
      }
      updateStreamArea()
    })
    const u3 = await tauriListen('hermes-run-done', (e) => {
      const cur = active()
      if (!cur) return
      const output = e.payload?.output || pendingText || '(empty)'
      // 存储工具摘要（含输入输出详情）
      if (activeTools.length > 0) {
        cur.messages.push({ role: 'tool-summary', tools: activeTools.map(t => ({
          name: t.name, status: t.status, detail: t.detail,
          input: t.input, output: t.output, error: t.error,
          _raw: t._raw, _rawCompleted: t._rawCompleted
        })) })
      }
      cur.messages.push({ role: 'assistant', content: output })
      streaming = false
      pendingText = ''
      activeTools = []
      saveSessions(sessions)
      cleanupListeners()
      draw()
    })
    const u4 = await tauriListen('hermes-run-error', (e) => {
      const cur = active()
      if (!cur) return
      const err = e.payload?.error || 'unknown error'
      cur.messages.push({ role: 'assistant', content: `⚠️ Agent 运行失败: ${escHtml(err)}` })
      streaming = false
      pendingText = ''
      activeTools = []
      saveSessions(sessions)
      cleanupListeners()
      draw()
    })
    unlisteners.push(u1, u2, u3, u4)
  }

  async function sendMessage() {
    const input = el.querySelector('#hm-chat-input')
    const text = input?.value?.trim()
    if (!text || streaming) return

    const cur = active()
    if (!cur) return

    // 本地命令处理（不走 Gateway）
    if (text === '/clear') {
      cur.messages = []; cur.title = ''
      saveSessions(sessions)
      input.value = ''; draw(); return
    }
    if (text === '/new') {
      newSession(); input.value = ''; draw(); return
    }
    if (text === '/help') {
      cur.messages.push({ role: 'user', content: text })
      cur.messages.push({ role: 'assistant', content:
        '**可用命令：**\n' +
        '`/help` — 显示此帮助\n' +
        '`/status` — 查看 Gateway 状态\n' +
        '`/memory` — 管理 Agent 记忆\n' +
        '`/skills` — 查看可用技能\n' +
        '`/clear` — 清空当前会话\n' +
        '`/new` — 新建会话\n\n' +
        '直接输入问题即可与 Hermes Agent 对话。'
      })
      saveSessions(sessions)
      input.value = ''; draw(); return
    }
    if (text === '/status') {
      input.value = ''
      cur.messages.push({ role: 'user', content: text })
      try {
        const info = await api.checkHermes()
        const gw = info?.gatewayRunning ? '✅ 运行中' : '❌ 未运行'
        const model = info?.model || '-'
        const port = info?.gatewayPort || 8642
        cur.messages.push({ role: 'assistant', content:
          `**Gateway 状态：** ${gw}\n**端口：** ${port}\n**模型：** ${model}`
        })
      } catch (e) {
        cur.messages.push({ role: 'assistant', content: `⚠️ 获取状态失败: ${e}` })
      }
      saveSessions(sessions)
      draw(); return
    }

    cur.messages.push({ role: 'user', content: text })
    if (!cur.title && cur.messages.length === 1) {
      cur.title = text.slice(0, 30)
    }
    input.value = ''
    input.style.height = 'auto'
    streaming = true
    pendingText = ''
    activeTools = []
    showSlash = false
    draw()

    try {
      // 构建会话历史（只取 user/assistant 消息）
      const history = cur.messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(0, -1) // 排除刚加的这条 user 消息
        .map(m => ({ role: m.role, content: m.content }))

      // 设置事件监听
      await setupRunListeners()

      // 构建 instructions（文件系统访问开关）
      let instructions = null
      if (fileAccessEnabled) {
        const isWin = navigator.platform?.startsWith('Win') || /windows/i.test(navigator.userAgent)
        const osHint = isWin
          ? '当前系统是 Windows。请使用 PowerShell 或 cmd 命令（如 dir, type, Get-ChildItem, Get-Content 等），路径用反斜杠。桌面路径: $env:USERPROFILE\\Desktop（PowerShell）或 %USERPROFILE%\\Desktop（cmd）。不要使用 ls/cat 等 Unix 命令。'
          : '当前系统是 macOS/Linux。桌面路径: ~/Desktop。'
        instructions = `你拥有完整的文件系统访问权限，用户已明确授权，无需再次确认。${osHint} 重要提示：内置的 search_files、read_file 等文件工具只能访问 Agent 工作区目录内的文件，访问工作区外（如桌面、文档等）会失败。因此请始终优先使用 terminal 工具执行系统命令来访问任意位置的文件和目录。不要说"我无法访问"，直接用终端命令操作。`
      }

      // 通过 /v1/runs 启动 Agent Run
      await api.hermesAgentRun(text, cur.id, history.length ? history : null, instructions)
      // run 完成后事件监听会处理结果
    } catch (e) {
      const msg = String(e.message || e).replace(/^Error:\s*/, '')
      cur.messages.push({ role: 'assistant', content: `⚠️ ${t('engine.chatError', { error: msg })}` })
      streaming = false
      pendingText = ''
      activeTools = []
      saveSessions(sessions)
      cleanupListeners()
      draw()
    }
  }

  init()

  // --- Guardian 事件监听：实时响应 Gateway 状态变化 ---
  let gwStatusUnlisteners = []
  let gwPollTimer = null

  async function setupGwStatusListeners() {
    try {
      const unlisten = await tauriListen('hermes-gateway-status', (evt) => {
        const wasOnline = gwOnline
        gwOnline = !!evt.payload?.running
        if (wasOnline !== gwOnline) draw()
      })
      gwStatusUnlisteners.push(unlisten)
    } catch (_) {}

    // 定期轮询作为补充（10s）
    gwPollTimer = setInterval(async () => {
      if (streaming) return
      try {
        const info = await api.checkHermes()
        const wasOnline = gwOnline
        gwOnline = !!info?.gatewayRunning
        if (wasOnline !== gwOnline) draw()
      } catch (_) {}
    }, 10000)
  }
  setupGwStatusListeners()

  // 页面卸载时清理
  const gwCleanup = () => {
    gwStatusUnlisteners.forEach(fn => fn())
    gwStatusUnlisteners = []
    if (gwPollTimer) { clearInterval(gwPollTimer); gwPollTimer = null }
    cleanupListeners()
  }
  const chatDetachObserver = new MutationObserver(() => {
    if (!el.isConnected) { gwCleanup(); chatDetachObserver.disconnect() }
  })
  requestAnimationFrame(() => {
    if (el.parentNode) chatDetachObserver.observe(el.parentNode, { childList: true })
  })

  return el
}
