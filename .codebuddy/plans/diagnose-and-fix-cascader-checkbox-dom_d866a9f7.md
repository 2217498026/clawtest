---
name: diagnose-and-fix-cascader-checkbox-dom
overview: 诊断真实 DOM 结构并修复一级 checkbox 定位：通过 evaluate() 获取文本元素上级 HTML，扩展 checkbox 搜索范围到上级/同级/跨级，并尝试 Ctrl+click 多选模式。
todos:
  - id: add-dom-diagnose
    content: 在策略遍历前添加 DOM 诊断：用 evaluate() 打印文本元素父级和祖父级 outerHTML（截断 300 字符）
    status: completed
  - id: extend-strategies
    content: 扩展策略数组从 3 到 6：增加 grandparent-checkbox、grandparent-label、ctrl-click-text
    status: completed
    dependencies:
      - add-dom-diagnose
  - id: add-ctrl-click
    content: 支持 Ctrl+click：策略结构增加 clickOpts 字段，点击时合并 { timeout, ...clickOpts }
    status: completed
    dependencies:
      - extend-strategies
  - id: verify-lint
    content: 验证 lint 无新增错误，确认完整函数结构正确
    status: completed
    dependencies:
      - extend-strategies
      - add-ctrl-click
---

## 问题

一级类目只能通过文本点击选中（checkbox/label 策略均超时），但文本点击后弹出面板关闭，无法继续选择二级类目。

## 根因

`l1Text.locator('..').locator('input[type="checkbox"]')` 失败 — checkbox 不在文本 div 的直接父级内。真实 DOM 结构未知，需要诊断。

## 修复目标

1. 在点击前用 `evaluate()` 打印文本元素的父级/祖父级 HTML 片段，辅助定位真实 DOM
2. 扩展策略从 3 个到 6 个，覆盖上两级 input/label、Ctrl+click 多选、文本回退
3. 确保至少有一种策略能找到 checkbox 并避免面板关闭

## 技术方案

### 修改范围

仅 `scripts/yuntu-login.js` 第 993-1025 行（`selectCascaderCategory` 函数 for 循环体的一级类目选择 + 面板检测部分）。

### 6 策略优先级设计

策略按"最可能避免面板关闭"到"回退"排列：

| 序号 | 策略名 | locator | 说明 |
| --- | --- | --- | --- |
| 1 | `parent-checkbox` | `l1Text.locator('..').locator('input[type="checkbox"]').first()` | 直接父级 checkbox（已有） |
| 2 | `grandparent-checkbox` | `l1Text.locator('..').locator('..').locator('input[type="checkbox"]').first()` | 上两级 checkbox（新增） |
| 3 | `parent-label` | `l1Text.locator('..').locator('label').first()` | 直接父级 label（已有） |
| 4 | `grandparent-label` | `l1Text.locator('..').locator('..').locator('label').first()` | 上两级 label（新增） |
| 5 | `ctrl-click-text` | `l1Text` + `{ modifiers: ['Control'] }` | Ctrl+点击文本，多选模式可能不关闭面板（新增） |
| 6 | `click-text` | `l1Text` | 纯文本点击回退（已有） |


### DOM 诊断

在策略遍历前，用 `evaluate()` 获取文本元素父级和祖父级的 `outerHTML`（截断到 300 字符），打印到日志：

```js
const parentHTML = await l1Text.locator('..').evaluate(el => el.outerHTML.slice(0, 300)).catch(() => 'N/A');
const grandparentHTML = await l1Text.locator('..').locator('..').evaluate(el => el.outerHTML.slice(0, 300)).catch(() => 'N/A');
LOG.debug(`[${idx + 1}] 父级 HTML: ${parentHTML}`);
LOG.debug(`[${idx + 1}] 祖父级 HTML: ${grandparentHTML}`);
```

### Ctrl+click 实现

```js
{ name: 'ctrl-click-text', locator: () => l1Text, clickOpts: { modifiers: ['Control'] } }
```

### 策略结构微调

将 `strategies` 数组的元素从 `{ name, locator }` 扩展为 `{ name, locator, clickOpts? }`，点击时合并 options：

```js
await s.locator().click({ timeout: 3000, ...(s.clickOpts || {}) });
```

### 面板检测不变

保持 `popover.isVisible()` 检测逻辑不变。

### 无新增依赖

复用已有 `escapeRegex`、`LOG`、`resolve`、`__dirname`。