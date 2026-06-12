---
name: fix-clear-cascader-tags-not-all-found
overview: 修复 clearCategoryCascader 清除第二个 cascader 的 tag 时未找全的问题：重新查询 trigger 避免 stale ElementHandle + 扩展 popover 层 scope 搜索 .commodity-tag-close。
todos:
  - id: fix-clear-loop
    content: 修改 clearCategoryCascader 清除循环：每次迭代重新查询 trigger，增加 popover 回退和 page 兜底搜索
    status: completed
  - id: verify-lint
    content: 验证零新增 lint 错误
    status: completed
    dependencies:
      - fix-clear-loop
---

## 需求

修复 `clearCategoryCascader` 函数清除第二个级联选择器 tag 不全的问题。当前调用 `clearCategoryCascader(page, 1, false)` 后，第二个 cascader 的部分 tag 未被清除。

## 根因

1. **Stale ElementHandle**：`targetTrigger`（ElementHandle）在循环外只查询一次，点击一个 close 按钮后 DOM 更新使 handle 失效，后续循环中 `targetTrigger.$('.commodity-tag-close')` 返回空数组，导致提前 break
2. **Scope 太窄**：popover 打开时，`.commodity-tag-close` 可能渲染在 `.commodity-cascader-popover-wrapper` 内部，而非 `.commodity-cascader-multiple-input-trigger` 内部

## 产品概述

修改 `clearCategoryCascader` 函数的清除循环，确保每次迭代获取新鲜的 DOM 引用，并在 trigger scope 找不到时回退到 popover scope，最终以 page 级搜索兜底。

## 技术方案

### 修改文件

`scripts/yuntu-login.js` — 仅修改 `clearCategoryCascader` 函数内部的清除循环（第941-962行），不改动函数签名和调用处。

### 实现策略

**三级回退搜索策略**：

1. **主策略（循环内重新查询 trigger）**：每次循环从 `page.$('.commodity-cascader-multiple-input-trigger')` 重新获取触发器数组，取 `triggers[cascaderIndex]` 作为新鲜引用，在其内搜索 `.commodity-tag-close`
2. **回退策略（popover scope）**：若 trigger 内找不到，尝试在 `.commodity-cascader-popover-wrapper` 内搜索（此 popover 在调用 `clearCategoryCascader(page, 1, false)` 之前已被第854-857行的 `secondTrigger.click()` 打开）
3. **兜底策略（page scope + 过滤）**：若仍找不到，使用 `page.$('.commodity-tag-close')` 获取全部 close 按钮，通过 boundingBox 或 DOM 位置过滤出属于目标 cascader 的 tag

### 关键改动

| 项目 | 修改前 | 修改后 |
| --- | --- | --- |
| ElementHandle 生命周期 | 循环外查询一次，整个循环复用 | 每次迭代重新 `page.$$` 查询，始终保持新鲜引用 |
| 搜索 scope | 仅 `targetTrigger` 内部 | trigger → popover → page（三级回退） |
| 日志 | "已清除 N 个类目 tag" | 增加 scope 来源信息便于调试 |


### 性能考量

- 每次迭代重新 `page. 查询增加约 ~1ms 开销，10次循环最多 10ms，可忽略
- `dispatchEvent('click')` 跳过 Playwright 可见性检查，保持原有性能优势