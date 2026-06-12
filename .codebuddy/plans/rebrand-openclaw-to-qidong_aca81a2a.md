---
name: rebrand-openclaw-to-qidong
overview: 将 ClawPanel 软件默认图标替换为 QDbot logo2.png，并将所有 UI/配置/界面中的品牌文字"OpenClaw"全局替换为"擎动未来AI电商"，同时保留技术标识符和外部引用不变。
todos:
  - id: replace-icons
    content: 使用 npx tauri icon 命令从 QDbot logo2.png 生成所有平台图标格式，替换现有图标文件
    status: completed
  - id: replace-config-metadata
    content: 替换 tauri.conf.json、package.json、Cargo.toml 中的产品名称和描述文字
    status: completed
  - id: replace-html-branding
    content: 替换 index.html 中 title 和启动屏品牌名
    status: completed
  - id: replace-mainjs-branding
    content: 替换 src/main.js 中登录界面标题、授权码界面标题、移动端顶栏标题和更新横幅中的 OpenClaw 文字
    status: completed
  - id: replace-aboutjs-branding
    content: 替换 src/pages/about.js 中描述本软件的 OpenClaw 品牌文字（副标题），保留外部项目引用
    status: completed
  - id: verify-and-rebuild
    content: 验证所有替换完整性，执行 npm run tauri build 确认新图标和文字生效
    status: completed
    dependencies:
      - replace-icons
      - replace-config-metadata
      - replace-html-branding
      - replace-mainjs-branding
      - replace-aboutjs-branding
---

## 用户需求

### 图标替换

将 ClawPanel 软件当前使用的默认图标替换为 `src-tauri/icons/QDbot logo2.png`，通过 `tauri icon` 命令自动生成所有平台格式（.icns、.ico、各尺寸 .png），确保图标清晰无失真。

### 品牌文字全局替换

将软件界面及标题栏中的 "OpenClaw" 品牌文字全局替换为 "擎动未来AI电商"，涵盖窗口标题、登录界面、启动屏、移动端顶栏、关于页面标题、配置文件元数据等。替换仅针对**本软件自身的品牌标识**，不影响对 OpenClaw CLI/后端外部工具的引用、服务标识符和文件路径。

### 替换范围

- **必须替换**：窗口标题、登录页标题、启动屏名称、移动端顶栏标题、更新横幅文字、关于页副标题、tauri.conf.json 的 productName 和 window.title、package.json 的 name/description、Cargo.toml 的 description
- **不替换**：服务标识符 `ai.openclaw.gateway`、文件路径 `~/.openclaw/`、Rust 代码中的函数/变量名、GitHub 仓库 URL、README 文档
- **谨慎处理**：i18n 文件中引用外部 OpenClaw CLI 工具的文字保持不变，仅替换本软件自身品牌描述的文字

## 技术方案

### 图标生成策略

使用 Tauri CLI 内置的 `tauri icon` 命令，从单一高分辨率源图 `QDbot logo2.png` 自动生成所有平台所需格式：

- **输入**：`src-tauri/icons/QDbot logo2.png`
- **输出**：`icons/32x32.png`、`icons/128x128.png`、`icons/128x128@2x.png`、`icons/icon.icns`、`icons/icon.ico` 以及所有衍生尺寸
- **命令**：`npx tauri icon "src-tauri/icons/QDbot logo2.png" -o src-tauri/icons`

注意：`tauri icon` 会同时生成 Android/iOS/Windows Store 图标，但这些都是平台所需的衍生文件，保留不影响体积。

### 文字替换策略

采用**上下文感知的精准替换**，区分本软件品牌文字与外部工具引用：

| 上下文 | "OpenClaw" 含义 | 是否替换 |
| --- | --- | --- |
| `productName`、窗口标题、登录标题 | 本软件名称 | 是 → 擎动未来AI电商 |
| `tauri.conf.json` `identifier` | 套件技术标识符 | 否（会改变 OS 层级应用身份） |
| `ai.openclaw.gateway` | 服务标识符 | 否（会影响服务管理功能） |
| i18n 中的 CLI 安装/搜索文字 | 指代 OpenClaw CLI 工具 | 否（外部工具引用） |
| i18n 中描述本面板的文字 | 本软件描述 | 是 |


### 性能与可靠性

- 图标生成是离线操作，不影响运行时性能
- 文字替换仅在源代码层面进行，不引入运行时逻辑
- `tauri icon` 使用 ImageMagick（非 sharp）生成 .icns（支持 sips_icns 和 icns 两种模式），兼容性好
- 替换后需重新编译（`npm run tauri build`），旧版构建产物会保留新图标和文字

### 回滚策略

所有替换均为文本/文件操作，通过 `git diff` 可清晰审查变更，必要时通过 `git checkout -- <file>` 逐文件回滚。