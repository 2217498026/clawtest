---
name: macos-code-server-url-fix
overview: 修复 macOS 上 CODE_SERVER_URL 硬编码为远程 IP 导致连接失败的问
todos:
  - id: add-dynamic-url-detection
    content: 在 src/main.js 中添加 detectCodeServerUrl() 函数，替换静态 CODE_SERVER_URL 赋值，并在主 IIFE 启动流程顶部调用
    status: completed
  - id: verify-all-refs
    content: 检查 main.js 和 skills.js 中所有 CODE_SERVER_URL 引用，确认无需额外改动
    status: completed
    dependencies:
      - add-dynamic-url-detection
---

## 问题

macOS 上 `window.CODE_SERVER_URL = 'http://120.79.141.198:9291'`（远程服务器）无法连接，导致所有依赖该 URL 的 API 调用全部失败：

- `/api/Login/CodeRq` — 授权码验证 (`main.js:355`)
- `/api/Login/SkillRq` — 技能激活验证 (main.js:1218, skills.js:111/548)
- `/api/Login/SkillCt` — 技能 RAR 包更新 (main.js:1186, skills.js:598)
- `/down/openclaw.zip` — 下载链接 (main.js:1080)

## 目标

在 macOS 上（以及任何无法访问远程服务器的环境），当 `120.79.141.198:9291` 不可达时，自动降级使用本地 `http://localhost:9291`，确保应用能正常运行。

## 核心功能

- 启动时自动检测 `CODE_SERVER_URL` 的连通性
- 远程可达则用远程，不可达则降级到 `localhost`
- 所有现有引用点（`${CODE_SERVER_URL}...`）无需改动，自动适配

## 技术方案

### 方案概述

在 `src/main.js` 中，将静态的 `window.CODE_SERVER_URL = 'http://120.79.141.198:9291'` 替换为**动态连通性检测**：

1. 编写 `detectCodeServerUrl()` 异步函数
2. 使用 `fetch(mode: 'no-cors')` + `AbortController`（2s 超时）探测远程服务器是否可达
3. 可达 → 用远程地址 `http://120.79.141.198:9291`；不可达 → 降级到 `http://localhost:9291`
4. 在启动流程的最前面（主 IIFE 顶部，`showcode()` 之前）执行检测，将结果写入 `window.CODE_SERVER_URL`

### 关键设计决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 探测方式 | `HEAD` + `no-cors` | 跨域探测不受 CORS 限制，不依赖具体 API 接口存在性；`no-cors` 模式下即使服务器无响应也能获取网络状态 |
| 超时时间 | 2000ms | 平衡等待体验和网络波动容忍度 |
| Fallback 地址 | `http://localhost:9291` | 代码中原有的注释备选值，与远程服务器提供相同接口 |
| 检测时机 | 主 IIFE 最顶部，`showcode()` 之前 | 确保所有依赖 `CODE_SERVER_URL` 的调用都能用到正确值 |


### 性能考虑

- 检测最多阻塞启动 2 秒（超时即降级），不影响后续流程
- 只在应用启动时执行一次，无运行时开销
- 使用 `no-cors` 模式，即使目标服务器没有配置 CORS 头也不会出错

### 代码实现要点

```javascript
// 在 main.js 顶部附近替换原来的静态赋值：
// window.CODE_SERVER_URL = 'http://120.79.141.198:9291'
// 改为：

const REMOTE_URL = 'http://120.79.141.198:9291'
const LOCAL_URL = 'http://localhost:9291'

async function detectCodeServerUrl() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    await fetch(REMOTE_URL, { mode: 'no-cors', signal: controller.signal })
    clearTimeout(timer)
    console.log('[main] 远程 CODE_SERVER 可达:', REMOTE_URL)
    window.CODE_SERVER_URL = REMOTE_URL
  } catch {
    console.warn('[main] 远程 CODE_SERVER 不可达，降级到本地:', LOCAL_URL)
    window.CODE_SERVER_URL = LOCAL_URL
  }
}

// 然后在主 IIFE 最顶部调用：
// ;(async () => {
//   await detectCodeServerUrl()   // <-- 新增
//   await showcode()
//   ...
// })()
```

### 数据结构

无需新增数据结构或类型定义，所有改动均在 `src/main.js` 一个文件内完成。

### 目录结构

```
src/main.js  # [MODIFY] 替换静态 CODE_SERVER_URL 赋值为动态检测函数，并在启动流程中调用
```

所有其他文件（包括 `src/pages/skills.js`）无需任何改动，因为 `window.CODE_SERVER_URL` 仍然保持全局变量，值在运行时动态确定。