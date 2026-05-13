---
name: fix-chat-send-btn
overview: 修复 chat-send-btn 发送消息失效的问题，主要涉及按钮初始化状态管理和重连后的状态同步。
todos:
  - id: fix-chat-send-btn
    content: 在 chat.js 的 render()、onReady、onStatusChange、Gateway直接复用路径 四个位置添加 updateSendState() 调用
    status: completed
---

## 需求

修复 `chat-send-btn` 发送按钮在点击时无响应的 Bug。

## 核心问题

1. **按钮初始化时未更新状态**：按钮 HTML 模板以 `disabled` 属性初始化，但 `updateSendState()` 在页面初始化时从未被调用。按钮保持禁用状态，而浏览器禁用状态的 button 不会触发 click 事件。

2. **Gateway 就绪后未更新按钮状态**：`connectGateway()` 成功后，`onReady` 回调和 `onStatusChange('ready')` 回调均未调用 `updateSendState()`，按钮状态与连接状态不同步。

## 修复方案

在以下三个关键节点添加 `updateSendState()` 调用：

- render 初始化末尾（加载完成后立即更新一次状态）
- onReady 回调（Gateway 握手成功后）
- onStatusChange('ready') 回调（连接状态变为就绪时）
- Gateway 已就绪直接复用路径

确保按钮禁用/启用状态始终与输入内容和连接状态保持同步。

## 技术方案

### 实现方案

在 `chat.js` 中的三个（四个）关键位置添加 `updateSendState()` 调用，确保按钮状态在页面初始化、Gateway 连接成功、连接状态变更时被正确更新。

### 修改点详细说明

#### 1. render() 初始化末尾 — line 347 之前

在 `render()` 函数的末尾（`connectGateway()` 调用之后、`return page` 之前），添加 `updateSendState()` 调用。

**理由**：页面 DOM 创建完毕、事件绑定完成、所有模块变量就绪后，需要立即根据 textarea 当前内容和附件状态更新按钮禁用/启用状态。这是确保按钮初始状态正确的最基础修复。

#### 2. onReady 回调 — line 1229 附近

在 `_unsubReady = wsClient.onReady(...)` 回调函数末尾（`refreshSessionList()` 之后），添加 `updateSendState()` 调用。

**理由**：Gateway 握手成功后，`_sessionKey` 已设置（或从 localStorage 恢复），此时按钮需要根据 Gateway 是否就绪来更新状态。虽然当前 `updateSendState()` 不直接检查 gatewayReady，但这是连接状态同步的合理时机，为将来可能的增强（如 Gateway 未就绪时禁用按钮）提供准备。

#### 3. onStatusChange('ready') 回调 — line 1181

在 `onStatusChange` 回调的 `status === 'ready' || status === 'connected'` 分支内（line 1181-1186），添加 `updateSendState()` 调用。

**理由**：当连接状态变为 ready 或 connected 时，按钮应可被启用。此回调在 Gateway 重连/状态恢复时也会触发，确保按钮状态在连接恢复后同步。

#### 4. Gateway 已就绪直接复用路径 — line 1245 附近

在 `connectGateway()` 中 `if (wsClient.connected && wsClient.gatewayReady)` 分支（line 1238-1246）末尾，添加 `updateSendState()` 调用。

**理由**：当访问聊天页面时 Gateway 已经就绪（复用已有连接），此路径跳过了 onReady 回调，需要单独确保按钮状态更新。

### 不修改的代码

- `updateSendState()` 函数本身的逻辑（line 2925-2936）不做改动，保持其根据 textarea 内容和附件状态判断按钮禁用/启用的行为
- `sendMessage()` 函数（line 1640-1656）不做改动，保持其 Gateway 就绪检查和 toast 提示逻辑

### 性能与安全

- `updateSendState()` 仅操作 DOM 属性，无性能影响
- 修改仅限于 chat.js 文件，无额外安全风险
- 无新增依赖

### 目录结构

```
src/pages/chat.js  [MODIFY] 在 4 个位置添加 updateSendState() 调用
```

### 具体修改位置

| 位置 | 行号 | 添加内容 |
| --- | --- | --- |
| render() 末尾 | line 346-347 | `updateSendState()` |
| onStatusChange('ready') | line 1181-1186 | `updateSendState()` |
| onReady 回调末尾 | line 1229 | `updateSendState()` |
| Gateway 已就绪复用路径 | line 1245 | `updateSendState()` |


## Agent Extensions

### SubAgent

- **code-explorer**: 已在探索阶段使用，用于跨文件搜索和分析 button 事件绑定、CSS 样式、状态更新调用链等。无需在执行阶段再次使用。