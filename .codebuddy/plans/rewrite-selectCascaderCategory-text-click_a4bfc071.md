---
name: rewrite-selectCascaderCategory-text-click
overview: 参照 recorded.js 最新交互模式，将 selectCascaderCategory 从 checkbox 点击改为纯文字点击，简化逻辑并匹配真实 UI 行为。
todos:
  - id: rewrite-selectCascader
    content: 重写 selectCascaderCategory：移除 checkbox 操作，改为按 CATEGORY_CONFIG.second 精确点击二级文字
    status: completed
---

## 用户需求

重写 `selectCascaderCategory` 函数，基于 `recorded.js` 已验证的"点击文字即勾选"交互模式，按 `CATEGORY_CONFIG` 精确选择一级和二级类目。

## 核心功能

- 打开级联选择器弹出面板
- 遍历 `CATEGORY_CONFIG`，对每组类目：
- 点击一级类目文字展开二级列
- 按 `second` 数组逐个点击二级类目文字完成勾选
- 关闭弹出面板

## 技术栈

- 目标文件：`scripts/yuntu-login.js`
- 技术：Playwright 原生 Locator API
- 保留：`escapeRegex` 辅助函数（第61-63行）

## 实现方案

### 核心变更

基于 `recorded.js` 最新验证模式，该级联选择器的交互为**点击文字即勾选**，完全不需要操作 `.commodity-checkbox-icon`：

| 操作 | 旧实现（错误） | 新实现（recorded.js 验证） |
| --- | --- | --- |
| 一级类目 | `div.filter({hasText})` + `.commodity-checkbox-icon` 点击 | `div.filter({hasText: /^name$/}).first().click()` |
| 二级类目 | 点击所有 `.commodity-checkbox-icon` | 按 `second[]` 逐个 `div.filter({hasText: /^name$/}).first().click()` |
| checkbox 操作 | ❌ `.commodity-list-item-container-level-1/2 .commodity-checkbox-icon` | ✅ 完全移除 |


### 关键细节

1. **正则转义**：二级类目名如 `电动车/配件/交通工具` 含 `/` 字符，需经 `escapeRegex` 转义后嵌入 `new RegExp(^${escaped}$)`
2. **`.first()` 限定**：避免匹配到 popover 外的同名元素
3. **等待时间**：一级展开后 `waitForTimeout(800)` 等第二列渲染；二级每次点击后 `150ms` 间隔防连点
4. **弹面板管理**：保持一次打开 → 连续操作 → 最后关闭的模式

### 代码结构

```
selectCascaderCategory(page, cascaderIndex)
  ├── 空配置检查 → return false
  ├── 打开 popover（trigger.click + waitForSelector）
  ├── for each CATEGORY_CONFIG entry:
  │   ├── 点击一级文字（div.filter regex）→ 等待渲染
  │   └── for each second[] item:
  │       └── 点击二级文字（div.filter regex）→ 短暂等待
  ├── 关闭 popover（trigger.click）
  └── return anySelected
```

### 目录结构

```
scripts/
└── yuntu-login.js          # [MODIFY] 重写 selectCascaderCategory 函数（第969-1064行）
                             #   - 移除所有 .commodity-checkbox-icon 相关代码
                             #   - 一级点击保留 div.filter({hasText}) 模式
                             #   - 二级遍历 second[] 数组，逐项 click
                             #   - 保留 escapeRegex、popover 打开/关闭逻辑不变
```