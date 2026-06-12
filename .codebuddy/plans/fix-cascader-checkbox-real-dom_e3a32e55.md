---
name: fix-cascader-checkbox-real-dom
overview: 修复一级类目选择：放弃不存在的 CSS 类名，改用 recorded.js 验证过的 div.filter({hasText}) 定位文本元素，然后尝试点击其关联的 checkbox/label（多策略回退），避免面板关闭。
todos:
  - id: rewrite-level1-selection
    content: 重写一级类目选择：用 div.filter({hasText}) 找文本 → XPath 同级定位 input[type="checkbox"] / label → 回退文本点击，三个策略依次尝试
    status: completed
  - id: simplify-level2-selection
    content: 简化二级类目选择：仅保留 div.filter({hasText}) 模式，移除未验证的 .commodity-cascader-item-label 策略
    status: completed
    dependencies:
      - rewrite-level1-selection
  - id: fix-panel-detection
    content: 修复面板/二级列检测逻辑：移除 .commodity-list-item-container-level-2 虚构类名，用 popover.isVisible() 判断面板状态
    status: completed
    dependencies:
      - rewrite-level1-selection
  - id: add-debug-screenshot
    content: 添加失败调试截图：当一级或二级类目全部策略超时时，保存页面截图到 scripts/debug-cascader.png
    status: completed
  - id: verify-and-lint
    content: 验证 lint 无新增错误，确认完整函数结构正确
    status: completed
    dependencies:
      - rewrite-level1-selection
      - simplify-level2-selection
      - fix-panel-detection
      - add-debug-screenshot
---

## 问题

`selectCascaderCategory` 函数中使用的 CSS 类名（`.commodity-list-item-container-level-1`、`.commodity-checkbox-icon`、`.commodity-list-item-container-level-2`）在真实 DOM 中不存在，导致 locator 超时，无法勾选任何类目。

## 修复目标

用 `recorded.js` 已确认生效的 `div.filter({hasText})` 文本匹配模式重写一级和二级类目选择逻辑，并从文本元素出发尝试定位关联的 checkbox/input/label 来避免面板关闭，最终实现正确勾选一级类目并展开选择二级类目。

## 核心功能

1. 一级类目：按文本找到 div → 尝试点击同级 `input[type="checkbox"]` / `label` / 文本自身
2. 二级类目：按文本找到 div → 点击勾选
3. 失败时截图保存到 `scripts/debug-cascader.png` 辅助 DOM 分析
4. 移除所有虚构的 CSS 类名引用

## 技术方案

### 一级类目定位策略（列优先）

先用 `recorded.js` 验证的模式找到文本 div，再从其同级或父级中定位可点击的 checkbox/label：

```js
// 1. 找到文本 div（recorded.js 验证有效）
const textDiv = popover.locator('div').filter({ hasText: new RegExp(`^${escapeRegex(firstName)}$`) }).first();

// 2. 多策略尝试点击（优先 checkbox，避免面板关闭）
//    - 策略 A: 同级 input[type="checkbox"]（通用 checkbox 选择器）
//    - 策略 B: 同级 label（部分组件用 label 包装）
//    - 策略 C: 文本 div 本身（fallback）
```

**原理**：在级联选择器中，checkbox 通常和标签 div 处于同一个容器层级。用 Playwright 的 `locator('..').locator(...)` 或 XPath `following-sibling` / `preceding-sibling` 来关联。

具体实现使用 Playwright 的 `locator()` 链式调用配合 `:has()` 或 XPath 同级定位：

- `textDiv.locator('xpath=preceding-sibling::label')` 或 `textDiv.locator('xpath=../input[@type="checkbox"]')`
- 每个策略 `timeout: 3000`，任一成功即 break

### 二级类目定位策略

仅使用 `recorded.js` 确认的模式 `div.filter({hasText})`，移除 `.commodity-cascader-item-label` 策略：

```js
popover.locator('div').filter({ hasText: new RegExp(`^${escapeRegex(l2Name)}$`) }).first()
```

### 面板与二级列检测

移除对 `.commodity-list-item-container-level-2` 的依赖，改为检测 popover 内是否存在与一级类目文本 div 同级的可展开子项（通过 `popover.isVisible()` + hover/click 后等待新增 div 渲染来间接判断）。

### 截图调试

失败时截图到 `scripts/debug-cascader.png`（复用 `DEFAULT_SCREENSHOT_PATH` 所在目录）：

```js
await page.screenshot({ path: resolve(__dirname, 'debug-cascader.png'), fullPage: false });
```

## 修改范围

仅 `scripts/yuntu-login.js` 第 991-1057 行（`selectCascaderCategory` 函数体内 for 循环部分）。