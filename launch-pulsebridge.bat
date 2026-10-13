@echo off
setlocal
title PulseBridge - Universal AI IDE Companion
cls

echo ====================================================================
echo   PULSEBRIDGE - UNIVERSAL AI IDE COMPANION (1-CLICK LAUNCH)
echo   Supported: Antigravity ^| Cursor AI ^| VS Code ^| Visual Studio
echo.
echo   [1] Rust High-Performance Daemon (Port 8080)
echo   [2] Built React Mobile Web Application (Port 8080)
echo   [3] Cloudflare 4G/WAN Quick Tunnel (Global Access)
echo   [4] Automatic Browser Dashboard Launch
echo ====================================================================
echo.

cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-bridge.ps1" -Port 8080 %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Server process exited with code %ERRORLEVEL%.
    pause
)
