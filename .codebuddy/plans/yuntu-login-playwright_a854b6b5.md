---
name: yuntu-login-playwright
overview: 在 scripts/ 目录下创建一个基于 Playwright CLI 的自动化登录脚本，实现巨量引擎云图平台（https://yuntu.oceanengine.com/account/login）的自动登录功能，包含显式等待、表单定位填充、登录提交和登录状态验证。
todos:
  - id: create-login-script
    content: 在 scripts/yuntu-login.js 中创建完整的 Playwright 自动登录脚本，包含 setup/navigateToLogin/fillCredentials/submitLogin/verifyLogin/persistState/main 等函数模块，支持 CLI 参数和模块导入双模式
    status: completed
---

## 需求描述

创建一个基于 Playwright CLI 的自动化登录脚本 `scripts/yuntu-login.js`，实现巨量引擎云图平台的自动登录。

### 核心功能

1. **环境检查与初始化**：自动检测 Playwright 是否安装，未安装时给出明确的安装指引
2. **浏览器启动**：启动 Chromium 浏览器（默认有头模式，支持 --headless 参数切换），设置 1280x800 视口
3. **页面导航与显式等待**：导航到 `https://yuntu.oceanengine.com/account/login`，等待 `networkidle` 状态，各元素操作前使用 `waitForSelector`（15秒超时）
4. **表单定位与填充**：通过多种选择器策略（CSS 选择器 -> placeholder 属性 -> text 匹配）定位邮箱和密码输入框，使用 `page.fill()` 填充账号 `a510262246@163.com` 和密码 `Xintu123`
5. **登录提交**：定位登录按钮，使用重试机制（最多3次）触发登录提交，每次重试间隔适当等待
6. **登录验证**：双重验证机制 —— 先检测 URL 是否从 `/account/login` 跳转（30秒超时），再检测页面上代表登录成功的关键元素（如用户头像、导航菜单等）
7. **错误处理与超时**：每一步都有明确的超时限制和错误捕获，对验证码弹出等异常情况给出明确提示
8. **Cookie 持久化**：登录成功后使用 `context.storageState()` 保存认证状态到本地 JSON 文件，支持后续脚本复用登录态

### 输出信息

- 控制台彩色日志展示每一步的进度和结果
- 登录成功后自动截图保存到 `scripts/yuntu-login-screenshot.png`
- Cookie 文件保存到 `scripts/yuntu-login-state.json`
- 最终以结构化 JSON 输出登录结果（success/cookiePath/screenshotPath/error）

## 技术栈

### 选型

| 技术 | 用途 | 说明 |
| --- | --- | --- |
| **Node.js** | 运行时 | 项目已有，v22+，ESM 模块系统 |
| **Playwright** | 浏览器自动化 | Chromium 引擎，内置 auto-waiting |
| **process.argv** | CLI 参数解析 | 轻量，不需要额外依赖 |


### 关键设计决策

1. **Playwright 选择理由**：内置 auto-waiting 机制，对 React SPA（云图页面）支持优于 Puppeteer，元素交互前自动等待可见/稳定/可交互
2. **双阶段登录验证**：URL 变化检测（验证登录请求成功导致的页面跳转）+ 关键元素检测（验证页面渲染完成），双重保障判断准确
3. **多层选择器策略**：优先精确 CSS 选择器（性能最快），降级到 placeholder 属性匹配，最后按文本内容匹配，应对页面微调
4. **提交重试机制**：首次登录点击可能因网络或页面状态导致失败，3次重试 + 指数退避等待提高成功率
5. **Cookie 持久化设计**：使用 Playwright 原生 `storageState()` API，比手动管理 Cookie 更可靠，包含 localStorage 等完整会话信息

### 体系结构

```
┌─────────────────────────────────────────────────────────────┐
│                     yuntu-login.js                          │
│                                                             │
│  1. setup() ── 环境检测 + 浏览器启动                         │
│  2. navigateToLogin() ── 页面导航 + 等待加载                 │
│  3. fillCredentials() ── 表单填充（多种选择器策略）           │
│  4. submitLogin() ── 登录提交（3次重试）                     │
│  5. verifyLogin() ── URL检测 + 元素检测                      │
│  6. persistState() ── Cookie保存 + 截图                      │
│  7. main() ── 主流程编排 + 错误处理 + 清理                    │
└─────────────────────────────────────────────────────────────┘
```

### 实现细节

#### 登录页面元素分析（基于巨量引擎/字节跳动标准登录体系）

- **邮箱输入框**：`input[type="text"]` 或 `input[placeholder*="邮箱"]` 或 `input[name="email"]`，优先级按此顺序
- **密码输入框**：`input[type="password"]` 或 `input[placeholder*="密码"]` 或 `input[name="password"]`
- **登录按钮**：`button[type="submit"]` 或包含文本"登录"的按钮，使用 `page.getByRole('button', { name: '登录' })` 作为补充
- **登录成功标志**：URL 从 `/account/login` 变为 `/`、`/dashboard` 或任何非登录路径；页面出现用户头像/用户名元素

#### 等待策略

| 阶段 | 等待方式 | 超时 |
| --- | --- | --- |
| 页面加载 | `waitForLoadState('networkidle')` | 30s |
| 输入框就绪 | `waitForSelector(..., { state: 'visible' })` | 15s |
| 表单填充 | 直接 `page.fill()`（自带 auto-wait） | 10s |
| 登录跳转 | `waitForURL(url => !url.includes('login'))` | 30s |
| 关键元素 | `waitForSelector(..., { state: 'visible' })` | 15s |


### 目录结构

```
c:/work/clawpanel-main/clawpanel-main/clawpanel-main/
├── scripts/
│   ├── yuntu-login.js              # [NEW] 云图自动登录脚本
│   ├── yuntu-login-state.json      # [NEW][运行时生成] Cookie/Storage 持久化文件
│   ├── yuntu-login-screenshot.png  # [NEW][运行时生成] 登录成功截图
│   └── ...                         # 其他现有脚本保持不变
```

### 文件详细说明

#### scripts/yuntu-login.js [NEW]

**用途**：云图平台 Playwright 自动登录脚本，支持 CLI 直接执行和模块导入

**主要功能模块**：

1. **checkPlaywright()** —— 环境检测

- 动态 `import('playwright')` 检测是否安装
- 未安装时输出详细安装命令（npm install playwright && npx playwright install chromium）
- 提供中文安装指引

2. **parseArgs()** —— CLI 参数解析

- `--headless`：无头模式运行
- `--cookie <path>`：指定 Cookie 文件路径
- `--screenshot <path>`：指定截图保存路径

3. **setup()** —— 浏览器启动与上下文创建

- 参数：headless 标志
- 返回：{ browser, context, page } 三元组
- 设置 viewport: { width: 1280, height: 800 }
- 设置 locale: 'zh-CN' 避免语言问题

4. **navigateToLogin(page)** —— 页面导航

- page.goto() 访问登录页面
- waitForLoadState('networkidle') 等待完全加载
- 确认页面标题或关键元素出现

5. **fillCredentials(page)** —— 表单填充

- 多层次选择器定位邮箱输入框并 fill()
- 多层次选择器定位密码输入框并 fill()
- 每次填充后短暂等待确保渲染完成
- 返回填充是否成功

6. **submitLogin(page)** —— 登录提交

- 重试循环（最多3次）
- 每次尝试使用不同策略定位登录按钮
- 点击后等待 2 秒让页面响应
- 检查 URL 是否变化判断提交是否触发

7. **verifyLogin(page)** —— 登录验证

- 第一重：waitForURL 检测 URL 离开 /account/login
- 第二重：检测页面是否出现用户信息区域（avatar/nav/user-name）
- 第三重兜底：检测页面文本是否包含"云图"等标志性内容
- 返回验证结果对象 { success, url, elements }

8. **persistState(context, page)** —— 状态持久化

- context.storageState() 保存完整会话（Cookie + localStorage）
- page.screenshot() 保存登录成功截图
- 返回 { cookiePath, screenshotPath }

9. **main()** —— 主流程编排

- 按顺序调用上述函数
- try/catch/finally 确保浏览器始终关闭
- 输出 JSON 格式结果供其他脚本消费
- 输出彩色控制台日志供人工查看

**CLI 使用方式**：

```
# 直接运行（有头模式，可观察浏览器操作）
node scripts/yuntu-login.js

# 无头模式运行
node scripts/yuntu-login.js --headless

# 指定 Cookie 保存路径
node scripts/yuntu-login.js --cookie ./my-cookies.json

# 模块导入使用
import { login } from './scripts/yuntu-login.js'
const result = await login({ headless: true })
console.log(result.success) // true/false
```