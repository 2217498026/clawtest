---
name: fix-selectCascaderCategory-checkbox-by-text
overview: 修复一级类目 checkbox 勾选逻辑：将 `.nth(idx)` 索引定位改为按文本名称匹配定位，确保始终勾选正确的类目。
todos:
  - id: fix-checkbox-locator
    content: 将第 997-998 行 .nth(idx) 改为按 firstName 文本匹配 level-1 容器后取其 checkbox
    status: completed
---

## 问题描述

`selectCascaderCategory` 函数第 997 行使用 `.nth(idx)` 按 DOM 索引选择 checkbox，而非按类目名称 `firstName` 匹配。当 CATEGORY_CONFIG 配置的类目（如"运动户外"）在 popover 中的位置不是第 0 个时，会勾选错误的类目。

## 修复目标

将 checkbox 定位从索引匹配改为文本匹配：先通过 `firstName` 文本找到对应的 level-1 容器，再从容器内获取其 checkbox 图标并点击。

## 修改范围

仅修改 `scripts/yuntu-login.js` 第 997-998 行。

## 修改方案

### 修改前（第 997 行）

```javascript
const l1Checkbox = popover.locator('.commodity-list-item-container-level-1 .commodity-checkbox-icon').nth(idx);
```

### 修改后

```javascript
const l1Item = popover.locator('.commodity-list-item-container-level-1').filter({ hasText: firstName }).first();
const l1Checkbox = l1Item.locator('.commodity-checkbox-icon');
```

### 原理

1. `popover.locator('.commodity-list-item-container-level-1').filter({ hasText: firstName })` — 在 popover 内找到所有 level-1 容器，按文本内容匹配 `firstName`
2. `.first()` — 取第一个匹配项（一个名称通常只有一个匹配）
3. `l1Item.locator('.commodity-checkbox-icon')` — 从匹配到的容器内查找其 checkbox 图标

### 不变部分

- `await l1Checkbox.click({ timeout: 5000 })` — 点击操作不变
- 后续面板检测逻辑（二级列等待、面板关闭检测）完全不变
- 二级类目勾选逻辑完全不变

### 影响分析

- 无破坏性变更，仅将选择器从索引定位改为语义定位
- 已有的 `catch` 块会捕获"未找到元素"异常并记录日志，无需额外错误处理