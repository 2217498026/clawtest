---
name: opclskill-rar-download-extract
overview: 在 skills.js 中完成 opclskill 激活后的 SkillCt 调用 + RAR 下载解压流程，并在 Rust 侧新增 unrar 解压命令
todos:
  - id: add-unrar-dependency
    content: 在 src-tauri/Cargo.toml 中添加 unrar crate 依赖（unrar = "0.6"）
    status: completed
  - id: add-rust-command
    content: 在 src-tauri/src/commands/skills.rs 中新增 download_and_extract_rar 异步命令：用 reqwest 下载 RAR 到临时文件，用 unrar 解压到目标目录，清理临时文件
    status: completed
    dependencies:
      - add-unrar-dependency
  - id: register-and-expose
    content: 在 src-tauri/src/lib.rs 注册新命令到 invoke_handler；在 src/lib/tauri-api.js 新增 downloadAndExtractRar(url, targetDir) 方法
    status: completed
    dependencies:
      - add-rust-command
  - id: modify-activation
    content: 修改 showActivationModal 中 SkillRq 成功后的回调：调用 SkillCt({code, CreateTime:null, name:'skill123'})，成功则下载解压 RAR + 保存 skillctlasttime
    status: completed
    dependencies:
      - register-and-expose
  - id: modify-loadskills
    content: 修改 loadSkills 中 SkillRq 验证之后：读取 skillctlasttime，调用 SkillCt({code, CreateTime:skillctlasttime, name:'skill123'})，成功则下载解压覆盖 + 更新 skillctlasttime
    status: completed
    dependencies:
      - register-and-expose
---

## 功能概述

为 opclskill 自制技能增加远程 RAR 包自动下载和更新功能。激活成功后，调用 SkillCt 接口获取 RAR 包 URL，下载并解压到 `.openclaw/skills/` 目录；程序启动时自动检查更新，如有新版本则自动下载覆盖。

## 核心功能

1. **激活后自动下载**：用户输入激活码 → SkillRq 验证成功 → 保存 skillcod → 调用 SkillCt 接口获取 RAR 包 → 下载并解压到 `~/.openclaw/skills/` → 保存更新标记 `skillctlasttime`
2. **启动时自动更新检查**：加载技能列表时读取 PanelConfig 中的 `skillcod` 和 `skillctlasttime` → 调用 SkillCt 检查是否有新版本 → 有则下载 RAR 包并覆盖解压 → 更新 `skillctlasttime`
3. **首次激活**：`CreateTime` 传 `null`，服务端返回完整 RAR 包
4. **增量更新**：后续检查时传上次的 `lasttime`，服务端如有新版本返回新的 RAR 包 URL

## 技术栈

- **前端**：JavaScript (Vanilla) — `src/pages/skills.js`
- **后端**：Rust (Tauri 2) — 新增 `download_and_extract_rar` 命令
- **新增依赖**：`unrar` crate — 用于 Rust 侧解压 RAR 压缩包
- **API 桥接**：`src/lib/tauri-api.js` — 暴露新命令给前端

## 实现方案

### 整体架构

采用 C/S 分层：前端（skills.js）负责 UI 交互和 API 调用编排，后端（Rust Tauri 命令）负责 RAR 下载和解压的底层操作。前端通过 `tauri-api.js` 的 invoke 桥调用 Rust 命令。

### Rust 后端设计

在 `commands/skills.rs` 中新增 `download_and_extract_rar` Tauri 命令（遵循现有的 `skillhub.rs` 中 download_zip + extract_zip 模式）：

1. 使用 `reqwest`（已有依赖）从 URL 下载 RAR 文件到临时文件（流式写入，避免大文件内存溢出）
2. 使用 `unrar` crate 的 `Archive::new(path).extract_to(destination)` API 将 RAR 解压到目标目录
3. 解压前先清理旧目录（覆盖模式），遵循 skillhub.rs 中 `extract_zip` 的相同模式
4. 解压完成后删除临时 RAR 文件
5. 命令签名：`pub async fn download_and_extract_rar(url: String, target_dir: String) -> Result<String, String>`

### 前端流程改造

**激活流程**（`showActivationModal` 确认按钮回调中，SkillRq 成功后）：

```
SkillRq 成功 → 保存 skillcod → 调用 SkillCt({code, CreateTime:null, name:'skill123'})
  ├─ success=true → 调 downloadAndExtractRar(fname, openclawDir/skills) + 保存 skillctlasttime → resolve(true)
  └─ success=false → 显示错误
```

**启动加载**（`loadSkills` 中，现有 SkillRq 验证之后）：

```
读 skillcod+skillctlasttime → 调 SkillCt({code, CreateTime:skillctlasttime, name:'skill123'})
  ├─ success=true → 调 downloadAndExtractRar(fname, openclawDir/skills) + 更新 skillctlasttime
  └─ success=false → 静默跳过（无需更新或网络问题）
```

### 性能与风险控制

- **性能**：RAR 下载和解压是 IO 密集型操作，放在 Rust 异步命令中执行，不阻塞 UI 渲染
- **离线容忍**：网络不可用时静默跳过，不中断用户操作
- **安全性**：仅使用从 SkillCt 返回的 fname URL，防止任意 URL 注入
- **恢复机制**：解压失败不破坏现有 skills 目录（先解压到临时目录，成功后再替换）
- **日志**：使用 `eprintln!` 输出下载/解压进度，便于调试

### 修改文件清单

| 文件 | 修改类型 | 说明 |
| --- | --- | --- |
| `src-tauri/Cargo.toml` | MODIFY | 添加 `unrar` crate 依赖 |
| `src-tauri/src/commands/skills.rs` | MODIFY | 新增 `download_and_extract_rar` Tauri 命令 |
| `src-tauri/src/lib.rs` | MODIFY | 注册新命令到 invoke_handler |
| `src/lib/tauri-api.js` | MODIFY | 暴露 `downloadAndExtractRar` API |
| `src/pages/skills.js` | MODIFY | 修改激活和加载流程，整合 SkillCt 调用 |


### 目录结构

```
project-root/
├── src-tauri/
│   ├── Cargo.toml                                # [MODIFY] 添加 unrar 依赖
│   └── src/
│       ├── commands/
│       │   └── skills.rs                         # [MODIFY] 新增 download_and_extract_rar 命令
│       └── lib.rs                                # [MODIFY] 注册新命令到 invoke_handler
├── src/
│   ├── lib/
│   │   └── tauri-api.js                          # [MODIFY] 新增 downloadAndExtractRar 方法
│   └── pages/
│       └── skills.js                             # [MODIFY] 修改激活和加载流程
```

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 在实现过程中，如需验证 Rust 命令注册模式、unrar crate API 签名、或确认已有代码模式时，使用此子代理进行跨文件搜索
- Expected outcome: 精确定位需修改的代码位置和参考模式，确保实现与现有架构一致

### Skill

本任务为内部功能增强，不直接使用 skills 中列出的外部 AI Agent 技能。