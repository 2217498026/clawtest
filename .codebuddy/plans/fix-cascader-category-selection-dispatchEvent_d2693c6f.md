---
name: fix-cascader-category-selection-dispatchEvent
overview: 将 selectCascaderCategory 函数的 click 机制从 page.evaluate + dispatchEvent 改为 Playwright 原生 locator.click()，解决级联选择器勾选失效问题。
todos:
  - id: fix-selectCascaderCategory
    content: 重写 selectCascaderCategory 函数：使用 Playwright 原生 locator.click() 替代 dispatchEvent，修复 checkbox 勾选问题
    status: completed
---

## 需求描述

修复 `scripts/yuntu-login.js` 中的 `selectCascaderCategory` 函数，使其能正确勾选级联选择器的二级类目 checkbox。

### 问题分析

当前实现使用 `page.evaluate` + `dispatchEvent(new MouseEvent(...))` 来点击元素，存在以下问题：

1. **不触发 Playwright actionability 检查**：无法确保元素可见、稳定、不被遮挡
2. **React 合成事件不响应**：`dispatchEvent` 的原始事件可能无法触发 React 的 onClick 处理器
3. **Popover 内容切换不稳定**：快速点击多个一级类目时，第二列可能来不及重渲染

### 正确做法（基于 recorded.js 验证）

- 一级类目：`page.locator('div').filter({ hasText: /^name$/ }).first().click()` 或 `page.getByText(name).first().click()`
- 二级 checkbox：`page.locator('.commodity-checkbox-icon').click({ multiple: true })` 或遍历 `.all()` 后逐个点击
- 使用原生 `.click()` 确保 Playwright 等待元素就绪并正确触发事件

### 核心要求

- 遍历 `CATEGORY_CONFIG` 中配置的一级类目
- 点击每个一级类目后，勾选其二级类目的**所有** checkbox
- 保持 popover 打开状态完成所有选择，最后关闭

## 技术栈

- 目标文件：`scripts/yuntu-login.js`
- 技术：Playwright (已集成在项目中)
- 依赖：Playwright 原生 Locator API

## 技术方案

### 关键修改点

1. **替换点击方式**：从 `page.evaluate` + `dispatchEvent` 改为 `Playwright locator.click()`
2. **优化等待逻辑**：增加 React 渲染等待时间（1500ms）
3. **精确定位策略**：

- 一级类目：`page.getByText(firstName).first()`（限定 popover 内第一个匹配）
- 二级 checkbox：`page.locator('.commodity-checkbox-icon').all()` 获取所有，再逐个点击

### 代码设计

```javascript
// 伪代码结构
async function selectCascaderCategory(page, cascaderIndex) {
  // 1. 打开 popover
  await trigger.click();
  await page.waitForTimeout(1000);

  for (const entry of CATEGORY_CONFIG) {
    // 2. 点击一级类目
    const l1 = page.getByText(entry.first).first();
    await l1.click();
    await page.waitForTimeout(1500); // 等待第二列渲染

    // 3. 点击所有二级 checkbox
    const checkboxes = await page.locator('.commodity-checkbox-icon').all();
    for (const cb of checkboxes) {
      await cb.click();
      await page.waitForTimeout(100);
    }
  }

  // 4. 关闭 popover
  await trigger.click();
}
```

### 注意事项

- 使用 `.first()` 限定范围，避免匹配到 popover 外的同名元素
- 每次点击后添加短暂延迟，确保 React 状态更新完成
- 保持原有 LOG 输出格式不变