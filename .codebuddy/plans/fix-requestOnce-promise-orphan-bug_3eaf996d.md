---
name: fix-requestOnce-promise-orphan-bug
overview: 修复 _requestOnce 中外层 Promise 未连接到内层 Promise 的 bug，导致 chatSend await 永不完结、finally 不执行
todos:
  - id: fix-promise-chain
    content: 在 _requestOnce 中内层 Promise 后添加 .then(resolve, reject) 一行，修复 Promise 链接断裂
    status: completed
---

## 需求

修复 `doSend()` 函数中 `finally` 块不执行的问题。当前现象：

- 用户发送消息后，`_isSending` 保持 `true`，发送按钮卡在禁用状态
- `chat.js:1684` `_isSending = false`（位于 `finally` 块）从未被执行
- 消息实际上已成功发送到服务端，但 UI 状态无法恢复

## 根因

`src/lib/ws-client.js` 的 `_requestOnce()` 方法存在 Promise 链接断裂：外层 Promise（被 `await`）的 `resolve` 未连接到成功回调路径，导致 `await wsClient.chatSend()` 永久 pending，`try/catch/finally` 均不执行。

## 技术方案

### 修复方案

仅修改 `src/lib/ws-client.js`，在 `_requestOnce()` 方法中为内层 Promise 添加 `.then(resolve, reject)` 管道。

### 修改内容

**文件**: `src/lib/ws-client.js` 第 815 行后

```
       const promise = new Promise((res, rej) => {
         this._pending.set(id, { resolve: res, reject: rej, timer, dedupKey })
       })
+      promise.then(resolve, reject)
       this._pendingRequests.set(dedupKey, promise)
```

### 变更影响

改动量 1 行，影响 `_requestOnce` 的所有调用方（`chatSend`、`chatHistory`、`sessions.delete` 等共 16 个调用点），均从中受益：

| 路径 | 之前行为 | 修复后行为 |
| --- | --- | --- |
| 服务端响应成功 | 内层 Promise resolve，外层 Promise 永久 Pending | 内层 → `resolve` → 外层 resolve → `await` 返回 → `finally` 执行 |
| 服务端返回错误 | 内层 Promise reject，外层 Promise 永久 Pending | 内层 → `reject` → 外层 reject → `catch` → `finally` 执行 |
| 请求超时 (30s) | 定时器 `reject` 外层 Promise → `catch` → `finally` | 不变（不受影响） |
| 请求去重 | `.then(resolve).catch(reject)` 正确管道 | 不变（不受影响） |
| 等待重连 | `this.request().then(resolve, reject)` 正确管道 | 不变（不受影响） |


### 兼容性

- 标准 JavaScript Promise 语义：`finally` 在 try/catch 之后始终执行，除非 Promise 永不 settle
- 修复后所有路径均能正确 settle，无破坏性变更

# Agent Extensions

无需使用扩展