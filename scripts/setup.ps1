# PulseBridge Complete Build & Setup Script
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PULSEBRIDGE SETUP: BUILDING SERVER & FRONTEND DASHBOARD" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Build Rust Server
Write-Host "`n[1/3] Building PulseBridge Rust Backend..." -ForegroundColor Yellow
Set-Location (Join-Path $root "pulsebridge-server")
cargo build --release
if ($LASTEXITCODE -ne 0) {
    Write-Host "[-] Cargo release build failed, attempting debug build..." -ForegroundColor Yellow
    cargo build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[-] Cargo build failed!" -ForegroundColor Red
        exit 1
    }
}
Write-Host "[+] Rust Server built successfully!" -ForegroundColor Green

# 2. Build React Frontend
Write-Host "`n[2/3] Building React + TypeScript Frontend..." -ForegroundColor Yellow
Set-Location (Join-Path $root "pulsebridge-web")
if (-not (Test-Path "node_modules")) {
    npm install
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "[-] Vite build failed!" -ForegroundColor Red
    exit 1
}
Write-Host "[+] Web Dashboard bundled successfully into dist/!" -ForegroundColor Green

# 3. Setup MCP Server
Write-Host "`n[3/3] Verifying MCP Server..." -ForegroundColor Yellow
Set-Location (Join-Path $root "pulsebridge-mcp")
if (-not (Test-Path "node_modules")) {
    npm install
}
Write-Host "[+] MCP Server dependencies ready!" -ForegroundColor Green

Set-Location $root
Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  PULSEBRIDGE READY! Launch with scripts\start-bridge.bat" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
