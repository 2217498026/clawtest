---
name: fix-node-msi-1619
overview: 修复 Node.js MSI 安装的 1619 退出码问题，根因是 MSI 路径被双重引号包裹导致 msiexec 找不到文件
todos:
  - id: fix-msi-1619
    content: 修改 src-tauri/src/commands/config.rs 中 offline_install_node_msi()：移除 msi_quoted 变量，4处 msiexec 调用点改用原始路径 msi_str，修复 start 命令的空标题参数
    status: completed
---

## 修复 Node.js MSI 安装退出码 1619 问题

### 问题描述

在 `chat-debug.js` 的一键修复流程中，Node.js 自动安装功能下载 MSI 文件成功（30MB/30MB），但 `msiexec` 始终报告退出码 1619（无法打开安装包，文件不存在或无法访问），导致所有静默安装模式（/qn、/quiet、/passive）均失败，最终回退到交互式安装。

### 根因

Rust 后端的 `offline_install_node_msi()` 函数中，MSI 路径先被手动包裹引号（`format!("\"{}\"", msi_str)`），然后通过 `Command::arg()` 传入。当 Windows 用户路径包含空格时，Rust 的 `Command::arg()` 会自动再加一层引号，导致双引号嵌套，msiexec 无法解析路径。

### 修复范围

仅修改 `src-tauri/src/commands/config.rs` 文件中的 `offline_install_node_msi()` 函数，去除手动引号包裹，让 Rust 的 `Command::arg()` 自动处理路径引用。

## 技术方案

### 目标文件

- `c:/work/clawpanel-main/clawpanel-main/clawpanel-main/src-tauri/src/commands/config.rs`

### 修改范围

仅修改 `offline_install_node_msi()` 函数（第 6056-6267 行）

### 修复策略

1. **移除 `msi_quoted` 变量**（第 6162 行）及其所有引用
2. **将 4 个 `msiexec` 调用点的 `.arg(&msi_quoted)` 改为 `.arg(&msi_str)`**

- Rust 的 `Command::arg()` 在 Windows 上会自动对含空格的参数添加引号
- 这样 msiexec 收到的路径是正确引号的单层引用

3. **修复交互式 `start` 命令的参数顺序**：

- `start` 命令将第一个引号参数视为窗口标题
- 需在路径前增加空标题参数 `.arg("")`，再传原始路径 `.arg(&msi_str)`

### 具体修改映射

| 位置 | 行号 | 修改前 | 修改后 |
| --- | --- | --- | --- |
| 移除变量 | 6162 | `let msi_quoted = format!("\"{}\"", msi_str);` | **删除此行** |
| /qn 安装 | 6174 | `.arg(&msi_quoted)` | `.arg(&msi_str)` |
| /quiet 安装 | 6206 | `.arg(&msi_quoted)` | `.arg(&msi_str)` |
| /passive 安装 | 6227 | `.arg(&msi_quoted)` | `.arg(&msi_str)` |
| 交互安装 | 6249 | `.arg(&msi_quoted)` | 改为两行：`.arg("")` | `.arg(&msi_str)` |


### 不修改的范围

- 不修改前端代码（`chat-debug.js`）
- 不修改 `winget`/`brew`/`apt` 等其他安装路径
- 不修改 `msi_exit_code_diag` 诊断函数
- 不修改其他无关的 Tauri 命令

### 验证方式

修复后，在 Windows 用户名包含空格的路径下（如 `C:\Users\John Doe\AppData\Local\Temp\...`），MSI 安装应能成功执行，不再报 1619 错误。