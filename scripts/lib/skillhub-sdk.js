/**
 * SkillHub SDK — Node.js 版
 * 纯 HTTP + zip 操作，API 接口与 Rust SDK (skillhub.rs) 完全对齐。
 * 供 dev-api.js Web/Docker 端调用。
 */
import fs from 'fs'
import path from 'path'
import { inflateRaw } from 'zlib'
import { promisify } from 'util'

const inflateRawAsync = promisify(inflateRaw)

const COS_BASE = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com'
const API_BASE = 'https://lightmake.site/api/v1'
const INDEX_TTL = 10 * 60 * 1000 // 10 分钟缓存

let _indexCache = null // { ts: number, items: Array }

// ── 公开接口 ──────────────────────────────────────────────

/**
 * 搜索 SkillHub
 * @param {string} query
 * @param {number} [limit=20]
 * @returns {Promise<Array<{slug, displayName, summary, version}>>}
 */
export async function search(query, limit = 20) {
  const q = (query || '').trim()
  if (!q) return []
  const url = `${API_BASE}/search?q=${encodeURIComponent(q)}&limit=${limit}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!resp.ok) throw new Error(`SkillHub 搜索失败: HTTP ${resp.status}`)
  const data = await resp.json()
  return data.results || []
}

/**
 * 拉取全量索引（带 10 分钟内存缓存）
 * @returns {Promise<Array<{slug, displayName, summary, version}>>}
 */
export async function fetchIndex() {
  if (_indexCache && Date.now() - _indexCache.ts < INDEX_TTL) {
    return _indexCache.items
  }
  const url = `${COS_BASE}/skills.json`
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!resp.ok) throw new Error(`拉取技能索引失败: HTTP ${resp.status}`)
  const data = await resp.json()
  const items = data.skills || data // 兼容 {total, skills} 包装和裸数组
  _indexCache = { ts: Date.now(), items }
  return items
}

/**
 * 下载 Skill zip（COS 镜像优先，回退主站 API）
 * @param {string} slug
 * @returns {Promise<Buffer>}
 */
export async function downloadZip(slug) {
  // 1. 优先 COS 镜像（国内 CDN）
  try {
    const resp = await fetch(`${COS_BASE}/skills/${slug}.zip`, {
      signal: AbortSignal.timeout(30000)
    })
    if (resp.ok) return Buffer.from(await resp.arrayBuffer())
  } catch { /* COS 失败，回退主站 */ }
  // 2. 回退主站 API
  const resp = await fetch(`${API_BASE}/download?slug=${encodeURIComponent(slug)}`, {
    signal: AbortSignal.timeout(30000)
  })
  if (!resp.ok) throw new Error(`下载失败: HTTP ${resp.status}`)
  return Buffer.from(await resp.arrayBuffer())
}

/**
 * 下载并安装 Skill：zip → 解压到 skillsDir/{slug}/
 * @param {string} slug
 * @param {string} skillsDir - 如 ~/.openclaw/skills/
 * @returns {Promise<string>} 安装路径
 */
export async function install(slug, skillsDir) {
  validateSlug(slug)
  const targetDir = path.join(skillsDir, slug)
  const zipBuf = await downloadZip(slug)
  await extractZip(zipBuf, targetDir)
  return targetDir
}

// ── 内部工具 ──────────────────────────────────────────────

function validateSlug(slug) {
  if (!slug) throw new Error('Skill slug 不能为空')
  if (slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    throw new Error(`无效的 Skill slug: ${slug}`)
  }
}

/**
 * 纯 Node.js zip 解压（无外部依赖）
 * 支持 Deflate (method 8) 和 Stored (method 0)
 * @param {Buffer} zipBuf
 * @param {string} targetDir
 */
async function extractZip(zipBuf, targetDir) {
  // 清理旧目录
  if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true })
  fs.mkdirSync(targetDir, { recursive: true })

  const entries = parseZipEntries(zipBuf)
  if (!entries.length) throw new Error('zip 文件为空或无法解析')

  // 检测单一根目录（常见打包方式），需要剥掉
  const stripPrefix = detectSingleRootDir(entries)

  for (const entry of entries) {
    let name = entry.name
    // 安全检查
    if (name.includes('..')) continue

    // 剥掉单一根目录
    if (stripPrefix) {
      if (!name.startsWith(stripPrefix)) continue
      name = name.slice(stripPrefix.length)
      if (!name) continue
    }

    const outPath = path.join(targetDir, name)

    if (entry.isDir) {
      fs.mkdirSync(outPath, { recursive: true })
    } else {
      const dir = path.dirname(outPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      let data
      if (entry.method === 0) {
        // Stored
        data = zipBuf.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
      } else if (entry.method === 8) {
        // Deflate
        const compressed = zipBuf.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)
        data = await inflateRawAsync(compressed)
      } else {
        console.warn(`[skillhub-sdk] 跳过不支持的压缩方法 ${entry.method}: ${name}`)
        continue
      }
      fs.writeFileSync(outPath, data)
    }
  }
}

/**
 * 解析 zip 文件的 Local File Header 条目
 * @param {Buffer} buf
 * @returns {Array<{name, isDir, method, compressedSize, dataOffset}>}
 */
function parseZipEntries(buf) {
  const entries = []
  let offset = 0
  const LOCAL_FILE_HEADER_SIG = 0x04034b50

  while (offset + 30 <= buf.length) {
    const sig = buf.readUInt32LE(offset)
    if (sig !== LOCAL_FILE_HEADER_SIG) break

    const method = buf.readUInt16LE(offset + 8)
    const compressedSize = buf.readUInt32LE(offset + 18)
    const uncompressedSize = buf.readUInt32LE(offset + 22)
    const nameLen = buf.readUInt16LE(offset + 26)
    const extraLen = buf.readUInt16LE(offset + 28)
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8')
    const dataOffset = offset + 30 + nameLen + extraLen

    entries.push({
      name,
      isDir: name.endsWith('/'),
      method,
      compressedSize,
      uncompressedSize,
      dataOffset,
    })

    // 处理 data descriptor (bit 3 of general purpose bit flag)
    const gpFlag = buf.readUInt16LE(offset + 6)
    let dataSize = compressedSize
    if ((gpFlag & 0x08) && compressedSize === 0) {
      // Data descriptor 跟在压缩数据后面，需要查找
      // 简化处理：跳过这种情况（极少见）
      break
    }

    offset = dataOffset + dataSize
  }

  return entries
}

/**
 * 检测 zip 是否有单一顶层目录
 * @param {Array<{name}>} entries
 * @returns {string|null}
 */
function detectSingleRootDir(entries) {
  let root = null
  for (const entry of entries) {
    const firstSeg = entry.name.split('/')[0]
    if (!firstSeg) continue
    const prefix = firstSeg + '/'
    if (root === null) {
      root = prefix
    } else if (!entry.name.startsWith(root)) {
      return null // 多个顶层目录
    }
  }
  return root
}
