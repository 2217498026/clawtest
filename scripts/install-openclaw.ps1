#Requires -RunAsAdministrator
<#
.SYNOPSIS
    通过国内镜像源安装指定版本的 openclaw 并完成 Gateway 安装。
.DESCRIPTION
    - 默认使用 npmmirror.com 国内镜像源安装 openclaw 包
    - 支持多次安全重复执行（幂等），已安装时自动跳过
    - 自动安装并注册 Gateway 服务
    - 自动修复 config.json 配置
    - 内置多镜像源自动切换（npmmirror → 腾讯云 → 华为云 → 官方）
.PARAMETER Version
    要安装的 openclaw 版本，默认 2026.4.11
.PARAMETER Source
    安装来源：official（官方包 openclaw）或 domestic（国内包 @qingchencloud/openclaw-zh），默认 official
.PARAMETER Registry
    自定义 npm registry 地址，默认 https://registry.npmmirror.com
.PARAMETER Force
    强制重新安装，即使已安装相同版本
.PARAMETER Silent
    静默模式，不暂停等待用户按键
.EXAMPLE
    .\install-openclaw.ps1
    使用默认参数安装
.EXAMPLE
    .\install-openclaw.ps1 -Version 2026.4.11 -Source domestic
    安装国内发行版
.EXAMPLE
    .\install-openclaw.ps1 -Force
    强制重新安装
#>

param(
    [string]$Version = "2026.4.11",
    [ValidateSet("official", "domestic")]
    [string]$Source = "official",
    [string]$Registry = "https://registry.npmmirror.com",
    [switch]$Force,
    [switch]$Silent
)

# 不要用 Stop，否则 Write-Host 等非严重错误也会导致脚本崩溃
$ErrorActionPreference = "Continue"
$script:colors = @{
    Info    = "Cyan"
    Ok      = "Green"
    Warn    = "Yellow"
    Error   = "Red"
}

# 日志目录（使用 LOCALAPPDATA，不会被系统清理，且随用户隔离）
$script:LogDir = Join-Path $env:LOCALAPPDATA "OpenClaw\logs"
# 确保目录存在
$null = New-Item -ItemType Directory -Path $script:LogDir -Force -ErrorAction SilentlyContinue

# 带时间戳的日志（每次运行独立文件，用于历史追溯）
$script:LogFile = Join-Path $script:LogDir "openclaw-install-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
# 固定名日志（每次运行覆盖，用于快速查看最近一次日志）
$script:LogFileFixed = Join-Path $script:LogDir "openclaw-install.log"

# ---- 工具函数 ----
function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    # 时间戳日志：追加（保留历史）
    try { Add-Content -Path $script:LogFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
    # 固定名日志：$script:LogFirstWrite 在 Main 开头设为 $true，首次调用改 Set-Content 覆盖，之后改用追加
    if ($script:LogFirstWrite) {
        try { Set-Content -Path $script:LogFileFixed -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
        $script:LogFirstWrite = $false
    }
    else {
        try { Add-Content -Path $script:LogFileFixed -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
    }
}

function Write-Colored($Color, $Label, $Message) {
    Write-Host "[$Label]" -ForegroundColor $Color -NoNewline
    Write-Host " $Message"
    Write-Log "[$Label] $Message"
}

function Write-Info  ($msg) { Write-Colored $script:colors.Info  "INFO"  $msg }
function Write-Ok   ($msg) { Write-Colored $script:colors.Ok   "OK"    $msg }
function Write-Warn ($msg) { Write-Colored $script:colors.Warn "WARN"  $msg }
function Write-Err  ($msg) { Write-Colored $script:colors.Error "ERROR" $msg }

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Err "请以管理员身份运行此脚本（Administrator privileges required）"
        if (-not $Silent) { Read-Host "按 Enter 键退出" }
        exit 1
    }
    Write-Info "管理员权限检查通过"
}

function Get-NpmFullPath {
    # 尝试 from PATH
    $npmPath = (Get-Command "npm.cmd" -ErrorAction SilentlyContinue).Source
    if ($npmPath) {
        Write-Info "npm 在 PATH 中: $npmPath"
        return $npmPath
    }

    # 尝试常见安装路径
    $paths = @(
        "$env:ProgramFiles\nodejs\npm.cmd",
        "$env:ProgramW6432\nodejs\npm.cmd",
        "${env:ProgramFiles(x86)}\nodejs\npm.cmd",
        "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd",
        "$env:APPDATA\npm\npm.cmd"
    )

    # 检查 nvm-windows
    $nvmSettings = "$env:APPDATA\nvm\settings.txt"
    if (Test-Path $nvmSettings) {
        $nvmVer = (Get-Content $nvmSettings | Select-String "version" | ForEach-Object { $_ -replace '.*:\s*', '' }).Trim()
        if ($nvmVer -and (Test-Path "$env:APPDATA\nvm\v$nvmVer\npm.cmd")) {
            Write-Info "通过 nvm 发现 npm: $env:APPDATA\nvm\v$nvmVer"
            return "$env:APPDATA\nvm\v$nvmVer\npm.cmd"
        }
    }

    foreach ($p in $paths) {
        if (Test-Path $p) {
            Write-Info "发现 npm: $p"
            return $p
        }
    }

    # 尝试 node 定位
    $nodePath = (Get-Command "node.exe" -ErrorAction SilentlyContinue).Source
    if ($nodePath) {
        $dir = Split-Path $nodePath -Parent
        $candidate = Join-Path $dir "npm.cmd"
        if (Test-Path $candidate) {
            Write-Info "通过 node 发现 npm: $candidate"
            return $candidate
        }
    }

    Write-Err "npm 未找到。请先安装 Node.js（https://nodejs.org）"
    if (-not $Silent) { Read-Host "按 Enter 键退出" }
    exit 1
}

function Get-ConfiguredRegistry {
    $regFile = "$env:USERPROFILE\.openclaw\npm-registry.txt"
    if (Test-Path $regFile) {
        $configured = (Get-Content $regFile -Raw).Trim()
        if ($configured) {
            Write-Info "从 $regFile 读取到自定义 registry: $configured"
            return $configured
        }
    }
    return $Registry
}

function Test-OpenClawInstalled {
    # 检查 openclaw 命令是否可用
    $openclawPath = (Get-Command "openclaw.cmd" -ErrorAction SilentlyContinue).Source
    if (-not $openclawPath) {
        return $false
    }

    # 检查已安装的版本（输出格式如 "OpenClaw 2026.4.11 (769908e)"，提取版本号部分）
    try {
        $verOutput = & $openclawPath --version 2>&1
        if ($LASTEXITCODE -ne 0) { return $false }
        $installedFull = $verOutput.Trim()
        Write-Info "已安装 openclaw 版本: $installedFull"

        # 提取纯版本号（去掉 "OpenClaw " 前缀和 " (hash)" 后缀）
        if ($installedFull -match "([\d]+\.[\d]+\.[\d]+)") {
            $installedVer = $matches[1]
        }
        else {
            $installedVer = $installedFull
        }

        if ($installedVer -eq $Version -and -not $Force) {
            Write-Ok "版本 $Version 已安装，跳过 npm install（如需重新安装请使用 -Force 参数）"
            return $true
        }

        if ($installedVer -ne $Version) {
            Write-Warn "已安装版本 ($installedFull) 与目标版本 ($Version) 不一致，准备更新"
        }
        return $false
    }
    catch {
        return $false
    }
}

function Invoke-NpmInstall {
    param([string]$NpmPath, [string]$PkgName, [string]$Version, [string]$Registry)

    $pkgSpec = "$PkgName@$Version"
    Write-Info "运行: npm install -g $pkgSpec --registry $Registry"

    # 确保 Node.js 目录在 PATH 中
    $nodeDir = Split-Path $NpmPath -Parent
    if ($env:Path -notlike "*$nodeDir*") {
        Write-Info "将 Node.js 目录添加到 PATH: $nodeDir"
        $env:Path = "$nodeDir;$env:Path"
    }

    # 构建命令行（用 System.Diagnostics.Process 保证退出码准确）
    $npmArgs = @(
        "install", "-g",
        $pkgSpec,
        "--registry", $Registry,
        "--force",
        "--ignore-scripts",
        "--no-audit", "--no-fund"
    )
    $argLine = "/c `"$NpmPath`" $($npmArgs -join ' ')"

    try {
        Write-Host "  启动 npm install..." -NoNewline
        Write-Host "（最长等待 15 分钟）"

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "cmd.exe"
        $psi.Arguments = $argLine
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        # 捕获输出供日志使用，同时显示到控制台
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true

        $proc = [System.Diagnostics.Process]::Start($psi)

        # 异步读取输出并实时显示
        $script:lastNpmOutput = ""
        $regOut = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
            $line = $EventArgs.Data
            if ($line) {
                Write-Host "  $line" -ForegroundColor Gray
                $script:lastNpmOutput += $line + "`n"
            }
        } | Out-Null
        $regErr = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
            $line = $EventArgs.Data
            if ($line) {
                Write-Host "  $line" -ForegroundColor DarkYellow
                $script:lastNpmOutput += $line + "`n"
            }
        } | Out-Null

        $proc.BeginOutputReadLine()
        $proc.BeginErrorReadLine()

        # 等待完成（最长 15 分钟 = 900 秒）
        $exited = $proc.WaitForExit(900000)  # 毫秒
        if (-not $exited) {
            $proc.Kill()
            Write-Err "npm install 超时（15分钟），请检查网络或重试"
            return $false
        }

        $proc.WaitForExit()  # 确保退出码可用
        Write-Host ""

        if ($proc.ExitCode -ne 0) {
            Write-Err "npm install 失败（exit code: $($proc.ExitCode)）"
            return $false
        }

        return $true
    }
    catch {
        Write-Err "npm 进程异常: $_"
        return $false
    }
    finally {
        # 清理事件订阅
        try { Get-EventSubscriber -SourceIdentifier "OutputDataReceived" -ErrorAction SilentlyContinue | Unregister-Event -Force -ErrorAction SilentlyContinue } catch {}
        try { Get-EventSubscriber -SourceIdentifier "ErrorDataReceived" -ErrorAction SilentlyContinue | Unregister-Event -Force -ErrorAction SilentlyContinue } catch {}
        if ($proc -and -not $proc.HasExited) {
            try { $proc.Kill() } catch {}
        }
        if ($proc) { try { $proc.Dispose() } catch {} }
    }
}

function Install-GatewayService {
    Write-Info "正在安装 Gateway 服务..."

    $openclawPath = (Get-Command "openclaw.cmd" -ErrorAction SilentlyContinue).Source
    if (-not $openclawPath) {
        Write-Warn "openclaw 命令不在 PATH 中，跳过 Gateway 安装"
        return $false
    }

    # 先停止已有服务
    Write-Info "停止已存在的 Gateway 服务..."
    & $openclawPath gateway stop 2>&1 | Out-Null
    Start-Sleep 2

    # 检查服务是否已注册
    $serviceExists = Get-Service -Name "OpenClawGateway" -ErrorAction SilentlyContinue
    if ($serviceExists) {
        Write-Info "Gateway 服务已注册，重新注册..."
        & $openclawPath gateway uninstall 2>&1 | Out-Null
        Start-Sleep 1
    }

    Write-Info "注册 Gateway 服务..."
    $installOutput = & $openclawPath gateway install 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Gateway 服务安装成功"
        return $true
    }
    else {
        Write-Warn "Gateway 安装失败，请手动执行: openclaw gateway install"
        Write-Host "  输出: $installOutput" -ForegroundColor DarkYellow
        return $false
    }
}

function Patch-Config {
    $configPath = "$env:USERPROFILE\.openclaw\config.json"
    if (-not (Test-Path $configPath)) {
        Write-Info "config.json 不存在，无需修补"
        return
    }

    try {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
    }
    catch {
        Write-Warn "config.json 格式异常，跳过修补"
        return
    }

    $dirty = $false

    if (-not $config.gateway) {
        $config | Add-Member -NotePropertyName "gateway" -NotePropertyValue @{ mode = "local" }
        $dirty = $true
        Write-Info "  添加 gateway.mode = local"
    }
    elseif (-not $config.gateway.mode) {
        $config.gateway | Add-Member -NotePropertyName "mode" -NotePropertyValue "local"
        $dirty = $true
        Write-Info "  设置 gateway.mode = local"
    }

    if (-not $config.tools) {
        $config | Add-Member -NotePropertyName "tools" -NotePropertyValue @{ profile = "full"; sessions = @{ visibility = "all" } }
        $dirty = $true
        Write-Info "  添加 tools.profile = full"
    }
    elseif ($config.tools.profile -ne "full") {
        $config.tools.profile = "full"
        if (-not $config.tools.sessions) {
            $config.tools.sessions = @{ visibility = "all" }
        }
        $dirty = $true
        Write-Info "  设置 tools.profile = full"
    }

    if ($dirty) {
        $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
        Write-Ok "config.json 已修补"
    }
    else {
        Write-Info "config.json 配置已是最新，无需修改"
    }
}

# ---- 主流程 ----
function Main {
    # 初始化固定名日志覆盖标记（下次 Write-Log 的首次调用会覆盖文件）
    $script:LogFirstWrite = $true

    Write-Host ""
    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host "        OpenClaw 安装脚本 (通过国内镜像源)"                  -ForegroundColor Cyan
    Write-Host "=========================================================" -ForegroundColor Cyan
    Write-Host ""

    # 1. 检查权限
    Test-Admin

    # 2. 解析包名
    $pkgName = if ($Source -eq "domestic") { "@qingchencloud/openclaw-zh" } else { "openclaw" }
    Write-Info "安装包: $pkgName@$Version"

    # 3. 确定 registry
    $finalRegistry = Get-ConfiguredRegistry

    # 对于国内版，如果用户手动指定了非国内 registry，调整为官方 registry
    if ($Source -eq "domestic" -and $finalRegistry -notmatch "npmmirror|taobao") {
        Write-Warn "国内发行版建议使用国内镜像源，当前 registry 已调整为官方 registry"
        $finalRegistry = "https://registry.npmjs.org"
    }

    Write-Info "npm registry: $finalRegistry"

    # 4. 获取 npm 路径（无论是否已安装，每次都执行覆盖安装）
    $npmCmd = Get-NpmFullPath

    # 5. 镜像源列表（自动切换）
    $mirrorList = @(
        $finalRegistry,                    # 首选（默认 npmmirror）
        "https://mirrors.cloud.tencent.com/npm/",   # 腾讯云
        "https://mirrors.huaweicloud.com/repository/npm/", # 华为云
        "https://registry.npmjs.org"                # 官方备用
    )

    $installOk = $false
    foreach ($mirror in $mirrorList) {
        Write-Host ""
        Write-Info "尝试镜像源: $mirror"
        if (Invoke-NpmInstall -NpmPath $npmCmd -PkgName $pkgName -Version $Version -Registry $mirror) {
            $installOk = $true
            if ($mirror -ne $finalRegistry) {
                # 保存成功镜像地址供后续参考
                Write-Info "成功使用镜像源: $mirror"
            }
            break
        }
        Write-Warn "镜像源失败，准备切换下一个..."
        Start-Sleep 1
    }

    if (-not $installOk) {
        Write-Err "所有镜像源均安装失败，请检查网络连接"
        if (-not $Silent) { Read-Host "按 Enter 键退出" }
        exit 1
    }

    Write-Ok "npm install 完成！"

    # 7. 刷新 PATH
    Write-Info "刷新环境变量 PATH..."
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
                "$env:APPDATA\npm;$env:LOCALAPPDATA\Programs\OpenClaw"

    # 8. 安装 Gateway
    Write-Host ""
    Install-GatewayService

    # 9. 修补配置
    Write-Host ""
    Patch-Config

    # 10. 完成
    Write-Host ""
    Write-Ok "=================================================="
    Write-Ok "  OpenClaw 安装完成，版本: $Version"
    Write-Ok "=================================================="
    Write-Host ""
    Write-Info "安装日志已保存到: $script:LogFile"
    Write-Info "             亦可在: $script:LogFileFixed 查看最近一次安装日志"
    Write-Host ""

    if (-not $Silent) {
        Write-Host "提示: 如果命令 openclaw 未立即生效，请重启终端或运行：" -ForegroundColor Yellow
        Write-Host "  refreshenv" -ForegroundColor Cyan
        Write-Host ""
        Read-Host "按 Enter 键退出"
    }
}

# 全局异常捕获，防止静默闪退
try {
    # 执行主流程
    Main
}
catch {
    Write-Err "安装过程中发生未处理异常: $_"
    Write-Log "[FATAL] $($_ | Out-String)"
    if (-not $Silent) {
        Read-Host "按 Enter 键退出"
    }
    exit 1
}
