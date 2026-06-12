---
name: fix-yuntu-cascader-category-selection
overview: 修复 selectCascaderCategory 函数中类目选择失败的问题：修复类名选择器、替换 dispatchEvent 为原生 MouseEvent、补充缺失的 triggerLocator 变量
todos:
  - id: fix-selectCascaderCategory
    content: 修复 selectCascaderCategory 函数：定义 triggerLocator，用 page.evaluate + 原生 MouseEvent 替换 dispatchEvent 选择类目，修正 checkbox 类名
    status: completed
---

修复 `yuntu-login.js` 中 `selectCascaderCategory` 函数的自动类目选择功能

**当前问题**: cascader 弹出面板已能成功打开，但类目始终无法被选中（"缺少选中的类目"）

**根本原因**:

1. `triggerLocator` 变量未定义，关闭 popover 时抛 ReferenceError
2. `dispatchEvent('click')` 无法触发 React 事件，和之前 cascader 打开问题的根源一致
3. 一级类目使用错误的 CSS 类名 `.commodity-cascader-item-container`，类目无法被定位
4. 二级类目 checkbox 使用错误的类名 `.commodity-cascader-item-checkbox`，实际是 `.commodity-checkbox-icon`

**修复目标**: 让所有 CATEGORY_CONFIG 中配置的一级类目被点击选中、二级类目 checkbox 被勾选

## 技术方案

### 核心思路

沿用之前成功修复 cascader 打开问题的策略：在 `page.evaluate()` 上下文内用文本查找元素 + 分发原生 `MouseEvent` 序列（mousedown→mouseup→click）。这完全绕开了 CSS 类名不匹配和 `dispatchEvent('click')` 不可用这两个核心问题。

### 需修改的文件

`c:/work/clawpanel-main/clawpanel-main/clawpanel-main/scripts/yuntu-login.js`

### 具体修改点

#### 1. 添加 `triggerLocator` 定义

在 `selectCascaderCategory` 函数开头（popoverLocator 旁边），添加：

```js
const triggerLocator = page.locator('.commodity-cascader-multiple-input-trigger').nth(cascaderIndex);
```

用于后续关闭 popover（第1166-1171行）。

#### 2. 重构一级类目选择 (第1095-1122行)

将整个 `2a` 区块用 `page.evaluate()` + 文本匹配替换：

- 在 page.evaluate 内部遍历 `.commodity-cascader-column` 下的所有元素
- 通过 `textContent.trim() === firstName` 做精确匹配
- 分发 `mousedown + mouseup + click` 事件序列（带 `bubbles:true, clientX/Y`）
- 返回是否找到并点击成功

#### 3. 重构二级类目勾选 (第1134-1162行)

将 `2b` 区块用 `page.evaluate()` + 文本匹配 + checkbox 查找替换：

- 在 page.evaluate 内部定位第二列后，找到文本匹配的二级类目行
- 在该行内查找 `.commodity-checkbox-icon` 子元素
- 分发完整 MouseEvent 序列
- 返回是否勾选成功

#### 4. 关闭 popover 使用 `.click()`

```js
await triggerLocator.click({ timeout: 3000 });  // 替换 dispatchEvent('click')
```

### 函数完整改造设计

```
selectCascaderCategory()
├── 打开 popover (已修复，不变)
├── waitFor commodity-cascader-column (不变)
├── 遍历 CATEGORY_CONFIG (循环结构不变)
│   ├── page.evaluate() → 点击一级类目 (文字匹配 + MouseEvent)
│   │   ├── 查找: column 内 textContent 精确匹配 firstName 的元素
│   │   └── 事件: mousedown → mouseup → click
│   ├── waitFor 第二列出现 (不变)
│   └── page.evaluate() → 勾选二级类目 checkbox
│       ├── 查找: 第二列内包含 name 文本的行
│       ├── 在该行内找 .commodity-checkbox-icon
│       └── 事件: mousedown → mouseup → click
└── 关闭 popover: triggerLocator.click()
```

### 性能与可靠性

- `page.evaluate()` 在浏览器上下文中同步执行，每次调用约 5-50ms
- 精确文本匹配避免 CSS 类名依赖，运行时更健壮
- 完整 MouseEvent 序列确保 React/TDesign 的事件系统能正确响应

### 技术债务

- 沿用已有的 `page.evaluate()` + `MouseEvent` 模式，没有引入新模式
- 移除了所有不正确的 CSS 类名依赖，未来 DOM 变更时只需修改 evaluate 内部逻辑