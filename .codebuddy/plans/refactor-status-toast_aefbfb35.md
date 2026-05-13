---
name: refactor-status-toast
overview: 将状态通知从独立持久面板方案改为复用现有 toast 一闪即逝模式，保留 statusNotifier.update() API 不变。
todos:
  - id: rewrite-status-notification
    content: 重写 src/components/status-notification.js 为 toast 包装层，移除所有自有 UI 管理和定时器，约80行
    status: completed
  - id: remove-nt-styles
    content: 删除 src/style/components.css 中第899-1156行的全部 .nt-* 样式和动画
    status: completed
  - id: verify-integration
    content: 验证 main.js 的 statusNotifier.update() 调用无需修改、locale 文件正常加载
    status: completed
    dependencies:
      - rewrite-status-notification
      - remove-nt-styles
---

## 产品概述

将当前 `status-notification.js` 中独立的右下角持久化状态通知面板（含分类分组、折叠展开、历史保留、相对时间刷新等功能）重构为直接复用现有 `toast()` 函数的薄包装层。

## 核心功能

1. **保持 API 不变**：`statusNotifier.update(category, payload)` 继续开放给 `main.js` 调用，不破坏已有集成代码
2. **改为 Toast 一闪即逝模式**：`update()` 内部调用 `toast(message, type)` 在右上角短暂展示，3 秒后自动消失
3. **保留文案构建逻辑**：保留 `_buildMessage()` 方法，继续使用国际化文案 `status.*` 模板（含重连计数 `{attempt}/{max}`）
4. **保留 severity 映射**：保留 `SEVERITY_MAP` 到 `toast` type 的映射（info/success/error/warning）
5. **删除独立 UI 容器**：移除所有 `nt-container`、`nt-group`、`nt-item` 等 DOM 构建和样式
6. **删除定时器**：移除 `setInterval` 相对时间刷新、`setTimeout` 自动折叠等定时逻辑
7. **保留工具函数**：保留 `_truncate()` 用于长消息截断

## Tech Stack

- **框架**：Vanilla JS（与项目现有架构一致）
- **通知系统**：复用现有 `src/components/toast.js` 的 `toast(message, type, options)` 函数
- **国际化**：复用 `src/lib/i18n.js` 的 `t(key, params)` 函数，文案继续使用已创建的 `src/locales/modules/status.js`
- **工具函数**：保留 `_truncate()` 长消息截断（继承自当前实现）

## Implementation Approach

### 策略

将 387 行的 `StatusNotification` 类简化为约 80 行的无状态函数式模块。核心思路：

```
statusNotifier.update(category, payload)
  → _buildMessage(category, payload)  生成文案
  → _severityToToastType(category, kind)  映射 toast type
  → toast(message, toastType)  调用现有 toast 显示
```

不需要 `constructor`、`_init()`、`_toggleGroup()`、`_startTimeRefresh()`、`_scheduleAutoCollapse()` 等任何自有 UI 管理方法。`StatusNotification` 类仅保留 `update()` 和 `destroy()` 两个公开方法。

### 关键决策

| 决策 | 理由 |
| --- | --- |
| 保留类结构而非纯函数 | `main.js` 已导入 `statusNotifier` 单例，保持 `new StatusNotification()` 模式不变 |
| 保留 `_buildMessage` 完整逻辑 | 国际化文案和重连进度模板已完备，复用避免重复 |
| 删除 `icon` 导入 | toast 自身有 `.success/.error/.info/.warning` CSS 颜色，不需要内联 SVG 图标 |
| 删除 `_escapeHtml` | `toast()` 内部调用 `textContent` 已天然防 XSS |
| 删除 `_formatTimeAgo` | toast 一闪即逝，不需要相对时间 |


### 影响范围

- **不改 `main.js`**：API 不变，集成代码零变动
- **不改 `toast.js`**：完全复用
- **不改 `locale` 文件**：文案继续使用 `status.*` 键
- **删除 CSS 代码**：约 258 行的 `.nt-*` 样式块

## Directory Structure

```
src/
├── components/
│   └── status-notification.js  # [MODIFY] 重写为 toast 包装层（~80行）
│                                # 删除：_init, _toggleGroup, _startTimeRefresh,
│                                #       _refreshTimeDisplay, _formatTimeAgo,
│                                #       _getIcon, _removeItem, _updateCounter,
│                                #       _scheduleAutoCollapse, _escapeHtml
│                                # 保留：update, _buildMessage, _truncate,
│                                #       SEVERITY_MAP, getSeverity
│                                # 新增：导入 toast()
│
├── style/
│   └── components.css           # [MODIFY] 删除第 899-1156 行 .nt-* 样式
│                                # 删除内容：
│                                #   .nt-container 及其子选择器（~258行）
│                                #   @keyframes nt-slideInUp
│                                #   @keyframes nt-fadeIn
│
└── src/main.js                  # [NO CHANGE] API 不变，无需修改
```

## 重写后 status-notification.js 结构

```js
import { t } from '../lib/i18n.js'
import { toast } from './toast.js'

// severity → toast type 映射（保持不变）
const SEVERITY_MAP = { ... }

function getSeverity(category, kind) { ... }
function _severityToToastType(severity) {
  const map = { info: 'info', success: 'success', error: 'error', warn: 'warning' }
  return map[severity] || 'info'
}

function _truncate(str, max) { ... }

function _buildMessage(category, payload) { ... }  // 内部逻辑不变

class StatusNotification {
  constructor() {}  // 空构造
  update(category, payload) {
    const msg = _buildMessage(category, payload)
    const severity = getSeverity(category, payload.kind || payload.status)
    toast(msg, _severityToToastType(severity))
  }
  destroy() {}  // 空
}

const statusNotifier = new StatusNotification()
export { StatusNotification, statusNotifier }
```