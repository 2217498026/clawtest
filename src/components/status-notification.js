/**
 * 状态通知组件 — 薄包装层，将 status 事件转为 toast 一闪即逝模式
 *
 * 使用方式：
 *   import { statusNotifier } from './components/status-notification.js'
 *   statusNotifier.update('guardian', { kind: 'auto_fix_start' })
 *   statusNotifier.update('gateway', { status: 'running' })
 *   statusNotifier.update('ws', { status: 'reconnecting', attempt: 3, max: 20 })
 *
 * 内部复用 toast() 在右上角显示 3 秒自动消失。
 */

import { t } from '../lib/i18n.js'
import { toast } from './toast.js'

// 状态 → toast type 映射
const SEVERITY_MAP = {
  // guardian
  guardian_started: 'info',
  gateway_starting: 'info',
  gateway_restarted: 'success',
  auto_fix_start: 'info',
  auto_fix_retry: 'warn',
  auto_fix_success: 'success',
  auto_fix_failure: 'error',
  give_up: 'error',
  // gateway
  running: 'success',
  started: 'success',
  stopped: 'warn',
  startFailed: 'error',
  foreign: 'warn',
  // ws
  connecting: 'info',
  handshaking: 'info',
  connected: 'success',
  ready: 'success',
  disconnected: 'warn',
  reconnecting: 'warn',
  reconnectSuccess: 'success',
  reconnectFailed: 'error',
  heartbeatTimeout: 'warn',
  giveUp: 'error',
}

function getSeverity(category, kind) {
  return SEVERITY_MAP[kind] || 'info'
}

const _severityToToastType = {
  info: 'info',
  success: 'success',
  error: 'error',
  warn: 'warning',
}

function _truncate(str, max) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max) + '...' : str
}

function _buildMessage(category, payload) {
  const st = payload.status || payload.kind || ''

  if (category === 'guardian') {
    switch (st) {
      case 'guardian_started': return t('status.guardian.guardian_started')
      case 'gateway_starting': return t('status.guardian.gateway_starting')
      case 'gateway_restarted': return t('status.guardian.gateway_restarted')
      case 'auto_fix_start': return t('status.guardian.auto_fix_start')
      case 'auto_fix_retry': return t('status.guardian.auto_fix_retry')
      case 'auto_fix_success': return t('status.guardian.auto_fix_success')
      case 'auto_fix_failure':
        return payload.message
          ? `${t('status.guardian.auto_fix_failure')}: ${_truncate(payload.message, 80)}`
          : t('status.guardian.auto_fix_failure')
      case 'give_up': return t('status.guardian.give_up')
      case 'restart_count':
        return t('status.guardian.restartCount', { count: payload.count || 0 })
      case 'waiting_restart':
        return t('status.guardian.waiting_restart', { seconds: payload.seconds || 60 })
      default: return st
    }
  }

  if (category === 'gateway') {
    switch (st) {
      case 'running': return t('status.gateway.running')
      case 'started': return t('status.gateway.started')
      case 'stopped': return t('status.gateway.stopped')
      case 'startFailed': return t('status.gateway.startFailed')
      case 'foreign': return t('status.gateway.foreign')
      default: return st
    }
  }

  if (category === 'ws') {
    switch (st) {
      case 'connecting': return t('status.ws.connecting')
      case 'handshaking': return t('status.ws.handshaking')
      case 'connected': return t('status.ws.connected')
      case 'ready': return t('status.ws.ready')
      case 'disconnected': return t('status.ws.disconnected')
      case 'reconnecting':
        if (payload.attempt && payload.max) {
          return t('status.ws.reconnecting', { attempt: payload.attempt }) + ` (${payload.attempt}/${payload.max})`
        }
        return t('status.ws.reconnecting', { attempt: payload.attempt || '?' })
      case 'reconnectSuccess': return t('status.ws.reconnectSuccess')
      case 'reconnectFailed':
        return payload.errorMsg
          ? `${t('status.ws.reconnectFailed')}: ${_truncate(payload.errorMsg, 80)}`
          : t('status.ws.reconnectFailed')
      case 'heartbeatTimeout': return t('status.ws.heartbeatTimeout')
      case 'giveUp': return t('status.ws.giveUp')
      default: return st
    }
  }

  return st
}

class StatusNotification {
  constructor() {}

  /**
   * 更新指定类别的通知 — 直接调用 toast() 一闪即逝
   * @param {'guardian'|'gateway'|'ws'} category
   * @param {object} payload 同之前文档
   */
  update(category, payload) {
    const msg = _buildMessage(category, payload)
    const severity = getSeverity(category, payload.kind || payload.status)
    const toastType = _severityToToastType[severity] || 'info'
    toast(msg, toastType, { duration: 6000 })
  }

  destroy() {}
}

// 全局单例
const statusNotifier = new StatusNotification()
export { StatusNotification, statusNotifier }
