---
name: fix-gateway-restart-schtasks-lock
overview: 修复 fixNodeIssues 中 restartService 后 Gateway 无法重启的问题：在 stop_service_impl/cleanup_zombie 中清理残留的 lock 文件和 Windows Scheduled Task。
todos:
  - id: add-cleanup-functions
    content: 使用 [subagent:code-explorer] 确认 Windows mod platform 范围，新增 cleanup_gateway_scheduled_task() 和 cleanup_gateway_lock_files() 两个辅助函数
    status: pending
  - id: integrate-cleanup-in-stop
    content: 在 stop_service_impl() 的 kill 流程后调用两个清理函数
    status: pending
    dependencies:
      - add-cleanup-functions
  - id: integrate-cleanup-in-zombie
    content: 在 cleanup_zombie_gateway_processes() 末尾调用两个清理函数
    status: pending
    dependencies:
      - add-cleanup-functions
  - id: integrate-cleanup-in-start
    content: 在 start_service_impl() 启动 openclaw gateway 前调用两个清理函数作为防御性清理
    status: pending
    dependencies:
      - add-cleanup-functions
  - id: build-and-verify
    content: 构建项目并验证无编译错误
    status: pending
    dependencies:
      - integrate-cleanup-in-stop
      - integrate-cleanup-in-zombie
      - integrate-cleanup-in-start
---

## 需求概述

修复 `fixNodeIssues` 流程中 `restartService()` 后 Gateway 无法重新启动的问题。

## 核心问题

Windows 平台下，Gateway 以 Scheduled Task 方式注册运行后，调用 `restartService()` 时：

1. `stop_service_impl()` 通过 `taskkill /f /t /pid` 杀掉进程，但**不清理 lock 文件** `%TEMP%\openclaw\gateway.{hash}.lock`
2. 也**不删除已注册的 Scheduled Task** `schtasks /TN "OpenClaw Gateway"`
3. `start_service_impl()` 调用 `openclaw gateway start` 时，CLI 检测到 lock 文件和已注册服务，拒绝启动
4. Guardian 后续所有自动重试也因同样的 lock/service 残留而失败
5. 前端进入无限重连循环

## 修复目标

在 Windows 平台添加 lock 文件和 Scheduled Task 的清理逻辑，确保 stop/kill 后能干净地重新启动 Gateway。

关键日志行证实根因：

```
Gateway failed to start: failed to acquire gateway lock at C:\Users\admin\AppData\Local\Temp\1\openclaw\gateway.3ab9ea66.lock | EPERM
Gateway service appears registered. Stop it first.
```

## 技术方案

### 技术栈

- Rust (Tauri backend) - 修改单文件 `src-tauri/src/commands/service.rs`
- Windows API: `std::process::Command` 执行 `schtasks` 和文件操作

### 实现方案

#### 新增两个平台辅助函数（Windows mod platform）

在 Windows `mod platform` 中新增：

**1. `cleanup_gateway_scheduled_task()`**

- 执行 `schtasks /End /TN "OpenClaw Gateway"`（先结束运行中的任务实例）
- 然后执行 `schtasks /Delete /TN "OpenClaw Gateway" /F`（删除任务注册）
- 忽略所有错误（任务不存在时 schtasks 返回非零是正常的）
- 每次操作记录 guardian_log

**2. `cleanup_gateway_lock_files()`**

- 使用 `std::env::temp_dir()` 构造 `%TEMP%\openclaw\` 路径
- 扫描该目录下所有 `gateway.*.lock` 文件
- 逐一尝试删除，记录日志
- 忽略文件不存在的错误

#### 在三处入口调用清理函数

**A. `stop_service_impl()` (Windows 版, 行 1821)** — 在 kill 进程后、返回前调用两个清理函数

**B. `cleanup_zombie_gateway_processes()` (Windows 版, 行 1377)** — 在进程清理循环结束后调用两个清理函数

**C. `start_service_impl()` (Windows 版, 行 1755)** — 在启动 `openclaw gateway` 之前调用两个清理函数作为防御性清理

#### `restart_service()` 中 guardian 状态说明

`guardian_mark_manual_start()` 实际将 `manual_hold` 设为 `false`，所以 guardian 在 resume 后仍会尝试自动重启，自动重启路径也会经过 `start_service_impl()` 中的新清理逻辑，最终能恢复。

### 架构设计

#### 修改后的流程

```
stop_service_impl()
  ├─ kill_process_tree(pid)              ← 现有
  ├─ 额外 kill gateway 进程              ← 现有
  ├─ cleanup_legacy_gateway_window()     ← 现有
  ├─ NEW: cleanup_gateway_scheduled_task()  ← 新增
  ├─ NEW: cleanup_gateway_lock_files()      ← 新增
  └─ 返回结果

cleanup_zombie_gateway_processes()
  ├─ 进程清理循环                        ← 现有
  ├─ NEW: cleanup_gateway_scheduled_task()  ← 新增
  ├─ NEW: cleanup_gateway_lock_files()      ← 新增
  └─ 日志 "执行完毕"

start_service_impl()
  ├─ NEW: cleanup_gateway_scheduled_task()  ← 新增（防御性清理）
  ├─ NEW: cleanup_gateway_lock_files()      ← 新增（防御性清理）
  ├─ cleanup_zombie_gateway_processes()     ← 现有
  ├─ 端口检测和 spawn gateway             ← 现有
  └─ 轮询等待端口就绪                     ← 现有
```

### 目录结构

仅修改一个文件：

```
src-tauri/
  └── src/
      └── commands/
          └── service.rs  # [MODIFY] Windows mod platform 中新增两个辅助函数，在三处入口调用
```

### 关键代码结构

```rust
// === Windows mod platform 内新增 ===

/// 清理已注册的 Gateway Scheduled Task
fn cleanup_gateway_scheduled_task() {
    // schtasks /End - 先结束正在运行的任务实例（忽略错误）
    let _ = StdCommand::new("schtasks")
        .args(["/End", "/TN", "OpenClaw Gateway"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    // schtasks /Delete - 删除任务注册
    match StdCommand::new("schtasks")
        .args(["/Delete", "/TN", "OpenClaw Gateway", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    {
        Ok(output) if output.status.success() => {
            super::guardian_log("已清理 Gateway Scheduled Task");
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            super::guardian_log(&format!("清理 Scheduled Task 可能已不存在: {stderr}"));
        }
        Err(e) => {
            super::guardian_log(&format!("清理 Scheduled Task 调用失败: {e}"));
        }
    }
}

/// 清理残留的 Gateway lock 文件
fn cleanup_gateway_lock_files() {
    let temp_dir = std::env::temp_dir().join("openclaw");
    if !temp_dir.exists() {
        return;
    }
    if let Ok(entries) = std::fs::read_dir(&temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("gateway.") && name.ends_with(".lock") {
                    match std::fs::remove_file(&path) {
                        Ok(_) => super::guardian_log(
                            &format!("已删除 Gateway lock 文件: {}", path.display())
                        ),
                        Err(e) => super::guardian_log(
                            &format!("删除 Gateway lock 文件失败 {}: {e}", path.display())
                        ),
                    }
                }
            }
        }
    }
}
```

## Agent Extensions

### SubAgent

- **code-explorer**: 在执行计划前，用于快速定位和确认 Windows `mod platform` 中所有需要修改的函数位置和行号，确保修改准确。
- 目的：确认 `stop_service_impl`、`cleanup_zombie_gateway_processes`、`start_service_impl` 的精确位置
- 预期产出：确认各函数的起始行号和上下文，确保修改位置精确无误