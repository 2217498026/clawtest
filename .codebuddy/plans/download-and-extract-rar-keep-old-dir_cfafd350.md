---
name: download-and-extract-rar-keep-old-dir
overview: 修改 download_and_extract_rar 函数，不再清理旧目录，仅创建目标目录（如不存在），解压时自动覆盖同名文件。
todos:
  - id: remove-rmdir-logic
    content: 在 skills.rs 中删除 remove_dir_all 块，仅保留 create_dir_all 确保目录存在
    status: completed
---

修改 `download_and_extract_rar` 函数中的目录处理逻辑：去掉清理旧目录的操作（`remove_dir_all`），只确保目标目录存在（`create_dir_all`）。解压时 `extract_with_base` 会自动覆盖同名文件，因此不需要先删除整个目录再重建。

## 涉及文件

- `src-tauri/src/commands/skills.rs` — 仅修改第 907-914 行

## 改动内容

删除 `if target.exists() { std::fs::remove_dir_all(&target)... }` 块，保留 `std::fs::create_dir_all(&target)`。`create_dir_all` 在目录已存在时无操作，正好满足"不清理旧目录，只覆盖同名文件"的需求。

## 不变的部分

- 下载逻辑、临时文件管理、解压流程（`read_header` + `extract_with_base`）均保持不变
- `extract_with_base` 写入文件时会自动覆盖目标路径下的同名文件，无需额外处理
- 临时文件清理（第 5 步）保持不变