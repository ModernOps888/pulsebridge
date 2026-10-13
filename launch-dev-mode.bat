@echo off
setlocal
title PulseBridge - Full Stack Dev Mode (Rust Backend + Vite HMR Frontend)
cls

echo ====================================================================
echo   PULSEBRIDGE - FULL STACK DEV MODE (1-CLICK LAUNCH)
echo   Supported: Antigravity ^| Cursor AI ^| VS Code ^| Visual Studio
echo.
echo   [1] Rust High-Performance Daemon (Port 8080)
echo   [2] React Vite Dev Server with HMR (Port 5173)
echo   [3] Cloudflare 4G/WAN Quick Tunnel (Global Access)
echo   [4] Automatic Browser Dev Dashboard Launch
echo ====================================================================
echo.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-bridge.ps1" -Port 8080 -Dev %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Server process exited with code %ERRORLEVEL%.
    pause
)
