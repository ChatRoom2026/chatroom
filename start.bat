@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title ChatRoom 服务器

echo ========================================
echo   ChatRoom 服务器启动脚本
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 18+
    echo 下载地址: https://nodejs.org
    pause
    exit /b 1
)

echo [1/3] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)

echo.
echo [2/3] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)

echo.
echo [3/3] 启动服务器...
echo.
echo ========================================
echo   服务器启动中...
echo   本机访问: http://localhost:3001
echo   局域网访问: 请查看下方 IP 地址
echo   按 Ctrl+C 停止服务器
echo ========================================
echo.

:: 获取本机 IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    set LOCAL_IP=!LOCAL_IP: =!
    echo   局域网地址: http://!LOCAL_IP!:3001
)

echo.
set NODE_ENV=production
node --max-old-space-size=128 --optimize-for-size --import tsx api/server.ts

pause