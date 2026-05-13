---
name: optimize-get-version-info
overview: 优化 get_version_info() 函数速度，将网络请求（get_latest_version_for）与本地 CLI 路径解析并行执行，减少总等待时间。
todos:
  - id: restructure-get-version-info
    content: 在 get_version_info() 中将 recommended_version_for 提前到 join 之前，用 tokio::join! 并行化 get_latest_version_for 和 resolve_openclaw_cli_path
    status: completed
  - id: verify-build
    content: 构建项目并验证无编译错误，确认 tokio::join! 正确处理 async 闭包的生命周期
    status: completed
    dependencies:
      - restructure-get-version-info
---

## 需求概述

优化 `get_version_info()` 函数的执行速度。当前该函数串行执行多个操作，包括慢速的 HTTP 网络请求到 npm registry（超时 2 秒），导致每次调用版本信息时用户体验不佳。

## 核心问题

当前 `get_version_info()` 的执行流程是严格的串行顺序：

```

    1. get_local_version().await             -- 500-1000ms (子进程 + FS 扫描)
    2. detect_installed_source()              -- ~50ms
    3. get_latest_version_for().await         -- 200-2000ms (HTTP 请求到 npm registry，主瓶颈)
    4. recommended_version_for()              -- ~5ms
    5. resolve_openclaw_cli_path()            -- ~50-100ms (PATH 扫描)
    6. classify_cli_source + scan_all_installations -- ~50-200ms
```

其中步骤 3（HTTP 网络请求）和步骤 5/6（本地文件系统操作）之间**无数据依赖**，完全可以并行执行。此外，`resolve_openclaw_cli_path()` 在 `get_local_version()`、`detect_installed_source()` 和步骤 5 中被重复调用了 3 次。

## 优化方案

利用 `tokio::join!` 将慢速的 HTTP 网络请求与本地文件系统操作并行化，使两者同时进行而非串行等待。预计**节省 200-2000ms 的 wall-clock 时间**。

## 优化后的流程

```
get_local_version()  -- 必须先完成（确定 source）
↓
detect_installed_source()  -- 必须先完成（确定 source）
↓
recommended_version_for()  -- 同步操作，提前执行（不依赖 join）
↓
╔═══ tokio::join! ════════════════════════════╗
║  分支 A: get_latest_version_for() (HTTP)    ║
║  分支 B: resolve_openclaw_cli_path() (FS)   ║
╚══════════════════════════════════════════════╝
↓
scan_all_installations()  -- 依赖 cli_path，但快速
Version comparisons  -- 纯 CPU 计算，微秒级
```

## 技术栈

    - **Rust** (Tauri backend) — 修改单文件 `src-tauri/src/commands/config.rs`
    - **tokio** — 已存在于 Cargo.toml 依赖中（`tokio = { version = "1", features = ["process", "time"] }`），`tokio::join!` 宏无需额外 feature

## 实现方案

### 修改点

只需修改 `get_version_info()` 函数（第 2266-2328 行），**调整其中 3 个操作的执行顺序**：

    1. **将 `recommended_version_for(&source)` 提前** — 在 `tokio::join!` 之前执行。它是一个纯同步的本地 JSON 文件读取操作，不依赖 CLI 路径，且仅依赖已经计算好的 `source`。提前执行不会增加额外等待时间。

    1. **将 `get_latest_version_for(&source)` 和 `resolve_openclaw_cli_path()` 放入 `tokio::join!`** — 这两者无数据依赖，可以并行：

    - 分支 A：网络请求到 npm registry（慢，200-2000ms）
    - 分支 B：扫描 PATH 查找 CLI 路径（快，50-100ms）

    1. **保持 `scan_all_installations(&cli_path)` 在 join 之后** — 它依赖 `cli_path` 的结果，但操作速度快（~50-100ms）

### 为什么安全

    - `recommended_version_for(&source)` 只读取本地 JSON 策略文件（`openclaw-version-policy.json`），是纯同步操作，放在 async join 前后不影响正确性
    - `scan_all_installations` 需要的唯一外部输入是 `cli_path`，而这已由 join 的分支 B 提供
    - 所有版本比较操作只依赖 `current`、`recommended`、`latest` 这三个已经就绪的变量，无论它们的执行顺序如何

### 预期性能提升

| 场景 | 优化前 | 优化后 | 节省 |
| --- | --- | --- | --- |
| 快速网络（<100ms） | ~700ms | ~500ms | ~28% |
| 中等网络（500ms） | ~1200ms | ~700ms | ~42% |
| 慢速网络（2000ms） | ~2700ms | ~1700ms | ~37% |


### 文件变更

仅修改一个文件的约 15 行代码：

```
src-tauri/
└── src/
└── commands/
└── config.rs  # [MODIFY] get_version_info() 函数，调整执行顺序
```

### 关键代码变更

变更集中在第 2275-2312 行的重组。当前代码：

```rust
// 当前（串行）：
let latest = if source == "unknown" { None } else { get_latest_version_for(&source).await };
let recommended = if source == "unknown" { None } else { recommended_version_for(&source) };
// ... 版本比较 ...
let cli_path = crate::utils::resolve_openclaw_cli_path();
let cli_source = ...;
let all_installations = scan_all_installations(&cli_path);
```

优化后：

```rust
// 优化后（并行 + 提前执行）：
let recommended = if source == "unknown" { None } else { recommended_version_for(&source) };

let (latest, cli_path) = tokio::join!(
async { if source == "unknown" { None } else { get_latest_version_for(&source).await } },
async { crate::utils::resolve_openclaw_cli_path() },
);

let cli_source = cli_path.as_ref().map(|p| crate::utils::classify_cli_source(p));
let all_installations = scan_all_installations(&cli_path);

// ... 版本比较（不变） ...
```

其余部分（版本比较、结果构造）保持不变。