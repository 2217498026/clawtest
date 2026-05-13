/**
 * 功能版本门控 — 根据 OpenClaw 版本动态显示/隐藏功能
 *
 * 工作原理：
 * 1. 从 api.getVersionInfo() 获取当前 OpenClaw 版本
 * 2. 对比功能所需最低版本
 * 3. sidebar 和页面可调用 isFeatureAvailable() 判断是否显示
 *
 * 版本格式: x.y.z 或 x.y.z-zh.w（汉化版）
 */
import { api } from './tauri-api.js'
import { wsClient } from './ws-client.js'

// 功能 → 最低版本映射（语义化版本号，不含 -zh 后缀）
const FEATURE_MIN_VERSIONS = {
  dreaming: '0.11.0',
  cron: '0.10.0',
  skills: '0.10.0',
  'route-map': '0.9.0',
  'plugin-hub': '0.9.0',
  memory: '0.8.0',
}

let _cachedVersion = null
let _cacheTime = 0
const CACHE_TTL = 60000

/**
 * 解析版本号为可比较的数组 [major, minor, patch]
 * 支持 '0.11.6', '0.11.6-zh.2', '2026.3.18' 等格式
 */
function parseVersion(ver) {
  if (!ver) return null
  // 移除 -zh.xxx / -beta.xxx 等后缀，只保留主版本号
  const base = ver.replace(/-.*$/, '')
  const parts = base.split('.').map(Number)
  if (parts.some(isNaN)) return null
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

/**
 * 比较版本: a >= b 返回 true
 */
function versionGte(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return true // 无法解析时默认允许
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true
    if (pa[i] < pb[i]) return false
  }
  return true // equal
}

/**
 * 获取当前 OpenClaw 版本（带缓存）
 */
async function getCurrentVersion() {
  if (_cachedVersion && Date.now() - _cacheTime < CACHE_TTL) return _cachedVersion

  // 优先从 wsClient.serverVersion 获取（实时）
  if (wsClient.serverVersion) {
    _cachedVersion = wsClient.serverVersion
    _cacheTime = Date.now()
    return _cachedVersion
  }

  // 回退到 API
  try {
    const info = await api.getVersionInfo()
    if (info?.current) {
      _cachedVersion = info.current
      _cacheTime = Date.now()
    }
  } catch {}

  return _cachedVersion
}

/**
 * 同步获取上次缓存的版本（不发请求）
 */
export function getCachedVersion() {
  return _cachedVersion || wsClient.serverVersion || null
}

/**
 * 同步检查功能是否可用（基于缓存版本）
 * 如果版本信息尚未获取，默认返回 true（避免隐藏功能）
 */
export function isFeatureAvailable(featureId) {
  const minVer = FEATURE_MIN_VERSIONS[featureId]
  if (!minVer) return true // 无门控 → 始终可用

  const currentVer = getCachedVersion()
  if (!currentVer) return true // 版本未知 → 默认显示

  return versionGte(currentVer, minVer)
}

/**
 * 异步检查功能是否可用（会先获取版本）
 */
export async function checkFeatureAvailable(featureId) {
  await getCurrentVersion()
  return isFeatureAvailable(featureId)
}

/**
 * 初始化：预加载版本信息
 */
export async function initFeatureGates() {
  await getCurrentVersion()
}

/**
 * 刷新缓存
 */
export function invalidateVersionCache() {
  _cachedVersion = null
  _cacheTime = 0
}

/**
 * 获取所有功能门控状态（调试用）
 */
export function getAllFeatureStatus() {
  const ver = getCachedVersion()
  const result = {}
  for (const [feature, minVer] of Object.entries(FEATURE_MIN_VERSIONS)) {
    result[feature] = { minVersion: minVer, available: isFeatureAvailable(feature) }
  }
  return { currentVersion: ver, features: result }
}
