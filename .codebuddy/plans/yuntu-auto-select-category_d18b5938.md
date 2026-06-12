---
name: yuntu-auto-select-category
overview: 在 yuntu-login.js 中新增一级/二级类目数组配置和自动选择函数，在清除级联选择器后自动点击类目，再执行 pauseForInteraction 等待手动操作。
todos:
  - id: add-category-arrays
    content: 在脚本配置区（TIMEOUTS 之后）添加 CATEGORY_FIRST_LEVEL 和 CATEGORY_SECOND_LEVEL 数组变量，附带注释说明用法
    status: completed
  - id: add-select-function
    content: 在 clearCategoryCascader 函数之后新增 selectCascaderCategory 函数，实现打开弹出面板、按文本查找并点击一级/二级类目的逻辑
    status: completed
    dependencies:
      - add-category-arrays
  - id: modify-navigation
    content: 修改 navigateToProductAnalysis 函数，在 clearCategoryCascader 和 pauseForInteraction 之间插入 selectCascaderCategory 调用
    status: completed
    dependencies:
      - add-select-function
---

## 需求

在现有的云图自动登录脚本（yuntu-login.js）中，新增自动选择类目功能：

### 核心功能

1. **创建可配置的类目数组变量**：在脚本配置区添加一级类目数组变量 `CATEGORY_FIRST_LEVEL` 和二级类目数组变量 `CATEGORY_SECOND_LEVEL`，用户可自行修改数组内容来配置要选择的类目
2. **自动选择类目**：在清除级联选择器已选项（`clearCategoryCascader`）之后、手动暂停（`pauseForInteraction`）之前，自动执行：

- 打开类目选择器弹出面板
- 根据数组配置，在第一列中找到对应的一级类目并点击
- 等待第二列加载后，根据数组配置找到对应的二级类目并点击其复选框

3. **保留手动暂停**：`pauseForInteraction` 保留不动，自动选择在其之前完成

### 页面结构

- 级联选择器弹出面板：`.commodity-cascader-popover-wrapper`
- 两列布局：`.commodity-cascader-column`（第一列一级类目，第二列二级类目）
- 类目项：`.commodity-list-item-container.commodity-cascader-item-container`（使用 ReactVirtualized 虚拟列表渲染）
- 标签文本：`.commodity-cascader-item-label`
- 一级类目右侧有箭头图标 `.commodity-cascader-item-arrow`
- 二级类目有复选框 `.commodity-cascader-item-checkbox`

## 技术方案

### 技术栈

- 运行环境：Node.js（ES Module）
- 浏览器自动化：Playwright（已安装）
- 脚本类型：单一 JS 文件，ES Module 格式

### 实现方案

#### 总体策略

在现有 `yuntu-login.js` 中添加两个核心变更：

1. **配置常量的数组变量** — 放在脚本头部的配置区域（TIMEOUTS 常量之后），用户直接修改数组内容即可配置要选择的类目
2. **新增 `selectCascaderCategory` 函数** — 负责打开弹出面板、查找并点击一级类目和二级类目
3. **修改 `navigateToProductAnalysis`** — 在 `clearCategoryCascader` 和 `pauseForInteraction` 之间插入调用

#### 关键设计方案

**点击策略（ReactVirtualized 兼容性）：**

- 级联选择器使用 ReactVirtualized 虚拟列表，项目以 `position: absolute; top: Xpx` 定位，仅已渲染到视口内的项目有 DOM 元素
- 使用 `page.evaluate()` 在弹出面板内按文本查找匹配的类目项，用 `dispatchEvent(new MouseEvent('click', ...))` 触发点击
- 这种方式的优势：绕过 Playwright 自动滚动的不可靠性，直接在 ReactVirtualized 的事件处理层触发点击

**一级和二级类目的区分方法：**

- 一级类目（第一列）的项内有 `.commodity-cascader-item-arrow` 子元素（右箭头图标）
- 二级类目（第二列）的项内有 `.commodity-cascader-item-checkbox` 子元素（复选框）
- 但在实际实现中，按列索引区分更可靠：`columns[0]` 内找一级，`columns[1]` 内找二级

**容错处理：**

- 若未找到弹出面板 → 跳过，不影响后续流程
- 若指定类目未找到 → 日志警告，继续执行
- 若数组为空 → 跳过选择过程，直接进入 pauseForInteraction

**性能考虑：**

- 每次点击后 await 300-500ms 等待 React 组件重新渲染
- 选择完成后按 Escape 关闭弹出面板
- 循环重试次数限制（一级最多 5 次尝试，二级最多 5 次尝试）

### 目录结构

```
c:/work/clawpanel-main/clawpanel-main/clawpanel-main/scripts/
└── yuntu-login.js  [MODIFY]
    ├── 配置区新增：CATEGORY_FIRST_LEVEL / CATEGORY_SECOND_LEVEL 数组变量
    ├── 新增函数：selectCascaderCategory()
    └── 修改函数：navigateToProductAnalysis()
```

### 执行计划中的注意事项

- 修改前需确认当前文件没有未保存的变更
- CATEGORY_SECOND_LEVEL 与 CATEGORY_FIRST_LEVEL 按索引一一对应配对
- `clearCategoryCascader` 执行后弹出面板可能已关闭，`selectCascaderCategory` 需先尝试重新打开
- 选择完成后关闭弹出面板，再进入 pauseForInteraction