---
name: add-purchase-modal-to-custom-skill
overview: 在 customSkill (opclskill) 卡片中添加"购买"按钮，点击弹出弹框，左右并排展示扫码支付和联系客服两个占位二维码。
design:
  architecture:
    framework: html
  styleKeywords:
    - 简洁
    - 居中
    - 对称
    - 毛玻璃遮罩
  fontSystem:
    fontFamily: inherit
    heading:
      size: 18px
      weight: 600
    subheading:
      size: 14px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#10b981"
    background:
      - var(--bg-secondary)
      - rgba(0,0,0,0.6)
    text:
      - var(--text-primary)
      - var(--text-secondary)
    functional:
      - var(--error)
todos:
  - id: add-purchase-modal
    content: 在 skills.js 中添加 showPurchaseModal() 函数，创建左右双栏 QR 占位弹框
    status: completed
  - id: add-purchase-button
    content: 在 renderSkillCard 的 isOpclSkill 动作区添加"购买"按钮，并在 bindEvents 中注册点击事件
    status: completed
    dependencies:
      - add-purchase-modal
---

## 功能描述

在 opclskill (customSkill) 技能卡片上添加一个"购买"按钮，点击后弹出居中弹框。弹框内左右并排展示两个二维码区域：左侧为"扫码支付"，右侧为"联系客服"。每个区域包含一个占位 QR 码图片（后续可替换为真实二维码）和下方清晰文字说明。弹框需有右上角关闭按钮，点击遮罩区域也可关闭。

## 核心功能

- 在 customSkill 卡片动作区添加"购买"按钮，样式醒目
- 点击按钮弹出模态弹框
- 弹框内左右并排展示两个二维码占位区域
- 每个区域下方有文字标注
- 弹框支持关闭（X 按钮 + 点击遮罩）

## 技术方案

### 技术栈

- 前端框架：原生 JavaScript + HTML/CSS（与项目现有技术一致）
- 弹框样式：复用项目中已有的 `.modal-overlay` / `.modal` CSS 类（components.css）
- 占位图方案：使用 `<div>` 模拟二维码占位块（200x200px，带背景色和文字），后续可替换为 `<img>` 真实二维码

### 实现方案

1. **renderSkillCard 修改**：在 `isOpclSkill` 的动作区（第 285-290 行）添加一个 `data-action="opclskill-purchase"` 的按钮，使用 `btn btn-primary` 样式
2. **新建 showPurchaseModal 函数**：参考现有 `showActivationModal` 模式，创建全屏遮罩弹框
3. **弹框布局**：左右两列（flex），各包含一个占位 QR 方块 + 下方文字标签
4. **bindEvents 扩展**：在 click switch 中添加 `case 'opclskill-purchase'` 分支

### 性能与可靠性

- 弹框为一次性 DOM 创建，关闭时移除，无内存泄漏
- 仅作用于 opclskill 卡片，不影响其他 skill 的渲染
- 使用 data-action 事件委托模式，与现有事件系统一致

### 避免技术债务

- 完全复用现有的 modal-overlay / modal CSS 类
- 遵循项目已有的 data-action 事件分发模式
- 不引入任何新的依赖或框架

## 设计风格

采用现代化简洁弹框设计。弹框整体使用白色/深色卡片背景，带毛玻璃遮罩效果。两个二维码区域左右对称排列，每个区域采用圆角卡片包裹，带有柔和的阴影和边框，下方文字居中清晰标注。整体风格与项目现有模态框保持一致。

## 页面规划

单页：仅购买弹框，无多页面。

## 弹框布局（单页块设计）

- **遮罩层**：全屏半透明黑色 + backdrop-filter 毛玻璃
- **弹框容器**：居中卡片，max-width: 520px，圆角
- **标题栏**："购买 opclskill" 左侧标题 + 右上角 X 关闭按钮
- **二维码双栏**：flex row，左右各占 50%，分别放置占位 QR 和文字标注
- **底部**：提示文字 "请使用微信/支付宝扫码"

## Agent 扩展

### SubAgent

- **code-explorer**: 用于在执行阶段搜索项目中现有的弹框关闭按钮样式、CSS 变量命名约定，确保新代码与项目风格一致。