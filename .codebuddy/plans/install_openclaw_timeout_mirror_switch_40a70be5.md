---
name: install_openclaw_timeout_mirror_switch
overview: 将 install_openclaw.bat 的超时保护改为：超时/失败后自动切换到下一个国内镜像重试，遍历多个国内镜像后再尝试官方源，最终全部失败才退出。
todos:
  - id: modify-install-script
    content: 替换 install_openclaw.bat 第 122-154 行：将二元重试改为多镜像遍历（当前源 -> 腾讯云 -> 华为云 -> 官方源 -> 失败退出）
    status: completed
---

## 需求描述

修改 `install_openclaw.bat` 中 npm install 失败后的重试逻辑。

当前行为：镜像源安装失败后，只切换到官方源重试一次，再失败则退出。

期望行为：镜像源安装失败/超时后，依次切换到多个国内镜像重试（腾讯云 -> 华为云），最后才尝试官方源，全部遍历完仍失败才退出。

## 涉及文件

`c:\work\clawpanel-main\clawpanel-main\clawpanel-main\scripts\install_openclaw.bat`（第 122-154 行）

## 镜像源列表

1. 当前配置源（默认 npmmirror，来自 `get_registry`）
2. `https://mirrors.cloud.tencent.com/npm/`（腾讯云）
3. `https://mirrors.huaweicloud.com/repository/npm/`（华为云）
4. `https://registry.npmjs.org`（官方源，最后兜底）

## 技术方案

### 实现方式

将第 122-154 行的二元重试逻辑（`NPM_RETRY` 布尔值 + `findstr` 判断 mirror + 单次 fallback 到 official）替换为计数器驱动的多镜像遍历逻辑（`MIRROR_ATTEMPT` 递增 + 按序切换 registry）。

### 替换范围

从 `:: First attempt with mirror registry` 注释到 `exit /b 1` 的整个失败处理块。

### 保留不动的部分

- 第 111-117 行：初始 REGISTRY 设置 + `@qingchencloud/openclaw-zh` 强制官方源逻辑
- 第 130 行：PowerShell 超时保护（300 秒，每 30 秒显示剩余时间）
- `:run_npm_install` 标签和内部的 echo/PowerShell/`set NPM_RESULT`/`type npm_err.log` 指令

### 新逻辑伪代码

```
set "MIRROR_ATTEMPT=0"

:run_npm_install
    ... (保持原有 echo + PowerShell 超时 + set NPM_RESULT + type err.log 不变)

if NPM_RESULT neq 0 (
    set /a MIRROR_ATTEMPT+=1
    switch MIRROR_ATTEMPT:
        1: REGISTRY = mirrors.cloud.tencent.com/npm/
        2: REGISTRY = mirrors.huaweicloud.com/repository/npm/
        3: REGISTRY = registry.npmjs.org
        else: "All registries failed" -> pause -> exit /b 1
    echo_warn "Switching to: REGISTRY"
    echo.
    goto :run_npm_install
)
```