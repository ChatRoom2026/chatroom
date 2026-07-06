@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title ChatRoom APK 打包

echo ========================================
echo   ChatRoom 手机软件打包
echo ========================================
echo.

:: 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js
    echo 请先安装: https://nodejs.org
    pause
    exit /b 1
)

:: 检查 Java
where java >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Java
    echo 请安装 Java 17: https://adoptium.net
    pause
    exit /b 1
)

:: 检查 Android SDK
if "%ANDROID_HOME%"=="" (
    if "%ANDROID_SDK_ROOT%"=="" (
        echo [提示] 未检测到 ANDROID_HOME 环境变量
        echo.
        echo 打包 APK 需要 Android SDK，推荐安装 Android Studio:
        echo   https://developer.android.com/studio
        echo.
        echo 或者安装命令行工具:
        echo   https://developer.android.com/studio#command-line-tools-only
        echo.
        echo 安装后请设置环境变量 ANDROID_HOME 指向 SDK 目录
        echo 例如: set ANDROID_HOME=C:\Users\你的用户名\AppData\Local\Android\Sdk
        echo.
        set /p CONTINUE="如果已安装但未设置环境变量，请输入 SDK 路径后回车（直接回车跳过）: "
        if not "!CONTINUE!"=="" (
            set ANDROID_HOME=!CONTINUE!
        ) else (
            echo [跳过] 未配置 Android SDK，无法打包 APK
            pause
            exit /b 1
        )
    )
)

echo.
echo [1/4] 读取服务器地址...
:: 从 .env.apk 读取服务器地址
if exist .env.apk (
    for /f "tokens=2 delims==" %%a in ('findstr /c:"VITE_API_BASE" .env.apk') do (
        set APK_SERVER=%%a
    )
    echo   服务器地址: !APK_SERVER!
    :: 复制 .env.apk 到 .env（Vite 构建时读取）
    copy /y .env.apk .env >nul
) else (
    echo   [提示] 未找到 .env.apk，使用默认地址
    echo   如果需要自定义服务器地址，请编辑 .env.apk 文件
)

echo.
echo [2/4] 安装依赖...
call npm install
if %errorlevel% neq 0 (
    echo [错误] 依赖安装失败
    pause
    exit /b 1
)

echo.
echo [3/4] 构建前端...
call npx vite build
if %errorlevel% neq 0 (
    echo [错误] 前端构建失败
    pause
    exit /b 1
)

echo.
echo [4/4] 打包 APK...
call npx cap sync android
if %errorlevel% neq 0 (
    echo [错误] Capacitor 同步失败
    pause
    exit /b 1
)

:: 使用 Gradle 构建 APK
cd android
call gradlew assembleDebug
if %errorlevel% neq 0 (
    echo.
    echo [错误] APK 打包失败
    echo 请确保已安装 Android SDK 并正确配置 ANDROID_HOME
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo ========================================
echo   打包成功！
echo.
echo   APK 文件位置:
echo   android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo   把这个 APK 文件传到手机上安装即可
echo   服务器地址已内置，安装后直接就能用！
echo ========================================
echo.

pause