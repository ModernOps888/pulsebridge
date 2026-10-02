@echo off
title PulseBridge Core Server
cls
echo ========================================================
echo   Launching PulseBridge - Universal AI IDE Companion
echo   Supported: Antigravity, Cursor AI, VS Code, Visual Studio
echo ========================================================
echo.

cd /d "%~dp0\..\pulsebridge-server"
if exist "target\release\pulsebridge-server.exe" (
    "target\release\pulsebridge-server.exe" --port 8080
) else if exist "target\debug\pulsebridge-server.exe" (
    "target\debug\pulsebridge-server.exe" --port 8080
) else (
    echo Building PulseBridge Rust server binary...
    cargo run -- --port 8080
)

pause
