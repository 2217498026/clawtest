---
name: implement-selectCascaderCategory-check-all-second
overview: 在 yuntu-login.js 中实现缺失的 selectCascaderCategory 函数：打开级联选择器弹出面板，遍历 CATEGORY_CONFIG 中的每个一级类目，点击后逐一点击第二列中所有可见的 checkbox 以勾选全部二级类目。
todos:
  - id: implement-select-cascader-function
    content: 在 yuntu-login.js 中 clearCategoryCascader 之后实现 selectCascaderCategory 函数：打开popover -> 遍历CATEGORY_CONFIG -> 点击一级类目（文本匹配MouseEvent） -> 全选二级checkbox -> 关闭popover
    status: completed
---

## 需求概述

### 核心功能

在 `yuntu-login.js` 中，`selectCascaderCategory(page, cascaderIndex)` 函数在第 841 行被调用但**从未定义实现**。现在需要实现此函数，其行为如下：

1. **清除级联选择器后**（由 `clearCategoryCascader` 完成，第 838 行）
2. **打开 cascader 弹出面板**
3. **遍历 CATEGORY_CONFIG**（保留原有 `{ first, second: [...] }` 结构，仅使用 `first` 字段）

- 对每个配置的一级类目，在面板第一列中找到并点击它
- 等待第二列渲染后，在该列中找到**所有可见的 `.commodity-checkbox-icon`**，逐一点击勾选

4. **关闭 cascader 弹出面板**
5. **继续执行后续的 `pauseForInteraction`**（第 843 行）

### 保留不变的部分

- `CATEGORY_CONFIG` 保留原有结构，`second` 数组作为参考注释
- `clearCategoryCascader` 和 `pauseForInteraction` 的调用位置和逻辑不变
- 函数签名 `(page, cascaderIndex = 0)`
- 所有现有的 LOG 日志格式和级别

### 背景

这是巨量引擎云图自动登录脚本的一部分，用于导航到"品类趋势参考"页面后自动选择类目，替代手动操作。

## 技术方案

### 技术栈

- 运行环境：Node.js (ES Module)，Playwright 浏览器自动化
- 目标文件：`scripts/yuntu-login.js`（单个文件修改）
- 交互方式：通过 Playwright Page 对象操作浏览器 DOM

### 实现策略

#### 核心思路

在 `page.evaluate()` 浏览器上下文中用文本查找元素 + 分发原生 MouseEvent 序列（mousedown → mouseup → click），该模式已在前面的 `clearCategoryCascader` 等函数中被验证可用。

#### 关键设计决策

**1. Popover 打开/关闭优化**

- 打开一次 popover，遍历所有 CATEGORY_CONFIG 条目，最后关闭一次
- 避免每处理一个一级类目就重复打开关闭 popover

**2. DOM 操作方式**

- 一级类目点击：用 `page.evaluate()` 在第一列 `.commodity-cascader-column` 中按 `textContent.trim() === firstName` 精确匹配，分发 MouseEvent
- 二级类目全选：用 `page.evaluate()` 在第二列 `.commodity-cascader-column` 中查找所有 `.commodity-checkbox-icon` 子元素，依次点击每个
- 使用 `page.locator().nth()` 替代 `page.$()[index]`

**3. 点击可靠性**

- 使用原生 MouseEvent 序列（mousedown, mouseup, click），带 `bubbles: true, cancelable: true, clientX/Y`
- 每个 checkbox 点击后等待 200ms 让 React 处理 DOM 更新

**4. 等待策略**

- popover 可见：`page.waitForSelector('.commodity-cascader-popover-wrapper', { state: 'visible', timeout: 5000 })`
- 一级点击后第二列出现：`page.waitForSelector` 等待第二列 DOM 出现
- 每次栏目选择后等待 300ms

**5. 容错处理**

- popover 打开失败 → LOG.warn 跳过整个流程
- 一级类目未找到 → LOG.warn 跳过该条目，继续处理下一个
- 第二列无 checkbox → LOG.warn 继续
- 整体 try-catch 保护，不影响后续 pauseForInteraction

### 性能

- popover 只打开/关闭各 1 次
- `page.evaluate()` 在浏览器上下文同步执行，每次约 5-50ms
- 每次 checkbox 点击后 200ms 等待，假设平均 5-15 个 checkbox，总等待 ~1-3s

### 文件修改

仅修改 `scripts/yuntu-login.js` 一个文件。

### 目录结构

```
scripts/
├── yuntu-login.js        [MODIFY] 在 clearCategoryCascader 函数（第 933 行）之后、checkSession（第 936 行）之前插入新函数
```

### 关键代码结构

新函数插在 `clearCategoryCascader` 和 `checkSession` 之间（第 934-935 行附近），编号延续现有风格为 `// 12d.`。

伪代码逻辑：

```
selectCascaderCategory(page, cascaderIndex = 0)
├── if CATEGORY_CONFIG 为空 → return false
├── 1. 打开 popover
│   ├── trigger = page.locator('.commodity-cascader-multiple-input-trigger').nth(cascaderIndex)
│   ├── trigger.dispatchEvent('click')
│   ├── waitForSelector('.commodity-cascader-popover-wrapper', visible)
│   └── waitForTimeout(500)
├── 2. 遍历 CATEGORY_CONFIG
│   for each entry:
│   ├── 2a. 点击一级类目
│   │   ├── page.evaluate(): 在 columns[0] 中找 textContent === entry.first 的行
│   │   ├── 分发 mousedown→mouseup→click MouseEvent 序列
│   │   └── LOG.ok / LOG.warn
│   ├── waitForTimeout(500) 等待第二列渲染
│   └── 2b. 勾选所有二级 checkbox
│       ├── page.evaluate(): 在 columns[1] 中找所有 .commodity-checkbox-icon
│       ├── 逐个分发 mousedown→mouseup→click 事件
│       └── LOG.ok / LOG.warn
├── 3. 关闭 popover
│   ├── trigger.dispatchEvent('click')
│   └── waitForTimeout(400)
└── return true
```