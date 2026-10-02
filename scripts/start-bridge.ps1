# PulseBridge PowerShell Launcher
param(
    [int]$Port = 8080,
    [string]$Pin = ""
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PULSEBRIDGE - UNIVERSAL AI IDE COMPANION & REMOTE BRIDGE" -ForegroundColor Green
Write-Host "  Cursor AI | Antigravity | VS Code | Visual Studio" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$serverDir = Resolve-Path (Join-Path $PSScriptRoot "..\pulsebridge-server")
$relExe = Join-Path $serverDir "target\release\pulsebridge-server.exe"
$dbgExe = Join-Path $serverDir "target\debug\pulsebridge-server.exe"

$argsList = @("--port", $Port)
if ($Pin -ne "") {
    $argsList += @("--pin", $Pin)
}

if (Test-Path $relExe) {
    Write-Host "[+] Starting PulseBridge Release Server on port $Port..." -ForegroundColor Green
    & $relExe $argsList
} elseif (Test-Path $dbgExe) {
    Write-Host "[+] Starting PulseBridge Server on port $Port..." -ForegroundColor Green
    & $dbgExe $argsList
} else {
    Write-Host "[*] Executable not found. Compiling Rust server with Cargo..." -ForegroundColor Yellow
    Set-Location $serverDir
    cargo run -- $argsList
}
