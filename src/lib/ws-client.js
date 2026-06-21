/**
 * WebSocket 客户端 - 直连 OpenClaw Gateway
 *
 * 协议流程（直连模式）：
 * 1. 连接 ws://host/ws?token=xxx
 * 2. Gateway 发 connect.challenge（带 nonce）
 * 3. 客户端调用 Tauri 后端生成 Ed25519 签名的 connect frame
 * 4. Gateway 返回 connect 响应（带 snapshot）
 * 5. 从 snapshot.sessionDefaults.mainSessionKey 获取 sessionKey
 * 6. 开始正常通信
 */
import { api } from './tauri-api.js'

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ── 超时常量 ──
const REQUEST_TIMEOUT = 1000*60*30
const MAX_RECONNECT_DELAY = 60000
const PING_INTERVAL = 30000
// Gateway 握手等待（等 challenge + frame 往返）
const CHALLENGE_TIMEOUT = 1000*60*5
// connect frame 生成 + 发送最长允许时间
const FRAME_SEND_TIMEOUT = 1000*60*1
const MAX_RECONNECT_ATTEMPTS = 2
// 心跳：每 20s 检查一次；超过 80s 无消息计 1 次超时，连续 4 次触发重连
const HEARTBEAT_CHECK_INTERVAL = 20000
const HEARTBEAT_TIMEOUT = 1000*60*20
// 握手阶段无消息超时（TCP 连通但 Gateway 无响应）
const HANDSHAKE_WATCHDOG_TIMEOUT = 1000*60*20
const MESSAGE_CACHE_SIZE = 100
// Gateway 启动前的初始重连延迟
const INITIAL_RECONNECT_DELAY =  30000
// request() 等待重连就绪的最大时间
const RECONNECT_WAIT_TIMEOUT = 1000*60*10

export class WsClient {
  constructor() {
    this._ws = null
    this._url = ''
    this._token = ''
    this._pending = new Map()
    this._eventListeners = []
    this._statusListeners = []
    this._readyCallbacks = []
    this._reconnectAttempts = 0
    this._reconnectTimer = null
    this._connected = false
    this._gatewayReady = false
    this._handshaking = false
    this._connecting = false
    this._intentionalClose = false
    this._snapshot = null
    this._hello = null
    this._sessionKey = null
    this._pingTimer = null
    this._challengeTimer = null
    this._handshakeWatchdog = null
    this._wsId = 0
    this._autoPairAttempts = 0
    this._authRetryCount = 0
    this._password = ''
    this._serverVersion = null

    // 增强状态追踪
    this._lastConnectedAt = null
    this._lastMessageAt = null
    this._pendingReconnect = false
    this._missedHeartbeats = 0
    this._heartbeatTimer = null
    this._reconnectState = 'idle' // idle | attempting | scheduled
    this._connectionRefused = false // 标记是否为连接被拒（Gateway 未启动）

    // 请求去重：防止同一请求在 pending 时重复发送
    this._pendingRequests = new Map()

    // 消息缓存
    this._messageCache = new Map()
    this._cacheSize = MESSAGE_CACHE_SIZE
    this._seenMessageIds = []

    // 会话列表缓存（用于 loadHistory/sessionsList 超时时的降级）
    this._sessionsCache = null
    this._sessionsCacheTime = 0
    const SESSIONS_CACHE_TTL = 5 * 60 * 1000 // 5 分钟有效
  }

  get connected() { return this._connected }
  get connecting() { return this._connecting }
  get gatewayReady() { return this._gatewayReady }
  get snapshot() { return this._snapshot }
  get hello() { return this._hello }
  get sessionKey() { return this._sessionKey }
  get serverVersion() { return this._serverVersion }
  get reconnectState() { return this._reconnectState }
  get reconnectAttempts() { return this._reconnectAttempts }
  get lastConnectedAt() { return this._lastConnectedAt }
  get lastMessageAt() { return this._lastMessageAt }

  getConnectionInfo() {
    return {
      connected: this._connected,
      gatewayReady: this._gatewayReady,
      lastConnectedAt: this._lastConnectedAt,
      lastMessageAt: this._lastMessageAt,
      reconnectAttempts: this._reconnectAttempts,
      reconnectState: this._reconnectState,
      serverVersion: this._serverVersion,
      missedHeartbeats: this._missedHeartbeats,
      pendingReconnect: this._pendingReconnect,
    }
  }

  onStatusChange(fn) {
    this._statusListeners.push(fn)
    return () => { this._statusListeners = this._statusListeners.filter(cb => cb !== fn) }
  }

  onReady(fn) {
    this._readyCallbacks.push(fn)
    return () => { this._readyCallbacks = this._readyCallbacks.filter(cb => cb !== fn) }
  }

  /**
   * 等待 Gateway 就绪，适用于主动 reconnect() 后需要确认连接成功的场景。
   * 已就绪则立即返回 { ok: true, reason: 'already_ready' }。
   * @param {number} timeoutMs
   * @returns {Promise<{ok: boolean, reason: string}>}
   */
  waitForReady(timeoutMs = 40000) {
    if (this._gatewayReady && this._connected) {
      return Promise.resolve({ ok: true, reason: 'already_ready' })
    }
    return new Promise((resolve) => {
      let settled = false
      const settle = (ok, reason) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubReady()
        unsubStatus()
        resolve({ ok, reason })
      }

      const timer = setTimeout(() => settle(false, 'timeout'), timeoutMs)

      const unsubReady = this.onReady((hello, sessionKey, err) => {
        if (err?.error) settle(false, err.message || 'handshake_error')
        else settle(true, 'ready')
      })

      const unsubStatus = this.onStatusChange((status, errorMsg) => {
        if (settled) return
        if (status === 'error' || status === 'auth_failed') {
          settle(false, errorMsg || status)
        }
      })
    })
  }

  connect(host, token, opts = {}) {
    this._intentionalClose = false
    this._autoPairAttempts = 0
    this._token = token || ''
    this._password = opts.password || ''
    const proto = opts.secure ?? (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss' : 'ws'
    const nextUrl = `${proto}://${host}/ws?token=${encodeURIComponent(this._token)}`
    if (this._connecting || this._handshaking || this._gatewayReady) {
      if (this._url === nextUrl) return
    }
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) return
    this._url = nextUrl
    this._doConnect()
  }

  disconnect() {
    this._intentionalClose = true
    this._stopPing()
    this._stopHeartbeat()
    this._clearReconnectTimer()
    this._clearChallengeTimer()
    this._clearHandshakeWatchdog()
    this._flushPending('intentional')
    this._closeWs()
    this._setConnected(false)
    this._gatewayReady = false
    this._handshaking = false
    this._reconnectState = 'idle'
    this._pendingReconnect = false
  }

  reconnect() {
    if (!this._url) return
    this._intentionalClose = false
    this._reconnectAttempts = 0
    this._autoPairAttempts = 0
    this._authRetryCount = 0
    this._missedHeartbeats = 0
    this._connectionRefused = false
    this._stopPing()
    this._stopHeartbeat()
    this._clearReconnectTimer()
    this._clearChallengeTimer()
    this._clearHandshakeWatchdog()
    this._flushPending('reconnect')
    this._closeWs()
    this._doConnect()
  }

  _doConnect() {
    this._connecting = true
    this._closeWs()
    this._gatewayReady = false
    this._handshaking = false
    this._reconnectState = 'attempting'
    this._setConnected(false, 'connecting')
    const wsId = ++this._wsId
    let ws
    try { ws = new WebSocket(this._url) } catch { this._scheduleReconnect(); return }
    this._ws = ws

    // 握手阶段看门狗：TCP 连通后若长时间无任何消息（Gateway 无响应），触发重连
    this._clearHandshakeWatchdog()
    this._handshakeWatchdog = setTimeout(() => {
      if (wsId !== this._wsId) return
      if (!this._gatewayReady) {
        console.warn('[ws] 握手阶段超时（无消息），强制重连')
       /*  this._closeWs()
        this._scheduleReconnect() */

        this._closeWs()
        this._scheduleReconnect()
      }
    }, HANDSHAKE_WATCHDOG_TIMEOUT + CHALLENGE_TIMEOUT + FRAME_SEND_TIMEOUT)

    ws.onopen = () => {
      if (wsId !== this._wsId) return
      this._connecting = false
      this._reconnectAttempts = 0
      this._missedHeartbeats = 0
      this._connectionRefused = false
      this._lastConnectedAt = Date.now()
      this._lastMessageAt = Date.now()
      this._startHeartbeat()
      this._startPing()
      // 等 Gateway 发 connect.challenge，超时则主动发
      this._challengeTimer = setTimeout(() => {
        if (!this._handshaking && !this._gatewayReady) {
          console.log('[ws] 未收到 challenge，主动发 connect')
          this._sendConnectFrame('')
        }
      }, CHALLENGE_TIMEOUT)
    }

    ws.onmessage = (evt) => {
      if (wsId !== this._wsId) return
      // 收到任何消息都重置看门狗计时
      this._clearHandshakeWatchdog()
      let msg
      try { msg = JSON.parse(evt.data) } catch { return }
      this._handleMessage(msg)
    }

    ws.onclose = (e) => {
      if (wsId !== this._wsId) return
      this._ws = null
      this._connecting = false
      this._clearChallengeTimer()
      this._clearHandshakeWatchdog()
      const reason = (e.reason || '').toLowerCase()

      if (e.code === 4001) {
        console.log('[ws] Gateway 配置变更，3秒后自动重连:', e.reason)
        this._setConnected(false, 'reconnecting', 'Gateway 配置已更新，自动重连中...')
        this._gatewayReady = false
        this._handshaking = false
        this._stopPing()
        setTimeout(() => {
          if (!this._intentionalClose) {
            this._reconnectAttempts = 0
            this._doConnect()
          }
        }, 3000)
        return
      }

      if (e.code === 1008 && !this._intentionalClose) {
        if (/origin not allowed/i.test(reason)) {
          if (this._autoPairAttempts < 1) {
            console.log('[ws] origin not allowed，尝试自动修复...')
            this._setConnected(false, 'reconnecting', 'origin 修复中...')
            this._autoPairAndReconnect()
            return
          }
          this._setConnected(false, 'error', 'origin not allowed，请检查 gateway.controlUi.allowedOrigins 配置')
          return
        }
        if (/unauthorized/i.test(reason)) {
          if (this._authRetryCount < 2) {
            this._authRetryCount++
            console.log(`[ws] 认证失败，刷新凭据 (${this._authRetryCount}/2):`, e.reason)
            this._setConnected(false, 'reconnecting', `认证失败，刷新凭据中 (${this._authRetryCount}/2)...`)
            this._refreshCredentialsAndReconnect()
            return
          }
          this._setConnected(false, 'auth_failed', `认证失败: ${e.reason || 'token mismatch'}。请检查 Gateway Token 配置。`)
          this._intentionalClose = true
          this._flushPending('auth_failed')
          return
        }
        if (/pairing required/i.test(reason) || /not.paired/i.test(reason)) {
          if (this._autoPairAttempts < 1) {
            console.log('[ws] 设备未配对，尝试自动配对...')
            this._setConnected(false, 'reconnecting', '设备配对中...')
            this._autoPairAndReconnect()
            return
          }
          this._setConnected(false, 'error', '设备配对失败，请手动执行 openclaw pairing approve')
          return
        }
        if (/device identity required/i.test(reason) || /device auth/i.test(reason)) {
          if (this._autoPairAttempts < 1) {
            console.log('[ws] 设备认证问题，尝试重新配对:', e.reason)
            this._setConnected(false, 'reconnecting', '设备认证修复中...')
            this._autoPairAndReconnect()
            return
          }
          this._setConnected(false, 'error', `设备认证失败: ${e.reason}`)
          return
        }
        if (/rate.?limit/i.test(reason)) {
          console.log('[ws] 被限流，30秒后重试')
          this._setConnected(false, 'reconnecting', '请求过于频繁，30秒后重试...')
          setTimeout(() => {
            if (!this._intentionalClose) this._doConnect()
          }, 30000)
          return
        }
        console.warn('[ws] 收到 1008 关闭:', e.reason)
        this._setConnected(false, 'error', e.reason || '连接被 Gateway 拒绝')
        return
      }

      this._setConnected(false)
      this._gatewayReady = false
      this._handshaking = false
      this._stopPing()
      this._flushPending('disconnected')
      if (!this._intentionalClose) this._scheduleReconnect()
    }

    ws.onerror = (evt) => {
      // 区分连接被拒（服务未启动）vs 其他网络错误
      // Browser doesn't expose the OS-level error code directly, so we check
      // if onopen hasn't fired after a short delay — that strongly suggests ECONNREFUSED.
      // The actual differentiation happens in onclose via evt.wasClean / evt.code.
      const target = evt.target
      if (target && target.CONNECTING) {
        // 未达到 OPEN 状态就被关闭，说明是连接建立失败（ECONNREFUSED 或网络问题）
        this._connectionRefused = true
      }
      console.error('[ws] WebSocket 错误:', evt)
    }
  }

  _handleMessage(msg) {
    this._lastMessageAt = Date.now()
    this._missedHeartbeats = 0

    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      console.log('[ws] 收到 connect.challenge')
      this._clearChallengeTimer()
      const nonce = msg.payload?.nonce || ''
      this._sendConnectFrame(nonce)
      return
    }

    if (msg.type === 'res' && msg.id?.startsWith('connect-')) {
      this._clearChallengeTimer()
      this._handshaking = false
      if (!msg.ok || msg.error) {
        const errMsg = msg.error?.message || 'Gateway 握手失败'
        const errCode = msg.error?.code
        const details = msg.error?.details || {}
        const detailCode = details.code || ''
        const nextStep = details.recommendedNextStep || ''
        console.error('[ws] connect 失败:', { errCode, detailCode, nextStep, errMsg })

        let handled = false
        switch (detailCode) {
          case 'PAIRING_REQUIRED':
          case 'CONTROL_UI_ORIGIN_NOT_ALLOWED':
            if (this._autoPairAttempts < 1) {
              console.log('[ws] 自动修复:', detailCode)
              this._autoPairAndReconnect()
              return
            }
            break
          case 'AUTH_TOKEN_MISMATCH':
          case 'AUTH_TOKEN_MISSING':
          case 'AUTH_TOKEN_NOT_CONFIGURED':
          case 'AUTH_PASSWORD_MISMATCH':
          case 'AUTH_PASSWORD_MISSING':
          case 'AUTH_PASSWORD_NOT_CONFIGURED':
          case 'AUTH_DEVICE_TOKEN_MISMATCH':
            if (this._authRetryCount < 2) {
              this._authRetryCount++
              console.log(`[ws] 认证失败 (${detailCode})，刷新凭据 (${this._authRetryCount}/2)`)
              this._refreshCredentialsAndReconnect()
              return
            }
            handled = true
            break
          case 'AUTH_RATE_LIMITED': {
            const retryMs = msg.error?.retryAfterMs || 30000
            console.log(`[ws] 被限流，${Math.round(retryMs / 1000)}秒后重试`)
            this._setConnected(false, 'reconnecting', `请求过于频繁，${Math.round(retryMs / 1000)}秒后重试...`)
            setTimeout(() => { if (!this._intentionalClose) this._doConnect() }, retryMs)
            return
          }
          case 'DEVICE_IDENTITY_REQUIRED':
          case 'CONTROL_UI_DEVICE_IDENTITY_REQUIRED':
          case 'DEVICE_AUTH_SIGNATURE_INVALID':
          case 'DEVICE_AUTH_NONCE_MISMATCH':
          case 'DEVICE_AUTH_NONCE_REQUIRED':
          case 'DEVICE_AUTH_PUBLIC_KEY_INVALID':
          case 'DEVICE_AUTH_INVALID':
            if (this._autoPairAttempts < 1) {
              console.log('[ws] 设备认证问题:', detailCode)
              this._autoPairAndReconnect()
              return
            }
            break
          default:
            if (errCode === 'NOT_PAIRED' || /origin not allowed/i.test(errMsg)) {
              if (this._autoPairAttempts < 1) {
                console.log('[ws] 检测到配对/origin 错误，尝试自动修复...', errCode || errMsg)
                this._autoPairAndReconnect()
                return
              }
            }
            if (/unauthorized/i.test(errMsg) && this._authRetryCount < 2) {
              this._authRetryCount++
              this._refreshCredentialsAndReconnect()
              return
            }
        }

        const hints = {
          'retry_with_device_token': '设备令牌需要更新，请重启面板',
          'update_auth_configuration': '请检查 Gateway 认证配置',
          'update_auth_credentials': '请检查 Gateway Token 是否正确',
          'wait_then_retry': '请稍后重试',
          'review_auth_configuration': '请检查 Gateway 安全配置',
        }
        const hint = hints[nextStep] || ''
        const displayMsg = hint ? `${errMsg}（${hint}）` : errMsg
        this._setConnected(false, 'error', displayMsg)
        this._readyCallbacks.forEach(fn => {
          try { fn(null, null, { error: true, message: displayMsg, detailCode, nextStep }) } catch {}
        })
        return
      }
      this._handleConnectSuccess(msg.payload)
      return
    }

    if (msg.type === 'res') {
      const cb = this._pending.get(msg.id)
      if (cb) {
        this._pending.delete(msg.id)
        if (cb.dedupKey) this._pendingRequests.delete(cb.dedupKey)
        clearTimeout(cb.timer)
        if (msg.ok) cb.resolve(msg.payload)
        else cb.reject(new Error(msg.error?.message || msg.error?.code || 'request failed'))
      }
      return
    }

    if (msg.type === 'event') {
      if (msg.id) {
        if (this._seenMessageIds.includes(msg.id)) {
          console.log('[ws] 跳过重复消息:', msg.id)
          return
        }
        this._seenMessageIds.push(msg.id)
        if (this._seenMessageIds.length > 1000) {
          this._seenMessageIds = this._seenMessageIds.slice(-500)
        }
      }

      if (msg.event === 'chat.message' && msg.payload?.sessionKey) {
        this._cacheMessage(msg.payload.sessionKey, msg.payload)
      }

      this._eventListeners.forEach(fn => {
        try { fn(msg) } catch (e) { console.error('[ws] handler error:', e) }
      })
    }
  }

  async _autoPairAndReconnect() {
    this._autoPairAttempts++
    try {
      console.log('[ws] 执行自动配对（第', this._autoPairAttempts, '次）...')
      const result = await api.autoPairDevice()
      console.log('[ws] 配对结果:', result)
      try {
        await api.reloadGateway()
        console.log('[ws] Gateway 已重载')
      } catch (e) {
        console.warn('[ws] reloadGateway 失败（非致命）:', e)
      }
      console.log('[ws] 配对成功，3秒后重新连接...')
      setTimeout(() => {
        if (!this._intentionalClose) {
          this._reconnectAttempts = 0
          this._closeWs()
          this._doConnect()
        }
      }, 3000)
    } catch (e) {
      console.error('[ws] 自动配对失败:', e)
      this._setConnected(false, 'error', `配对失败: ${e}`)
    }
  } 

  async _refreshCredentialsAndReconnect() {
    try {
      const config = await api.readOpenclawConfig()
      const newToken = config?.gateway?.auth?.token || ''
      const newPassword = config?.gateway?.auth?.password || ''
      if ((newToken && newToken !== this._token) || (newPassword && newPassword !== this._password)) {
        console.log('[ws] 检测到凭据变更，使用新凭据重连')
        this._token = newToken
        this._password = newPassword
        const base = this._url.split('?')[0]
        this._url = `${base}?token=${encodeURIComponent(this._token)}`
      }
      try { await api.autoPairDevice() } catch {}
      setTimeout(() => {
        if (!this._intentionalClose) this._doConnect()
      }, 3000)
    } catch (e) {
      console.error('[ws] 刷新凭据失败:', e)
      this._setConnected(false, 'error', `凭据刷新失败: ${e}`)
    }
  }

  async _sendConnectFrame(nonce) {
    this._handshaking = true
    // 生成 frame 有超时兜底：若 Tauri API 卡住，不让握手永久挂死
    const frameTimeout = setTimeout(() => {
      if (this._handshaking) {
        console.error('[ws] connect frame 生成超时，触发重连')
        this._handshaking = false
     /*    this._closeWs()
        this._scheduleReconnect() */
       this._closeWs()
        this._scheduleReconnect() 

      }
    }, FRAME_SEND_TIMEOUT)
    try {
      const frame = await api.createConnectFrame(nonce, this._token, this._password)
      clearTimeout(frameTimeout)
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        console.log('[ws] 发送 connect frame')
        this._ws.send(JSON.stringify(frame))
      } else {
        // ws 在生成期间已关闭
        this._handshaking = false
      }
    } catch (e) {
      clearTimeout(frameTimeout)
      console.error('[ws] 生成 connect frame 失败:', e)
      this._handshaking = false
      // frame 生成失败属于本地错误，直接重连
      this._closeWs()
      this._scheduleReconnect()
    }
  }

  _handleConnectSuccess(payload) {
    this._autoPairAttempts = 0
    this._authRetryCount = 0
    this._hello = payload || null
    this._snapshot = payload?.snapshot || null
    this._serverVersion = payload?.serverVersion || null
    const defaults = this._snapshot?.sessionDefaults
    if (defaults?.mainSessionKey) {
      this._sessionKey = defaults.mainSessionKey
    } else {
      const agentId = defaults?.defaultAgentId || 'main'
      this._sessionKey = `agent:${agentId}:main`
    }
    this._gatewayReady = true
    this._reconnectState = 'idle'
    this._pendingReconnect = false
    console.log('[ws] Gateway 就绪, sessionKey:', this._sessionKey)
    this._setConnected(true, 'ready')
    this._readyCallbacks.forEach(fn => {
      try { fn(this._hello, this._sessionKey) } catch (e) {
        console.error('[ws] ready cb error:', e)
      }
    })
  }

  _setConnected(val, status, errorMsg) {
    this._connected = val
    const s = status || (val ? 'connected' : 'disconnected')
    this._statusListeners.forEach(fn => {
      try { fn(s, errorMsg) } catch (e) { console.error('[ws] status listener error:', e) }
    })
  }

  _closeWs() {
    if (this._ws) {
      const old = this._ws
      this._ws = null
      this._wsId++
      try { old.close() } catch {}
    }
  }

  /**
   * 拒绝所有挂起请求
   * @param {'intentional'|'reconnect'|'disconnected'|'auth_failed'} reason
   */
  _flushPending(reason = 'disconnected') {
    const msgMap = {
      intentional: '连接已主动断开',
      reconnect: '重新连接中',
      disconnected: '连接已断开',
      auth_failed: '认证失败，连接已断开',
    }
    const msg = msgMap[reason] || '连接已断开'
    for (const [, cb] of this._pending) {
      clearTimeout(cb.timer)
      cb.reject(new Error(msg))
    }
    this._pendingRequests.clear() // 清理去重映射
    this._pending.clear()
  }

  _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  }

  _clearChallengeTimer() {
    if (this._challengeTimer) {
      clearTimeout(this._challengeTimer)
      this._challengeTimer = null
    }
  }

  _clearHandshakeWatchdog() {
    if (this._handshakeWatchdog) {
      clearTimeout(this._handshakeWatchdog)
      this._handshakeWatchdog = null
    }
  }

  _scheduleReconnect() {
    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[ws] 已达到最大重连次数 (', MAX_RECONNECT_ATTEMPTS, ')，停止自动重连')
      this._reconnectState = 'idle'
      this._pendingReconnect = false
      const msg = this._connectionRefused
        ? 'Gateway 未启动，请前往「服务管理」页面启动 OpenClaw 服务。启动后页面将自动连接。'
        : `连接失败，已停止重连。请手动刷新页面重试。`
      this._setConnected(false, 'error', msg)
      return
    }

    this._clearReconnectTimer()
    // 指数退避：首次固定 10s，后续 2^n 秒，±20% 抖动，最大 60s
    // 连接被拒时使用更短的间隔（服务可能在快速启动）
    const baseDelay = this._reconnectAttempts === 0
      ? INITIAL_RECONNECT_DELAY
      : Math.min(
          Math.round(
            Math.pow(2, this._reconnectAttempts) * 1000
            * (this._connectionRefused ? 0.5 : 1.0) // 连接被拒时退避减半
            * (0.8 + Math.random() * 0.4)
          ),
          MAX_RECONNECT_DELAY
        )
    const delay = Math.max(baseDelay, this._connectionRefused ? 3000 : 1000) // 连接被拒最少 3s

    this._reconnectAttempts++
    this._reconnectState = 'scheduled'
    this._pendingReconnect = true
    const statusMsg = this._connectionRefused
      ? `Gateway 未启动，重试中 (${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})，${Math.round(delay/1000)}秒后...`
      : `重连中 (${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})，${Math.round(delay/1000)}秒后...`
    this._setConnected(false, 'reconnecting', statusMsg)
    console.log(`[ws] 计划重连 (${this._reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})，延迟 ${Math.round(delay/1000)}秒${this._connectionRefused ? ' [连接被拒]' : ''}`)
    this._reconnectTimer = setTimeout(() => {
      if (!this._intentionalClose) {
        this._reconnectState = 'attempting'
        this._doConnect()
      }
    }, delay)
  }

  _startPing() {
    this._stopPing()
    this._pingTimer = setInterval(() => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        try { this._ws.send('{"type":"ping"}') } catch {}
      }
    }, PING_INTERVAL)
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer)
      this._pingTimer = null
    }
  }

  /**
   * 心跳检测：每 20s 检查一次；超过 80s 无消息计 1 次超时，连续 4 次强制重连。
   * 注意：握手阶段（!_gatewayReady）由 handshakeWatchdog 负责，此处只在就绪后生效。
   */
  _startHeartbeat() {
    this._stopHeartbeat()
    this._missedHeartbeats = 0
    this._heartbeatTimer = setInterval(() => {
      // 仅在 Gateway 就绪后才做心跳检查（握手阶段由 watchdog 负责）
      if (!this._gatewayReady) return

      const now = Date.now()
      const timeSinceLastMessage = this._lastMessageAt ? now - this._lastMessageAt : 0

       if (timeSinceLastMessage > HEARTBEAT_TIMEOUT) {
        this._missedHeartbeats++
        console.warn(`[ws] 心跳超时 (${Math.round(timeSinceLastMessage/1000)}秒无消息)，连续超时次数: ${this._missedHeartbeats}`)

        if (this._missedHeartbeats >= 4) {
          console.error('[ws] 心跳检测连续超时 4 次，强制重连')
          this._stopHeartbeat()
           this.reconnect() 
        } else {
          console.warn(`[ws] 心跳超时 ${this._missedHeartbeats} 次，发送探测 ping...`)
          if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            try { this._ws.send('{"type":"ping"}') } catch {}
          }
        }
      } 

   /* console.warn(`[ws] 心跳超时 ${this._missedHeartbeats} 次，发送探测 ping...`)
          if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            try { this._ws.send('{"type":"ping"}') } catch {}
          } */

    }, HEARTBEAT_CHECK_INTERVAL)
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }
  }

  request(method, params = {}, opts = {}) {
    const timeout = opts.timeout ?? REQUEST_TIMEOUT
    const retries = opts.retries ?? 0
    const retryDelay = opts.retryDelay ?? 2000
    return this._requestWithRetry(method, params, { timeout, retries, retryDelay, attempt: 0 })
  }

  async _requestWithRetry(method, params, opts) {
    const { timeout, retries, retryDelay, attempt } = opts
    try {
      return await this._requestOnce(method, params, timeout)
    } catch (err) {
      const isTimeout = err.message === '请求超时'
      if (isTimeout && attempt < retries) {
        console.log(`[ws] ${method} 超时 (${attempt + 1}/${retries + 1})，${retryDelay}ms 后重试...`)
        await new Promise(r => setTimeout(r, retryDelay))
        return this._requestWithRetry(method, params, { ...opts, attempt: attempt + 1 })
      }
      throw err
    }
  }

  _requestOnce(method, params, timeout) {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN || !this._gatewayReady) {
        if (!this._intentionalClose && (this._reconnectAttempts > 0 || this._pendingReconnect || !this._gatewayReady)) {
          const waitTimeout = setTimeout(() => { unsub(); reject(new Error('等待重连超时')) }, RECONNECT_WAIT_TIMEOUT)
          const unsub = this.onReady((hello, sessionKey, err) => {
            clearTimeout(waitTimeout); unsub()
            if (err?.error) { reject(new Error(err.message || 'Gateway 握手失败')); return }
            this.request(method, params).then(resolve, reject)
          })
          return
        }
        return reject(new Error('WebSocket 未连接'))
      }
      // 请求去重：相同 method+params 的请求在 pending 时返回已有的 Promise
      const dedupKey = `${method}:${JSON.stringify(params)}`
      if (this._pendingRequests.has(dedupKey)) {
        console.log('[ws] 跳过重复请求:', method, params)
        this._pendingRequests.get(dedupKey).then(resolve).catch(reject)
        return
      }
      const id = uuid()
      const timer = setTimeout(() => {
        this._pending.delete(id)
        this._pendingRequests.delete(dedupKey)
        reject(new Error('请求reques超时'))
      }, timeout)
      const promise = new Promise((res, rej) => {
        this._pending.set(id, { resolve: res, reject: rej, timer, dedupKey })
      })
      promise.then(resolve, reject)
      this._pendingRequests.set(dedupKey, promise)
      this._ws.send(JSON.stringify({ type: 'req', id, method, params }))
    })
  }

  chatSend(sessionKey, message, attachments) {
    const params = { sessionKey, message, deliver: false, idempotencyKey: uuid() }
    if (attachments && attachments.length > 0) {
      params.attachments = attachments
      console.log('[ws] 发送附件:', attachments.length, '个')
      console.log('[ws] 附件详情:', attachments.map(a => ({ type: a.type, mime: a.mimeType, name: a.fileName, size: a.content?.length })))
    }
    return this.request('chat.send', params)
  }

  // 超时 45s，重试 1 次（Gateway 加载大量历史时可能较慢）
  chatHistory(sessionKey, limit = 200) {
    return this.request('chat.history', { sessionKey, limit }, { timeout: 1000*60*5, retries: 2, retryDelay: 2000 })
  }

  chatAbort(sessionKey, runId) {
    const params = { sessionKey }
    if (runId) params.runId = runId
    return this.request('chat.abort', params)
  }

  // 超时 30s，重试 1 次（大量会话时可能较慢）；成功结果缓存 5 分钟
  sessionsList(limit = 50) {
    return this.request('sessions.list', { limit }, { timeout: 30000, retries: 1, retryDelay: 2000 })
      .then(result => {
        this._sessionsCache = result
        this._sessionsCacheTime = Date.now()
        return result
      })
  }

  /** 获取会话列表缓存（超时降级用） */
  getCachedSessions() {
    if (this._sessionsCache && (Date.now() - this._sessionsCacheTime) < 5 * 60 * 1000) {
      return this._sessionsCache
    }
    return null
  }

  sessionsDelete(key) {
    return this.request('sessions.delete', { key })
  }

  sessionsReset(key) {
    return this.request('sessions.reset', { key })
  }

  // ===== 4.9: Sessions Compaction =====
  // compaction 操作可能较慢，使用更长超时
  sessionsCompactionList(key) {
    return this.request('sessions.compaction.list', { key }, { timeout: 60000, retries: 1, retryDelay: 3000 })
  }

  sessionsCompactionGet(key, checkpointId) {
    return this.request('sessions.compaction.get', { key, checkpointId }, { timeout: 60000, retries: 1, retryDelay: 3000 })
  }

  sessionsCompactionBranch(key, checkpointId) {
    return this.request('sessions.compaction.branch', { key, checkpointId })
  }

  sessionsCompactionRestore(key, checkpointId) {
    return this.request('sessions.compaction.restore', { key, checkpointId })
  }

  // ===== 4.9: Skills Gateway RPC =====
  skillsSearch(query, limit) {
    return this.request('skills.search', { query, limit })
  }

  skillsDetail(slug) {
    return this.request('skills.detail', { slug })
  }

  // ===== 4.9: Approval management =====
  execApprovalList() {
    return this.request('exec.approval.list', {})
  }

  execApprovalGet(id) {
    return this.request('exec.approval.get', { id })
  }

  pluginApprovalList() {
    return this.request('plugin.approval.list', {})
  }

  onEvent(callback) {
    this._eventListeners.push(callback)
    return () => { this._eventListeners = this._eventListeners.filter(fn => fn !== callback) }
  }

  // ==================== 消息缓存管理 ====================

  /**
   * 缓存消息
   * @param {string} sessionKey - 会话 key
   * @param {object} message - 消息对象
   */
  _cacheMessage(sessionKey, message) {
    if (!this._messageCache.has(sessionKey)) {
      this._messageCache.set(sessionKey, [])
    }
    const messages = this._messageCache.get(sessionKey)

    // 去重检查（基于消息 ID 或内容哈希）
    const msgId = message.id || message.messageId
    if (msgId && messages.some(m => (m.id || m.messageId) === msgId)) {
      return
    }

    messages.push({
      ...message,
      _cachedAt: Date.now(),
    })

    // 限制缓存大小
    if (messages.length > this._cacheSize) {
      messages.splice(0, messages.length - this._cacheSize)
    }
  }

  /**
   * 获取缓存的消息
   * @param {string} sessionKey - 会话 key
   * @returns {array} 缓存的消息数组
   */
  _getCachedMessages(sessionKey) {
    return this._messageCache.get(sessionKey) || []
  }

  /**
   * 清除指定会话的缓存
   * @param {string} sessionKey - 会话 key
   */
  _clearCache(sessionKey) {
    if (sessionKey) {
      this._messageCache.delete(sessionKey)
    } else {
      this._messageCache.clear()
    }
    console.log('[ws] 消息缓存已清除:', sessionKey || '全部')
  }

  /**
   * 清除消息去重记录
   */
  _clearSeenMessageIds() {
    this._seenMessageIds.clear()
  }

  /**
   * 获取缓存状态信息
   */
  getCacheInfo() {
    const info = {}
    for (const [key, messages] of this._messageCache) {
      info[key] = {
        count: messages.length,
        oldest: messages[0]?._cachedAt,
        newest: messages[messages.length - 1]?._cachedAt,
      }
    }
    return info
  }

  /**
   * 连接成功后自动拉取历史消息（供前端调用）
   * @param {string} sessionKey - 会话 key
   * @param {number} limit - 消息数量限制
   */
  async fetchHistoryOnReconnect(sessionKey, limit = 200) {
    if (!sessionKey || !this._gatewayReady) {
      return { error: 'not ready' }
    }
    try {
      const history = await this.chatHistory(sessionKey, limit)
      // 将历史消息缓存起来
      if (history?.messages) {
        for (const msg of history.messages) {
          this._cacheMessage(sessionKey, msg)
        }
      }
      return { history }
    } catch (e) {
      console.error('[ws] 拉取历史消息失败:', e)
      return { error: e.message }
    }
  }
}

const _g = typeof window !== 'undefined' ? window : globalThis
if (!_g.__clawpanelWsClient) _g.__clawpanelWsClient = new WsClient()
export const wsClient = _g.__clawpanelWsClient
