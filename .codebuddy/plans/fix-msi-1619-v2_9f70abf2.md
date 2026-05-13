---
name: fix-msi-1619-v2
overview: 修复 msiexec 因 CREATE_NO_WINDOW 标志导致 1619 退出码，移除不兼容的 creation_flags，添加路径调试日志
todos:
  - id: scope-download-block
    content: 在 offline_install_node_msi() 中用代码块包裹下载循环并添加 sync_all()，确保文件句柄在 msiexec 调用前释放
    status: completed
  - id: add-file-existence-check
    content: 在 msiexec 调用前添加文件存在性检查 + 路径日志，移除 msiexec 上不合适的 creation_flags
    status: completed
    dependencies:
      - scope-download-block
---

修复 Node.js MSI 安装退出码 1619 问题

在 chat-debug.js 一键修复流程中，Node.js MSI 文件下载成功（30MB）但 msiexec 始终报 1619。第一次修复（移除双引号）重建后问题依旧，因为用户路径不含空格，双引号不是根因。

需要彻底定位并修复 1619 问题，确保 MSI 文件能被 msiexec 正常打开安装。

## 根因分析

经过代码排查，排除了两个之前的猜测：

1. **双引号问题** - 用户路径 `C:\Users\pmm\...` 不含空格，之前的修复不影响
2. **`CREATE_NO_WINDOW`** - `/passive` 模式（第 6229 行）没有 `creation_flags`，但仍然报 1619，说明该标志不是根因

### 真正根因：文件句柄未释放 + 缺少刷写确认

在 `offline_install_node_msi()` 函数中，`file` 变量在第 6116 行创建：

```rust
let mut file = std::fs::File::create(&msi_path)?;
```

file 与后续 msiexec 调用处于**同一函数作用域**（未用代码块隔离），Rust 只在函数返回时才 drop 文件句柄。这意味着当 msiexec 尝试打开 MSI 文件时，写句柄仍然打开。可能导致：

- msiexec 的 Windows Installer 服务请求独占读取时会失败
- OS 写缓存中的数据可能尚未刷写到磁盘
- 安全软件挂起的文件扫描句柄与之冲突

### 修复策略

1. **包围下载代码块** - 用 `{ ... }` 包裹下载循环和文件创建，确保 `file` 在下载完成后立即 drop
2. **添加 `file.sync_all()`** - 在 handle drop 前强制刷写 OS 缓存到磁盘
3. **添加文件存在性检查 + 路径日志** - 在 msiexec 调用前确认文件仍在，便于调试
4. **移除 msiexec 上不合适的 `creation_flags`** - 清理遗留问题（/passive 已无此标志，统一风格）

## 实现细节

### 目标文件

- `c:/work/clawpanel-main/clawpanel-main/clawpanel-main/src-tauri/src/commands/config.rs`
- 仅修改 `offline_install_node_msi()` 函数（第 6073-6267 行）

### 具体修改

#### 修改 1：下载完整性校验后添加调试日志和文件存在检查

在第 6155 行后（完整性校验完成）、第 6157 行前，插入：

```rust
// 记录 MSI 路径便于调试
let _ = app.emit("upgrade-log", format!("  MSI 路径: {}", msi_path.display()));

// 确认文件仍然存在（安全软件可能已删除）
if !msi_path.exists() {
    return Err("MSI 文件在下载后丢失，可能是安全软件拦截。请手动下载安装".to_string());
}
```

#### 修改 2：将下载写入块包围在独立作用域中

将第 6116-6135 行的文件创建 + 下载循环用 `{ ... }` 包围，并添加 `sync_all()`：

```rust
{
    let mut file = std::fs::File::create(&msi_path)?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        downloaded += chunk.len() as u64;
        file.write_all(&chunk)?;
        // ... 进度报告 ...
    }
    // 强制刷写到磁盘，确保 msiexec 能正确读取
    file.sync_all()?;
    // file 在此处被 drop，句柄释放
}
```

#### 修改 3：移除 msiexec 上不合适的 creation_flags

- 第 6176 行：删除 `.creation_flags(0x08000000)`
- 第 6208 行：删除 `.creation_flags(0x08000000)`

#### 不需要修改的地方

- 前端 `chat-debug.js` - 无需改动
- `auto_install_node()` 函数 - winget 入口无需改动
- `msi_exit_code_diag()` 函数 - 无需改动
- `cmd.exe /c start ...` 交互安装路径 - 已有 `.arg("")` 空标题修复

## 目录结构

无需新增文件，仅修改：

```
src-tauri/src/commands/config.rs  # [MODIFY] offline_install_node_msi() 函数
```

# Agent Extensions

使用 [subagent:code-explorer] 对代码进行了深入探索，发现了文件句柄未释放的关键问题。