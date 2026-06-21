/**
 * 初始化进度管理模块
 *
 * 提供：
 * - InitStateMachine：初始化状态机（阶段转换、订阅通知）
 * - InitOverlay：前台加载覆盖层（进度条、阶段文本、错误面板）
 * - runInitPipeline：严格有序的 Gateway→WebSocket 初始化管线
 *
 * 状态转换（单向，仅 error 可回退到 retry）：
 *   idle → detecting → starting-gateway → waiting-gateway → connecting-ws → handshaking → ready
 *                                                                                       ↓
 *                                                                                     error
 */

import { detectOpenclawStatus, isOpenclawReady, isGatewayRunning, refreshGatewayStatus } from './app-state.js'
import { api, isTauriRuntime } from './tauri-api.js'
import { wsClient } from './ws-client.js'
import { t } from './i18n.js'

// ─── 阶段定义 ────────────────────────────────────────────────

export const STAGES = {
  IDLE:            { id: 'idle',            label: '',                   progress: 0 },
  DETECTING:       { id: 'detecting',       label: '检测 OpenClaw 状态',  progress: 10 },
  STARTING_GATEWAY:{ id: 'starting-gateway',label: '启动 Gateway 服务',   progress: 25 },
  WAITING_GATEWAY: { id: 'waiting-gateway', label: '等待 Gateway 就绪',   progress: 50 },
  CONNECTING_WS:   { id: 'connecting-ws',   label: '建立 WebSocket 连接', progress: 70 },
  HANDSHAKING:     { id: 'handshaking',     label: 'WebSocket 握手认证',  progress: 85 },
  READY:           { id: 'ready',           label: '初始化完成',          progress: 100 },
  ERROR:           { id: 'error',           label: '初始化失败',          progress: 0 },
}

const STAGE_MAP = {
  detecting:        STAGES.DETECTING,
  'starting-gateway': STAGES.STARTING_GATEWAY,
  'waiting-gateway':  STAGES.WAITING_GATEWAY,
  'connecting-ws':    STAGES.CONNECTING_WS,
  handshaking:      STAGES.HANDSHAKING,
  ready:            STAGES.READY,
  error:            STAGES.ERROR,
}

// ─── 超时常量 ────────────────────────────────────────────────

const GATEWAY_START_POLL_INTERVAL = 1500  // 1.5s 检测一次
const PORT_PROBE_INTERVAL         = 2000  // 2s 探测一次
const WS_HANDSHAKE_TIMEOUT        = 1000 * 60 * 5   // 单次 waitForReady 等待上限

// ─── 状态机 ──────────────────────────────────────────────────

export class InitStateMachine {
  constructor() {
    this._stage = STAGES.IDLE
    this._error = null
    this._subscribers = []
  }

  get stage() { return this._stage }
  get error() { return this._error }

  /** 推进到下一阶段（或 error） */
  transitionTo(stageId, payload = {}) {
    const def = STAGE_MAP[stageId]
    if (!def) {
      console.warn('[init-progress] 未知阶段:', stageId)
      return
    }
    this._stage = def
    if (stageId === 'error') {
      this._error = payload.error || payload.message || '未知错误'
      this._errorDetail = payload.detail || ''
      this._errorStage = payload.failedStage || ''
    } else {
      this._error = null
      this._errorDetail = ''
      this._errorStage = ''
    }
    this._notify(stageId, payload)
  }

  /** 重置状态机（用于重试） */
  reset() {
    this._stage = STAGES.IDLE
    this._error = null
    this._errorDetail = ''
    this._errorStage = ''
  }

  onStateChange(fn) {
    this._subscribers.push(fn)
    return () => { this._subscribers = this._subscribers.filter(cb => cb !== fn) }
  }

  _notify(stageId, payload) {
    this._subscribers.forEach(fn => {
      try { fn(this._stage, stageId, payload) } catch (e) { console.error('[init-progress] subscriber error:', e) }
    })
  }
}

// ─── 覆盖层 UI ──────────────────────────────────────────────

const _LOGOSVG = `<svg class="init-logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
  <path d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"/>
</svg>`

export class InitOverlay {
  constructor(stateMachine) {
    this._sm = stateMachine
    this._el = null
    this._closeResolve = null // 用于 close() 的可选 Promise
    this._isClosed = false
    this._isAborted = false   // 用户主动中止标志
    this._unsub = null
  }

  /** 创建并显示覆盖层 */
  create() {
    if (this._el) return
    const overlay = document.createElement('div')
    overlay.id = 'init-overlay'
    overlay.innerHTML = `
      <div class="init-card">
        <button class="init-close-btn" id="init-close-btn" title="关闭" aria-label="关闭初始化">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        ${_LOGOSVG}
        <div class="init-title">智能体</div>
        <div class="init-stage-text" id="init-stage-text">初始化中...</div>
        <div class="init-countdown" id="init-countdown" style="display:none">
          <div class="init-countdown-label" id="init-countdown-label"></div>
          <div class="init-countdown-value" id="init-countdown-value">00:00</div>
        </div>
        <div class="init-progress-bar">
          <div class="init-progress-inner" id="init-progress-inner" style="width:0%"></div>
        </div>
        <div class="init-status" id="init-status"></div>
        <div class="init-error" id="init-error" style="display:none">
          <div class="init-error-icon">⚠️</div>
          <div class="init-error-title" id="init-error-title"></div>
          <div class="init-error-detail" id="init-error-detail"></div>
          <div class="init-error-actions" id="init-error-actions"></div>
        </div>
      </div>
    `
    document.body.appendChild(overlay)
    this._el = overlay

    // 关闭按钮：中止执行 + 隐藏覆盖层
    const closeBtn = overlay.querySelector('#init-close-btn')
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.abort()
      })
    }

    // 订阅状态变化，自动同步 UI
    this._unsub = this._sm.onStateChange((stageDef, stageId, payload) => {
      if (stageId === 'ready') {
        this.close()
      } else if (stageId === 'error') {
        this._showError(payload)
      } else {
        this._updateProgress(stageDef)
        if (payload.message) {
          this._setStatus(payload.message)
        }
      }
    })
  }

  /** 更新进度条和阶段文本 */
  _updateProgress(stageDef) {
    if (!this._el) return
    const inner = this._el.querySelector('#init-progress-inner')
    const text = this._el.querySelector('#init-stage-text')
    if (inner) inner.style.width = stageDef.progress + '%'
    if (text) text.textContent = stageDef.label
  }

  /** 设置状态提示信息 */
  _setStatus(msg) {
    if (!this._el) return
    const el = this._el.querySelector('#init-status')
    if (el) el.textContent = msg
  }

  /**
   * 启动倒计时显示，每秒更新 DOM
   * @param {number} totalMs     倒计时总时长（毫秒）
   * @param {string} label       倒计时标签（如 "Gateway 启动倒计时"）
   */
  _startCountdown(totalMs, label) {
    this._stopCountdown()
    const wrap = this._el?.querySelector('#init-countdown')
    const labelEl = this._el?.querySelector('#init-countdown-label')
    const valueEl = this._el?.querySelector('#init-countdown-value')
    if (!wrap || !valueEl) return

    if (labelEl) labelEl.textContent = label
    // 移除内联 display 让 CSS 的 flex 生效
    wrap.style.display = ''

    const end = Date.now() + totalMs
    const tick = () => {
      const remain = Math.max(0, end - Date.now())
      const totalSec = Math.floor(remain / 1000)
      const mm = String(Math.floor(totalSec / 60)).padStart(2, '0')
      const ss = String(totalSec % 60).padStart(2, '0')
      valueEl.textContent = `${mm}:${ss}`
      if (remain <= 0) {
        this._stopCountdown()
      }
    }
    tick()
    this._countdownTimer = setInterval(tick, 1000)
  }

  /** 停止倒计时，隐藏显示 */
  _stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer)
      this._countdownTimer = null
    }
    const wrap = this._el?.querySelector('#init-countdown')
    if (wrap) wrap.style.display = 'none'
  }

  /** 显示错误面板 */
  _showError(payload) {
    if (!this._el) return
    const errorEl = this._el.querySelector('#init-error')
    const titleEl = this._el.querySelector('#init-error-title')
    const detailEl = this._el.querySelector('#init-error-detail')
    const actionsEl = this._el.querySelector('#init-error-actions')

    if (!errorEl) return

    errorEl.style.display = 'block'

    const failedStage = payload.failedStage || ''
    const errMsg = payload.error || payload.message || '未知错误'
    const errDetail = payload.detail || ''

    titleEl.textContent = failedStage
      ? `「${failedStage}」阶段失败`
      : '初始化失败'

    detailEl.textContent = typeof errMsg === 'string' ? errMsg : String(errMsg.message || errMsg)
    if (errDetail) {
      detailEl.textContent += '\n' + errDetail
    }

    // 操作按钮
    actionsEl.innerHTML = ''
    const retryBtn = document.createElement('button')
    retryBtn.className = 'btn btn-primary init-error-btn'
    retryBtn.textContent = '重试'
    retryBtn.addEventListener('click', () => {
      this._sm.reset()
      this._clearError()
      if (this._onRetry) this._onRetry()
    })
    actionsEl.appendChild(retryBtn)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'btn btn-secondary init-error-btn'
    closeBtn.textContent = '关闭'
    closeBtn.addEventListener('click', () => {
      this.close()
      if (this._onClose) this._onClose()
    })
    actionsEl.appendChild(closeBtn)
  }

  /** 清除错误面板 */
  _clearError() {
    if (!this._el) return
    const errorEl = this._el.querySelector('#init-error')
    if (errorEl) errorEl.style.display = 'none'
    const text = this._el.querySelector('#init-stage-text')
    if (text) text.textContent = '重新初始化中...'
    const inner = this._el.querySelector('#init-progress-inner')
    if (inner) inner.style.width = '0%'
    this._setStatus('')
  }

  /** 设置重试回调 */
  onRetry(fn) { this._onRetry = fn }

  /** 设置关闭回调 */
  onClose(fn) { this._onClose = fn }

  /** 标记中止状态（用户主动关闭），并隐藏覆盖层 */
  abort() {
    if (this._isAborted) return
    this._isAborted = true
    console.log('[init-progress] 用户主动中止初始化流程')
    this.close()
    if (this._onAbort) this._onAbort()
  }

  get isAborted() { return this._isAborted }

  /** 设置中止回调 */
  onAbort(fn) { this._onAbort = fn }

  /** 关闭并移除覆盖层 */
  close() {
    if (this._isClosed || !this._el) return
    this._isClosed = true
    if (this._unsub) { this._unsub(); this._unsub = null }
    this._el.classList.add('init-overlay-hide')
    setTimeout(() => {
      if (this._el && this._el.parentNode) {
        this._el.parentNode.removeChild(this._el)
      }
      this._el = null
      if (this._closeResolve) { this._closeResolve(); this._closeResolve = null }
    }, 400)
  }

  /** 返回一个 Promise，当覆盖层关闭时 resolve */
  waitClosed() {
    return new Promise(resolve => {
      this._closeResolve = resolve
    })
  }
}

// ─── 管线工具函数 ────────────────────────────────────────────

/** 轮询 Gateway 服务状态，直到 running=true（无限轮询直到成功或用户中止） */
async function pollGatewayRunning(overlay) {
  while (true) {
    if (overlay.isAborted) throw new Error('USER_ABORT')
    await refreshGatewayStatus()
    if (isGatewayRunning()) return true
    overlay._setStatus(`正在连接中...`)
    await new Promise(r => setTimeout(r, GATEWAY_START_POLL_INTERVAL))
  }
}

/** TCP 端口探测：确认 Gateway 端口可达（无限轮询直到成功或用户中止） */
async function probeGatewayPort(overlay) {
  while (true) {
    if (overlay.isAborted) throw new Error('USER_ABORT')
    try {
      const ok = await api.probeGatewayPort()
      if (ok) return true
    } catch {}
    overlay._setStatus(`正在连接中...`)
    await new Promise(r => setTimeout(r, PORT_PROBE_INTERVAL))
  }
}

// ─── 主初始化管线 ────────────────────────────────────────────

/**
 * 执行有序初始化管线：Gateway 启动验证 → WebSocket 连接
 *
 * @param {object} opts
 * @param {InitStateMachine} opts.stateMachine - 状态机实例
 * @param {InitOverlay} opts.overlay           - 覆盖层实例
 * @param {boolean} opts.skipIfRunning         - 如果 Gateway 已在运行，跳过启动阶段
 * @returns {Promise<{success: boolean, error?: Error}>}
 */
export async function runInitPipeline(opts = {}) {
  const sm = opts.stateMachine || new InitStateMachine()
  const overlay = opts.overlay || new InitOverlay(sm)
  const skipIfRunning = opts.skipIfRunning !== false

  try {
    // 0. 显示覆盖层
    if (!overlay._el) {
      overlay.create()
    }

    // ─── 阶段1：检测 OpenClaw 状态 ──────────────────────────
    sm.transitionTo('detecting')
    await detectOpenclawStatus()

    if (!isOpenclawReady()) {
      sm.transitionTo('error', {
        error: 'OpenClaw 未安装或未就绪，请先完成安装',
        message: 'OpenClaw 未安装或未就绪',
        failedStage: '环境检测',
      })
      return { success: false, error: new Error('OpenClaw 未就绪') }
    }

    // ─── 阶段2：如果需要，启动 Gateway ──────────────────────
    if (skipIfRunning && isGatewayRunning()) {
      // Gateway 已在运行，跳过启动和等待阶段
      sm.transitionTo('connecting-ws')
    } else {
      sm.transitionTo('starting-gateway')
      overlay._setStatus('正在连接中...')

      try {
        await api.startService('ai.openclaw.gateway')
      } catch (startErr) {
        const errMsg = startErr?.message || String(startErr)
        if (/foreign|already.*managed|not.*owned/i.test(errMsg)) {
          // 外部冲突（不可恢复）：显示错误面板
          sm.transitionTo('error', {
            error: 'Gateway 已被其他实例管理',
            detail: errMsg,
            failedStage: '启动 Gateway',
          })
          return { success: false, error: startErr }
        }
        // 其他启动错误（如命令超时）：服务可能在后台启动中，继续轮询等待就绪
        console.warn('[init-progress] startService 报错，继续轮询等待 Gateway 就绪:', errMsg)
      }

      // ─── 等待 Gateway 就绪（无限轮询直到成功）──────────────
      sm.transitionTo('waiting-gateway')
      await pollGatewayRunning(overlay)
      await probeGatewayPort(overlay)
      sm.transitionTo('connecting-ws')
    }

    // ─── 阶段4：设备配对 + 配置 + WebSocket 连接 ──────────
    overlay._setStatus('正在设备配对...')
    let needReload = false
    try {
      const pairResult = await api.autoPairDevice()
      if (typeof pairResult === 'object' && pairResult.changed) {
        needReload = true
      } else if (typeof pairResult === 'string' && pairResult !== '设备已配对') {
        needReload = true
      }
    } catch (pairErr) {
      console.warn('[init-progress] autoPairDevice 失败（非致命）:', pairErr)
    }

    overlay._setStatus('正在更新模型配置...')
    try {
      const patched = await api.patchModelVision()
      if (patched) needReload = true
    } catch (visionErr) {
      console.warn('[init-progress] patchModelVision 失败（非致命）:', visionErr)
    }

    if (needReload) {
      overlay._setStatus('正在重载 Gateway...')
      try {
        await api.reloadGateway()
      } catch (reloadErr) {
        console.warn('[init-progress] reloadGateway 失败:', reloadErr)
      }
    }

    // 读取 Gateway 配置
    overlay._setStatus('正在连接 WebSocket...')
    const config = await api.readOpenclawConfig()
    const port = config?.gateway?.port || 18789
    const rawToken = config?.gateway?.auth?.token
    const token = (typeof rawToken === 'string') ? rawToken : ''
    const rawPassword = config?.gateway?.auth?.password
    const password = (typeof rawPassword === 'string') ? rawPassword : ''

    let host
    if (isTauriRuntime()) {
      host = `127.0.0.1:${port}`
    } else {
      host = location.host
    }

    wsClient.connect(host, token, { password })

    // ─── 阶段5：等待 WebSocket 握手完成（循环检测直到成功）─────
    sm.transitionTo('handshaking')
    overlay._setStatus('正在连接中...')

    // 无限循环等待握手成功，依赖 wsClient 自动重连机制
    while (true) {
      if (overlay.isAborted) throw new Error('USER_ABORT')
      const handshakeResult = await wsClient.waitForReady(WS_HANDSHAKE_TIMEOUT)
      if (handshakeResult.ok) break
      console.warn('[init-progress] WebSocket 握手未就绪，继续等待:', handshakeResult.reason)
      overlay._setStatus('正在连接中...')
    }

    // ─── 阶段6：就绪 ──────────────────────────────────────────
    sm.transitionTo('ready')
    return { success: true }

  } catch (err) {
    // 用户主动中止：静默返回，不显示错误面板
    if (err?.message === 'USER_ABORT') {
      console.log('[init-progress] 初始化流程已被用户中止')
      return { success: false, error: err, aborted: true }
    }
    const errMsg = err?.message || String(err)
    // 确定失败阶段
    const currentStage = sm.stage
    const stageLabel = currentStage && currentStage !== STAGES.ERROR ? currentStage.label : ''
    // 显示错误面板 + 重试按钮
    sm.transitionTo('error', {
      error: errMsg,
      message: errMsg,
      failedStage: stageLabel,
    })
    return { success: false, error: err }
  }
}
