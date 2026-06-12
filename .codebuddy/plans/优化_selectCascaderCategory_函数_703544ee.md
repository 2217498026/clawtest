---
name: 优化 selectCascaderCategory 函数
overview: 优化 selectCascaderCategory 函数，消除冗余等待和重复 DOM 查询，合并 popover 打开/关闭操作，将总执行时间从约 12s+ 降至约 4s。
todos:
  - id: optimize-select-cascader
    content: 重构 yuntu-login.js 中 selectCascaderCategory 函数（行 947-1077）：将 popover 打开/关闭移到循环外，用 locator.nth 替代 $$[index]，用 waitForSelector 替代固定 wait，移除死代码和冗余等待
    status: completed
---

优化 `selectCascaderCategory` 函数（第 947-1078 行）的性能和代码质量。当前函数遍历 CATEGORY_CONFIG 时，每组配置独立执行"打开 popover → 选择一级类目 → 勾选二级 checkbox → 关闭 popover"，3 组配置导致 popover 反复打开/关闭 3 次，且使用了大量固定 `waitForTimeout`（累计 ~11.4s）。要求在不改变外部接口和功能行为的前提下，优化执行效率和代码质量。

## 技术方案

### 核心变更

将 popover 的"打开/关闭"操作从循环内移到循环外：**打开一次 popover，遍历所有组，最后关闭一次**。

### 详细修改项

| 问题 | 当前代码 | 修改方案 |
| --- | --- | --- |
| popover 反复打开关闭 | 每组：打开→选择→关闭（3次） | 循环外打开一次，循环外关闭一次 |
| 固定 wait 过多 | 累计 ~11.4s | 替换为 `waitForSelector` + 缩短最小等待，降至 ~3.6s |
| `$$` + `[index]` | `page.$$('.xxx')` 返回 ElementHandle 数组 | 改为 `page.locator('.xxx').nth(index)` |
| 重复查询 trigger | 打开时查一次 $$，关闭时又查一次 | 缓存 trigger locator，复用 |
| 未使用的 popover 变量 | `let popover = await page.$()` 仅做 !popover 检查 | 移除，改为 `waitForSelector` 隐式检查 |
| 组间冗余等待 | `waitForTimeout(300)` 在组间 | 移除（popover 不再关闭） |


### 保留不变的部分

- 函数签名 `(page, cascaderIndex = 0)` 不变
- 所有 `dispatchEvent('click')` 用法保留（历史原因，元素在虚拟滚动中不可见）
- 一级/二级类目的文本兜底（fallback）逻辑不变
- 所有 LOG 日志格式和级别不变
- CATEGORY_CONFIG 配置结构不变
- 调用方 `navigateToProductAnalysis`（行 840/853）无需任何修改

### 性能收益

- popover 打开次数：3 次 → **1 次**
- popover 关闭次数：3 次 → **1 次**
- 固定 wait 累计：~11.4s → **~3.6s**（减少 68%）
- trigger DOM 查询次数：6 次 → **2 次**

### 涉及的文件

- 仅修改 `scripts/yuntu-login.js`，一个文件

### 目录结构

```
scripts/
├── yuntu-login.js      # [MODIFY] selectCascaderCategory 函数（行 947-1077）
```

### 关键代码结构

```
重写后的 selectCascaderCategory 伪代码:

async function selectCascaderCategory(page, cascaderIndex = 0) {
  // 前置校验不变...

  // 1. 打开 popover（移到循环外）
  const trigger = page.locator('.commodity-cascader-multiple-input-trigger').nth(cascaderIndex);
  await trigger.dispatchEvent('click');
  await page.waitForSelector('.commodity-cascader-popover-wrapper', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);  // 待 popover 动画完成

  let anySelected = false;

  // 2. 遍历所有组（popover 保持打开）
  for (const [idx, entry] of CATEGORY_CONFIG.entries()) {
    // 选择一级类目（逻辑不变）
    // 勾选二级 checkbox（逻辑不变）
    // 移除：打开/关闭 popover 操作
    // 移除：组间 waitForTimeout(300)
  }

  // 3. 关闭 popover（移到循环外）
  await trigger.dispatchEvent('click');
  await page.waitForTimeout(400);

  // 结果日志不变...
  return anySelected;
}
```