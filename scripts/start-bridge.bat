@echo off
setlocal
title PulseBridge Core Server
cls

echo ====================================================================
echo   PULSEBRIDGE - UNIVERSAL AI IDE COMPANION
echo   Launching Full Stack: Rust Backend + React Mobile Web + 4G Tunnel
echo ====================================================================
echo.

cd /d "%~dp0\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-bridge.ps1" %*

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Process exited with status code %ERRORLEVEL%.
    pause
)
