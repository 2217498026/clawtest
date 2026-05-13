---
name: frontend-status-notification
overview: 实现前端状态通知机制，分三类（守护进程/Gateway/WS重连）实时推送进度状态，使用增强的Toast系统非阻塞展示。
design:
  styleKeywords:
    - Minimalism
    - Glassmorphism
    - Non-blocking
  fontSystem:
    fontFamily: system-ui, -apple-system, sans-serif
    heading:
      size: 13px
      weight: 600
    subheading:
      size: 12px
      weight: 500
    body:
      size: 12px
      weight: 400
  colorSystem:
    primary:
      - "#3B82F6"
      - "#10B981"
      - "#F59E0B"
    background:
      - rgba(255,255,255,0.92)
      - rgba(30,30,30,0.92)
    text:
      - "#1F2937"
      - "#6B7280"
      - "#9CA3AF"
    functional:
      - "#3B82F6"
      - "#10B981"
      - "#F59E0B"
      - "#EF4444"
todos:
  - id: add-status-notification-component
    content: 新增 src/components/status-notification.js，实现 NotificationManager 类，管理三类通知的状态存储和UI渲染，支持 update(category, payload)、手动关闭、折叠展开、自动超时折叠
    status: completed
  - id: add-notification-styles
    content: 在 components.css 末尾追加通知组件的完整样式（.nt-container, .nt-group, .nt-item, .nt-header, 三类色条变体, slideInUp动画等）
    status: completed
    dependencies:
      - add-status-notification-component
  - id: create-locale-file
    content: 新增 src/locales/modules/status.js，定义 guardian/gateway/ws 三类的全部通知文案（含重连计数模板）
    status: completed
  - id: integrate-guardian-events
    content: 在 main.js 中将 guardian-event 的 5 种 kind(auto_fix_start/retry/success/failure、give_up) 及新增的 gateway_starting/gateway_restarted 事件统一路由到 StatusNotification.update('guardian', payload)
    status: completed
    dependencies:
      - add-status-notification-component
      - add-notification-styles
      - create-locale-file
  - id: integrate-gateway-events
    content: 在 app-state.js 中增强 onGatewayChange 回调机制，确保 starting/running/stopped/error 四种状态均有明确标识；在 main.js 中调用 notification.update('gateway', {status, foreign})
    status: completed
    dependencies:
      - add-status-notification-component
  - id: integrate-ws-reconnect
    content: 在 ws-client.js 中确保 onStatusChange 回调携带 attempt 和 maxAttempts 信息；在 main.js 调用 notification.update('ws', {status, attempts, maxAttempts, errorMsg})
    status: completed
    dependencies:
      - add-status-notification-component
  - id: add-time-refresh-loop
    content: 在 status-notification.js 中添加全局 tick 循环（每10秒），刷新所有通知卡片的"X秒前"/"X分钟前"相对时间显示
    status: completed
    dependencies:
      - add-status-notification-component
---

## 产品概述

实现一个统一的前端状态通知机制，当后端守护进程（Guardian）启动或异常、Gateway 状态发生变更、以及 WebSocket 断开并触发重连时，均需向用户界面实时推送进度状态。要求将三类状态分类展示，包括初始连接、重连尝试次数、成功或失败结果，并在界面上使用非阻塞的提示组件进行反馈。

## 核心功能

1. **后端守护(GUARDIAN)状态通知**：守护进程启动、自动修复开始/重试/成功/失败、放弃拉起时，分别推送分类通知
2. **Gateway 状态变更通知**：Gateway 启动中、启动成功、启动失败、正在停止、已停止、异常退出时推送状态通知
3. **WebSocket 重连进度通知**：初始连接(connecting)、握手(handshaking)、重连中(含尝试次数)、重连成功、重连失败时推送进度通知
4. **非阻塞提示组件**：使用 Toast 风格的固定定位通知卡片，不打断用户操作，三类通知按类别分组展示
5. **分类管理**：通知卡片按 Guardian、Gateway、WS 三类分组，每组显示当前最新状态及时间，重连进度需展示尝试次数和持续时间

## Tech Stack

- **运行环境**: Tauri v2 + Vite
- **前端框架**: Vanilla JS（无 Vue/React）
- **样式系统**: CSS Variables + 手写 CSS（10个样式文件）
- **图标系统**: 自定义内联 SVG（`src/lib/icons.js`）
- **状态管理**: 模块级变量 + 回调监听器数组（现有模式）
- **事件通信**: Tauri IPC（`@tauri-apps/api/event` 的 `listen()`）+ 自定义回调
- **现有 Toast**: `src/components/toast.js`（保留，作为简单提示的补充）

## Implementation Approach

### 策略

创建一个全新的 `StatusNotification` 组件（`src/components/status-notification.js`），独立于现有的 `toast.js`。原因：

- 现有 toast 是"闪一下就消失"的模式，不适合展示重连进度、尝试次数等持续变化的持久化状态
- 新组件需要分类管理（Guardian / Gateway / WS Reconnect），每类可保留最新状态
- 非阻塞 + 可手动关闭 + 自动超时降级

### 工作方式

1. `StatusNotification` 维护一个固定定位的通知容器（与 toast 容器类似但不同位置/风格）
2. 三类状态各自注册独立的更新回调，向容器推送状态变更
3. 同一类别的通知自动合并（不重复添加，而是更新已有的卡片）
4. 支持：状态图标 + 状态文本 + 相对时间 + 尝试次数 + 手动关闭按钮
5. 默认 30 秒后自动折叠到摘要模式，可通过点击展开

### 关键决策

- **不修改现有 `toast.js`**：保留现有 toast 用于简单的操作反馈（如"配置已保存"）
- **不引入 event bus 库**：直接复用现有的 `onGatewayChange`、`onStatusChange`、Tauri `listen('guardian-event')` 模式
- **后端改动最小化**：只在 Rust 侧增加 `gateway_starting` 和 `gateway_restarted` 2 个 event kind 枚举值，其余全前端实现
- **使用 `window.requestAnimationFrame`**：确保频繁的状态更新（如重连次数变化）不会引起布局抖动

### Performance 和可靠性

- 通知容器使用 CSS `will-change: transform` 和 `contain: content` 优化
- 使用防抖（debounce）合并短时间内同一类别多次状态变更
- 相对时间显示（"3 秒前"）使用单一 `setInterval`（每 10 秒刷新一次），避免每个卡片独立定时器
- 通知卡片数量限制：每类最多保留 1 条活动 + 最多 3 条历史记录

## Architecture Design

### 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                     main.js                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │  listen('guardian-event') → GuardianStatusUpdate  │   │
│  │  onGatewayChange(running)   → GatewayStatusUpdate │   │
│  │  wsClient.onStatusChange()  → WSReconnectUpdate   │   │
│  └────────────┬──────────┬──────────┬────────────────┘   │
│               │          │          │                    │
└────────────────┼──────────┼──────────┼────────────────────┘
                 │          │          │
    ┌────────────┼──────────┼──────────┼────────────┐
    │            ▼          ▼          ▼            │
    │      StatusNotification Manager               │
    │  ┌──────────────────────────────────────┐     │
    │  │ Group: Guardian        [展开 ▼]       │     │
    │  │  ● 自动修复成功  · 30秒前             │     │
    │  ├──────────────────────────────────────┤     │
    │  │ Group: Gateway         [展开 ▼]       │     │
    │  │  ● Gateway 已启动  · 2分钟前          │     │
    │  ├──────────────────────────────────────┤     │
    │  │ Group: WS Reconnect   [展开 ▼]       │     │
    │  │  ● 第3次重连中...  · 持续15秒        │     │
    │  └──────────────────────────────────────┘     │
    │       固定在页面右下角的通知容器                │
    └────────────────────────────────────────────────┘
```

### 数据流

```
Rust 端 (service.rs)
  ├→ guardian_tick(): 检测 Gateway 状态变化
  │   ├→ guardian-event { kind: "gateway_starting" }      [NEW]
  │   ├→ guardian-event { kind: "gateway_restarted" }      [NEW]
  │   ├→ guardian-event { kind: "auto_fix_start/retry/..." } [EXISTING]
  │   └→ guardian-event { kind: "give_up" }                [EXISTING]
  └→ emit() → Tauri IPC

前端 main.js
  ├→ listen('guardian-event') → StatusNotification.update('guardian', payload)
  ├→ onGatewayChange(running, foreign) → StatusNotification.update('gateway', status)
  └→ wsClient.onStatusChange(status, errorMsg) → StatusNotification.update('ws', { status, attempts, errorMsg })

StatusNotification 组件
  ├→ 管理三类通知状态
  ├→ 渲染/更新 UI
  └→ 定时清理过期的历史记录
```

## Directory Structure

```
src/
├── components/
│   └── status-notification.js   # [NEW] 状态通知组件。管理三类通知的UI渲染和状态更新。
│                                # - 提供 update(category, payload) 方法
│                                # - category: 'guardian' | 'gateway' | 'ws'
│                                # - 自动创建固定定位通知容器
│                                # - 支持分组合并、折叠、自动超时降级
│                                # - 支持手动关闭
│
├── style/
│   └── components.css           # [MODIFY] 在末尾追加 .notification-group 相关样式
│                                # 新增：.nt-container, .nt-group, .nt-item, .nt-header等
│
├── main.js                      # [MODIFY] 在 setup 函数中集成 NotificationManager
│                                # 1. 初始化 StatusNotification 实例
│                                # 2. 将 guardian-event 监听改为调用 notification.update()
│                                # 3. 将 onGatewayChange 改为调用 notification.update()
│                                # 4. 将 wsClient.onStatusChange 改为调用 notification.update()
│
├── lib/
│   ├── ws-client.js             # [MODIFY] 增强状态变更回调 payload，新增：
│                                #    onStatusChange 的 payload 补充: attempts, lastConnectedAt
│                                #    确保重连中状态附带尝试序号
│   ├── app-state.js             # [MODIFY] 增加 onGatewayStarting 回调支持
│                                #    跟踪 Gateway 启动中状态（非 running 但正在启动）
│   └── icons.js                 # [MODIFY] 如有必要，新增 notify-bell / activity 等图标
│
└─── locales/
    └── modules/
        ├── dashboard.js         # [MODIFY] 根据通知系统调整部分文案（可选）
        └── status.js            # [NEW] 新增国际化文案文件，定义三类通知的各类消息文本
```

## 国际化文案建议 (新增文件 src/locales/modules/status.js)

```js
export default () => ({
  guardian: {
    title: '守护进程',
    starting: '守护进程启动中...',
    autoFixStart: '检测到配置异常，正在自动修复...',
    autoFixRetry: '修复完成，正在重试启动 Gateway...',
    autoFixSuccess: '自动修复成功，Gateway 已启动',
    autoFixFailure: '自动修复失败',
    gaveUp: '连续重启失败，已停止自动拉起',
    restartCount: '第 {count} 次自动重启',
    lastRestart: '上次重启',
    waitingRestartCooldown: '冷却中，60秒后重试',
  },
  gateway: {
    title: '网关(Gateway)',
    running: 'Gateway 运行中',
    starting: 'Gateway 启动中...',
    started: 'Gateway 已启动',
    stopped: 'Gateway 已停止',
    stopFailed: 'Gateway 停止失败',
    startFailed: 'Gateway 启动失败',
    foreign: 'Gateway 被外部实例管理',
    claimAvailable: '可认领',
  },
  ws: {
    title: 'WebSocket 连接',
    connecting: '正在连接...',
    handshaking: '握手认证中...',
    connected: '已连接',
    ready: '已就绪',
    disconnected: '连接已断开',
    reconnecting: '第 {attempt} 次重连中...',
    reconnectSuccess: '重连成功',
    reconnectFailed: '重连失败',
    reconnectingAttempt: '正在重连 ({attempt}/{max})',
    heartbeatTimeout: '心跳超时，即将重连',
    giveUp: '已停止重连',
  },
  timeAgo: {
    justNow: '刚刚',
    secondsAgo: '{n}秒前',
    minutesAgo: '{n}分钟前',
    hoursAgo: '{n}小时前',
  },
})
```

## 设计风格

保持与现有项目一致的极简主义风格，使用现有 CSS 变量体系（--bg-primary、--border、--text-secondary、--success、--warning、--error、--info）。通知容器固定定位在右下角（与 toast 的右上角错开），采用卡片叠加的层次效果，每组通知使用半透明白底+毛玻璃效果，三类通知使用左侧色条区分（Guardian=蓝色、Gateway=绿色、WS=橙色）。

## 页面规划

**单页面组件设计** — StatusNotification 作为全局覆盖层组件，在所有页面之上展示。

### 通知容器

- 固定定位 `bottom: 16px; right: 16px; z-index: 9998`
- 最大宽度 380px，每类通知为独立折叠卡片
- 每张卡片包含：左侧色条（类别标识）+ 类别标题（含展开/折叠按钮）+ 当前活动状态行
- 卡片默认展开显示最新状态，30秒无更新自动折叠为最小化标题行
- 新通知出现时卡片"弹入"动画（slideInUp）

### 三类通知卡设计

1. **Guardian (蓝色色条 #3B82F6)**：显示守护运行状态、自动修复进度、重启尝试计数
2. **Gateway (绿色色条 #10B981)**：显示启动进度、运行状态、异常信息
3. **WS (橙色色条 #F59E0B)**：显示连接状态、重连尝试次数(进度条或数字)、持续时长

### 交互方式

- 点击卡片标题行展开/折叠
- 每条通知右侧有关闭按钮(x)
- 新通知自动展开，3秒后自动收起
- 鼠标悬停暂停自动收起计时器