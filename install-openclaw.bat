@echo off
chcp 65001 >nul
title 安装 OpenClaw

echo ========================================
echo     OpenClaw 全局安装脚本 (Windows)
echo ========================================
echo.

:: 检查是否以管理员身份运行
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 请以管理员身份运行此脚本!
    echo        右键单击本文件 ^> 以管理员身份运行
    pause
    exit /b 1
)

echo [信息] 正在检查 npm 是否可用...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 npm 命令，请确保已安装 Node.js
    pause
    exit /b 1
)

echo [信息] npm 已就绪
echo [信息] 开始全局安装 openclaw（淘宝镜像源）...
echo.

:: 执行 npm 安装
npm install -g openclaw --force --registry https://registry.npmmirror.com --verbose

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo     安装成功！
    echo ========================================
) else (
    echo.
    echo ========================================
    echo     [失败] 安装过程中出现错误
    echo ========================================
    echo.
    echo 可能的原因：
    echo   1. 网络连接异常，无法访问 registry.npmmirror.com
    echo   2. 防火墙或代理阻止了 npm 请求
    echo   3. 权限不足（请以管理员身份运行）
    echo   4. npm 缓存问题（尝试: npm cache clean --force）
    echo.
    echo 建议操作：
    echo   - 检查网络连接后重试
    echo   - 尝试切换为官方源: npm install -g openclaw --force --registry https://registry.npmjs.org --verbose
    echo   - 检查 Node.js 版本: node -v
    pause
    exit /b 1
)

pause
exit /b 0
