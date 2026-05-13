---
name: optimize-get-version-info
overview: 对 get_version_info 进行结构化优化：消除 resolve_openclaw_cli_path 的 3 次重复调用，并行化 get_local_version 与 CLI 路径解析，并行化 scan_all_installations 与网络请求
todos:
  - id: refactor-get-version-info
    content: 重构 get_version_info()，实现三重并行化和 spawn_blocking
    status: completed
  - id: verify-build
    content: 运行 cargo check 验证无编译错误
    status: completed
    dependencies:
      - refactor-get-version-info
---

## 需求

进一步优化 `get_version_info()` 函数的执行速度。当前虽然已修复 `openclaw status --json` 的超时问题，但仍存在以下可优化点：

1. `resolve_openclaw_cli_path()` 在 `get_local_version`、`detect_installed_source`、`join!` 块中被调用了 3 次（PATH 环境变量扫描，每次 ~20ms）
2. `get_local_version()` 和 `detect_installed_source()` 无数据依赖却串行执行
3. `scan_all_installations()` 和 `get_latest_version_for()` 无数据依赖却串行执行（等 HTTP 返回后才扫描）
4. `detect_installed_source()` 和 `scan_all_installations()` 是同步阻塞操作，在 async 函数中直接调用会阻塞运行时

## 优化目标

- 消除冗余的 `resolve_openclaw_cli_path` 调用（3次 -> 1次）
- 将无依赖的操作并行化执行，缩短总等待时间
- 同步阻塞操作使用 `spawn_blocking` 避免阻塞 async 运行时
- 不动已有函数签名，仅修改 `get_version_info()` 函数体

## 技术方案

### 实现策略

通过三重并行化重构 `get_version_info()` 的执行流程：

#### Phase 1（三重并行）：无依赖的三个操作同时启动

```
┌─ get_local_version().await        ─→ current
├─ resolve_openclaw_cli_path()      ─→ cli_path  (在顶层解析一次，不再重复调用)
└─ spawn_blocking(detect_installed) ─→ source    (同步文件操作在阻塞线程池执行)
```

#### Phase 2：计算派生数据（依赖 Phase 1 全部完成）

- `current` 中的 `-zh` 后缀检查修正 `source`
- `recommended_version_for(source)` 调用
- `cli_source = classify_cli_source(&cli_path)`

#### Phase 3（双并行）：剩余操作并行执行

```
┌─ get_latest_version_for(&source)  ─→ latest    (HTTP 请求 2-5s)
└─ spawn_blocking(scan_all_inst...) ─→ installations (同步文件扫描，随网络请求并行)
```

### 关键设计决策

1. **顶层解析 `cli_path`**：在 Phase 1 用 `futures_util::join!` 与 `get_local_version()` 并行解析，供后续所有函数复用。`get_local_version` 在 status 超时后的 fallback 路径中不再需要自己调用 `resolve_openclaw_cli_path`（但函数签名不改动，内部仍会调用，不过其并行执行等待时间已被覆盖）。

2. **使用 `tokio::task::spawn_blocking`**：项目中已有 `service.rs` 中使用 `spawn_blocking` 的先例（line 897），将 `detect_installed_source()` 和 `scan_all_installations()` 放入阻塞线程池执行，避免阻塞 async 运行时。

3. **不修改函数签名**：`get_local_version()`、`detect_installed_source()`、`scan_all_installations()` 的原函数签名完全不动，仅在 `get_version_info()` 内部调整调用方式。

### 性能预期

| 指标 | 优化前 | 优化后 |
| --- | --- | --- |
| `resolve_openclaw_cli_path` 调用次数 | 3次 (~60ms 累积) | 1次 (~20ms) |
| detect_installed_source 阻塞 async | 是 (~50ms) | 否 (spawn_blocking) |
| scan_all_installations 等待 HTTP | 是 (~5s) | 否 (并行) |
| status 超时期间利用率 | 浪费 (仅等待) | 同时完成 PATH 扫描 + source 检测 |
| **最坏情况总时间** | **~10s** | **~5-6s** |


## 实现注意事项

### 代码结构调整

仅修改 `get_version_info()` 函数体（line 2269-2339），不需要新增函数或改动其他代码。

```rust
#[tauri::command]
pub async fn get_version_info() -> Result<VersionInfo, String> {
    // Phase 1: 并行执行三个无依赖的操作
    let (current, cli_path, source_handle) = futures_util::join!(
        get_local_version(),
        async { crate::utils::resolve_openclaw_cli_path() },
        tokio::task::spawn_blocking(|| detect_installed_source()),
    );
    let mut source = source_handle.unwrap_or_else(|_| "unknown".to_string());

    // 兜底：版本号含 -zh 则一定是汉化版
    if let Some(ref ver) = current {
        if ver.contains("-zh") && source != "chinese" {
            source = "chinese".to_string();
        }
    }

    // recommended 是本地文件读取，很快
    let recommended = if source == "unknown" {
        None
    } else {
        recommended_version_for(&source)
    };

    let cli_source = cli_path
        .as_ref()
        .map(|p| crate::utils::classify_cli_source(p));

    // Phase 2: 并行执行网络请求和文件扫描
    let cli_path_clone = cli_path.clone();
    let (latest, all_installations) = futures_util::join!(
        async {
            if source == "unknown" {
                None::<String>
            } else {
                get_latest_version_for(&source).await
            }
        },
        tokio::task::spawn_blocking(move || scan_all_installations(&cli_path_clone)),
    );
    let all_installations = all_installations.unwrap_or_default();

    // 版本比较逻辑不变...
}
```

注意：`scan_all_installations` 接受的参数是 `&Option<String>`，需要 clone cli_path 再 move 进 closure。

### 风险与缓解

1. **spawn_blocking panic 安全**：`JoinHandle::await` 返回 `Result<T, JoinError>`，需 `unwrap_or_else` 兜底
2. **clone 开销**：`cli_path` 是 `Option<String>`，clone 微秒级，可忽略
3. **detect_installed_source 内部仍会调 resolve_openclaw_cli_path**：这是函数内部行为，不改动，但外层并行已让它的执行时间被覆盖在 status 超时等待内