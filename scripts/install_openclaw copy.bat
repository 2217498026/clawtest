@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

title OpenClaw Installation

set "SOURCE=%~1"
set "VER=%~2"
if "%SOURCE%"=="" set "SOURCE=official"
if "%VER%"=="" set "VER=2026.4.11"

if /i "%SOURCE%"=="official" (set "PKG_NAME=openclaw") else (set "PKG_NAME=@qingchencloud/openclaw-zh")

set "ESC="
set "GREEN=%ESC%[32m"
set "YELLOW=%ESC%[33m"
set "RED=%ESC%[31m"
set "CYAN=%ESC%[36m"
set "RESET=%ESC%[0m"

goto :start

:echo_info
echo %CYAN%[INFO] %~1%RESET%&exit /b 0
:echo_warn
echo %YELLOW%[WARN] %~1%RESET%&exit /b 0
:echo_ok
echo %GREEN%[OK]   %~1%RESET%&exit /b 0
:echo_err
echo %RED%[ERRO] %~1%RESET%&exit /b 0

:check_admin
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    call :echo_err "Administrator privileges required"
    pause
    exit /b 1
)
exit /b 0

:check_npm
set "COMBINED_PATH="
for /f "skip=2 tokens=3*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "COMBINED_PATH=%%a%%b"
for /f "skip=2 tokens=3*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do (
    if defined COMBINED_PATH ( set "COMBINED_PATH=!COMBINED_PATH!;%%a%%b" ) else ( set "COMBINED_PATH=%%a%%b" )
)
if defined COMBINED_PATH set "PATH=!COMBINED_PATH!"
set "PATH=%APPDATA%\npm;%LOCALAPPDATA%\Programs\OpenClaw;%PATH%"

where npm >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "delims=" %%i in ('where npm') do set "NPM_FULL_PATH=%%i"
    call :echo_info "npm found in PATH: %NPM_FULL_PATH%"
    exit /b 0
)

call :echo_warn "npm not in PATH, searching common locations..."

set "NODE_REG_PATH="
for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\Node.js" /v InstallPath 2^>nul') do set "NODE_REG_PATH=%%b"
if not defined NODE_REG_PATH (
    for /f "tokens=2*" %%a in ('reg query "HKLM\SOFTWARE\WOW6432Node\Node.js" /v InstallPath 2^>nul') do set "NODE_REG_PATH=%%b"
)
if defined NODE_REG_PATH if exist "%NODE_REG_PATH%\npm.cmd" (
    set "FOUND_NODE_PATH=%NODE_REG_PATH%"
    goto :found_node
)

if exist "%APPDATA%\nvm\settings.txt" (
    for /f "tokens=2 delims=:" %%a in ('findstr /c:"version" "%APPDATA%\nvm\settings.txt" 2^>nul') do (
        set "NVM_VER=%%a"
        set "NVM_VER=!NVM_VER: =!"
        if exist "%APPDATA%\nvm\v!NVM_VER!\npm.cmd" (
            set "FOUND_NODE_PATH=%APPDATA%\nvm\v!NVM_VER!"
            goto :found_node
        )
    )
)

set "FOUND_NODE_PATH="
for /f "delims=" %%f in ('dir /s /b "%APPDATA%\fnm\node-versions\installation\npm.cmd" 2^>nul') do set "FOUND_NODE_PATH=%%~dpf"&goto :found_node
set "FOUND_NODE_PATH="
for /f "delims=" %%f in ('dir /s /b "%USERPROFILE%\scoop\apps\nodejs\npm.cmd" 2^>nul') do set "FOUND_NODE_PATH=%%~dpf"&goto :found_node

if exist "%ProgramFiles%\nodejs\npm.cmd" set "FOUND_NODE_PATH=%ProgramFiles%\nodejs" & goto :found_node
if exist "%ProgramW6432%\nodejs\npm.cmd" set "FOUND_NODE_PATH=%ProgramW6432%\nodejs" & goto :found_node
if exist "%ProgramFiles(x86)%\nodejs\npm.cmd" set "FOUND_NODE_PATH=%ProgramFiles(x86)%\nodejs" & goto :found_node
if exist "%LOCALAPPDATA%\Programs\nodejs\npm.cmd" set "FOUND_NODE_PATH=%LOCALAPPDATA%\Programs\nodejs" & goto :found_node
if exist "%APPDATA%\npm\npm.cmd" set "FOUND_NODE_PATH=%APPDATA%\npm" & goto :found_node

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
    for /f "delims=" %%i in ('where node') do (
        set "NODE_DIR=%%~dpi"
        if exist "!NODE_DIR!npm.cmd" (
            set "FOUND_NODE_PATH=!NODE_DIR!"
            goto :found_node
        )
    )
)

for /f "delims=" %%f in ('dir /s /b "%ProgramFiles%\npm.cmd" "%ProgramFiles%\nodejs\npm.cmd" "%ProgramW6432%\npm.cmd" "%ProgramW6432%\nodejs\npm.cmd" 2^>nul') do (
    set "FOUND_NODE_PATH=%%~dpf"
    goto :found_node
)

call :echo_err "npm not found. Please install Node.js from https://nodejs.org"
pause
exit /b 1

:found_node
call :echo_info "Found npm at: %FOUND_NODE_PATH%"
set "PATH=%FOUND_NODE_PATH%;%PATH%"
set "NPM_FULL_PATH=%FOUND_NODE_PATH%\npm.cmd"
exit /b 0

:get_registry
set "CONFIGURED_REGISTRY="
if exist "%USERPROFILE%\.openclaw\npm-registry.txt" (for /f "usebackq delims=" %%a in ("%USERPROFILE%\.openclaw\npm-registry.txt") do set "CONFIGURED_REGISTRY=%%a"&goto :got_reg_end)
:got_reg_end
if "%CONFIGURED_REGISTRY%"=="" set "CONFIGURED_REGISTRY=https://registry.npmmirror.com"
exit /b 0

:pre_install_cleanup
call :echo_info "Stopping Gateway and cleaning old files..."
where openclaw >nul 2>&1
if !ERRORLEVEL! equ 0 (openclaw gateway stop >nul 2>&1&timeout /t 2 /nobreak) else (call :echo_info "openclaw not installed, skipping gateway stop")
if exist "%APPDATA%\npm\openclaw" (del /f /q "%APPDATA%\npm\openclaw" 2>nul&call :echo_info "Deleted old openclaw bin")
if exist "%APPDATA%\npm\openclaw.cmd" (call :echo_info "openclaw.cmd already exists, --force will overwrite")
call :echo_ok "Cleanup complete"&exit /b 0

:refresh_path
for /f "skip=2 tokens=3*" %%a in ('reg query "HKCU\Environment" /v PATH 2^>nul') do set "USER_PATH=%%a%%b"
for /f "skip=2 tokens=3*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v PATH 2^>nul') do set "SYSTEM_PATH=%%a%%b"
set "PATH=%SYSTEM_PATH%;%USER_PATH%;%APPDATA%\npm;%LOCALAPPDATA%\Programs\OpenClaw"
exit /b 0

:patch_config
set "CFG=%USERPROFILE%\.openclaw\config.json"
if not exist "%CFG%" exit /b 0
call :echo_info "Patching config: ensuring gateway.mode and tools.profile..."
powershell -NoProfile -Command ^
"$p='%CFG%';try{$c=Get-Content $p -Raw|ConvertFrom-Json}catch{exit 0};" ^
"$d=$false;" ^
"if(-not $c.gateway){$c.gateway=@{}};" ^
"if(-not $c.gateway.mode){$c.gateway.mode='local';$d=$true;Write-Output '  gateway.mode set to local'};" ^
"if(-not $c.tools -or $c.tools.profile -ne 'full'){" ^
"  if(-not $c.tools){$c.tools=@{}};" ^
"  $c.tools.profile='full';" ^
"  if(-not $c.tools.sessions){$c.tools.sessions=@{}};" ^
"  $c.tools.sessions.visibility='all';" ^
"  $d=$true;Write-Output '  tools.profile set to full'};" ^
"if($d){$c|ConvertTo-Json -Depth 10|Set-Content $p -Encoding UTF8;Write-Output 'Config patched'; exit 0}else{exit 1}"
if %ERRORLEVEL% equ 0 (
    call :echo_ok "Config patched"
) else (
    call :echo_info "Config is up to date"
)
exit /b 0

:install_gateway
call :echo_info "Installing Gateway service..."
where openclaw >nul 2>&1
if !ERRORLEVEL! equ 0 (
    openclaw gateway stop >nul 2>&1
    timeout /t 2 /nobreak >nul
    call :echo_info "Running: openclaw gateway install"
    openclaw gateway install 2>&1
    if !ERRORLEVEL! equ 0 (call :echo_ok "Gateway service installed") else (call :echo_warn "Gateway install failed, run manually: openclaw gateway install")
) else (
    call :echo_warn "openclaw not found in PATH after install, skipping gateway install"
)
exit /b 0

:start
echo.
echo =========================================================
echo        OpenClaw Installation (via npm)
echo =========================================================
echo.
echo [INFO] source=%SOURCE%, version=%VER%
echo.

call :check_admin
if %ERRORLEVEL% neq 0 (
    pause
    exit /b %ERRORLEVEL%
)

call :check_npm
if %ERRORLEVEL% neq 0 (
    pause
    exit /b %ERRORLEVEL%
)
call :pre_install_cleanup
call :get_registry

set "REGISTRY=%CONFIGURED_REGISTRY%"

echo %PKG_NAME% | findstr "openclaw-zh" >nul 2>&1
if !ERRORLEVEL! equ 0 (
    echo %CONFIGURED_REGISTRY% | findstr /i "npmmirror.com taobao.org" >nul 2>&1
    if !ERRORLEVEL! neq 0 set "REGISTRY=https://registry.npmjs.org"
)

echo.
echo [INFO] === Starting npm Install ===
echo.

set "MIRROR_ATTEMPT=0"

:run_npm_install
    echo [INFO] Running: npm install -g %PKG_NAME%@%VER% --force --registry %REGISTRY%
    echo [INFO] This may take several minutes (5 min timeout)...
    echo.
    if "%NPM_FULL_PATH%"=="" set "NPM_FULL_PATH=npm"
    powershell -NoProfile -Command ^
"$out='%TEMP%\npm_out.log'; $err='%TEMP%\npm_err.log';" ^
"$p=Start-Process -FilePath '%NPM_FULL_PATH%' -ArgumentList 'install','-g','%PKG_NAME%@%VER%','--force','--registry','%REGISTRY%','--no-audit','--no-fund' -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err -PassThru;" ^
"for($i=300;$i -gt 0 -and -not $p.HasExited;$i--){Start-Sleep 1;if($i -match '0$'){Write-Host ('  ... ' + $i + 's remaining')}};" ^
"if(-not $p.HasExited){$p.Kill();Write-Host 'TIMEOUT';exit 1};" ^
"exit $p.ExitCode"
    set "NPM_RESULT=!ERRORLEVEL!"
    if exist "%TEMP%\npm_err.log" type "%TEMP%\npm_err.log" 2>nul

if !NPM_RESULT! neq 0 (
    set /a "MIRROR_ATTEMPT+=1"
    call :echo_err "npm install failed (exit code: !NPM_RESULT!)"
    if !MIRROR_ATTEMPT! geq 4 (
        call :echo_err "All registries failed, giving up"
        pause
        exit /b 1
    )
    if !MIRROR_ATTEMPT! equ 1 set "REGISTRY=https://mirrors.cloud.tencent.com/npm/"&call :echo_warn "Mirror failed, switching to Tencent Cloud mirror..."
    if !MIRROR_ATTEMPT! equ 2 set "REGISTRY=https://mirrors.huaweicloud.com/repository/npm/"&call :echo_warn "Mirror failed, switching to Huawei Cloud mirror..."
    if !MIRROR_ATTEMPT! equ 3 set "REGISTRY=https://registry.npmjs.org"&call :echo_warn "All mirrors failed, switching to official registry..."
    echo.
    goto :run_npm_install
)

call :refresh_path

echo.
call :install_gateway

echo.
call :patch_config

echo.
echo [OK]   ==================================================
echo [OK]     . OpenClaw installation complete, version: %VER%
echo [OK]   ==================================================
echo.
if "%~3" neq "--silent" (
    pause
)
exit /b 0
