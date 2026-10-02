# PulseBridge PowerShell Launcher with Dual Wi-Fi & 4G Cellular Pairing
param(
    [int]$Port = 8080,
    [string]$Pin = "",
    [switch]$NoTunnel,
    [switch]$EnableShellCommands
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PULSEBRIDGE - UNIVERSAL AI IDE COMPANION & REMOTE BRIDGE" -ForegroundColor Green
Write-Host "  Cursor AI | Antigravity | VS Code | Visual Studio" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$serverDir = Resolve-Path (Join-Path $PSScriptRoot "..\pulsebridge-server")
$relExe = Join-Path $serverDir "target\release\pulsebridge-server.exe"
$dbgExe = Join-Path $serverDir "target\debug\pulsebridge-server.exe"
$cloudflaredExe = Join-Path $PSScriptRoot "cloudflared.exe"

$tunnelUrl = ""
$tunnelProc = $null

if (-not $NoTunnel -and (Test-Path $cloudflaredExe)) {
    Write-Host "[*] Initializing secure 4G/WAN Cloudflare Quick Tunnel..." -ForegroundColor Yellow
    $logFile = [System.IO.Path]::GetTempFileName()
    $tunnelProc = Start-Process -FilePath $cloudflaredExe -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port") -NoNewWindow -PassThru -RedirectStandardError $logFile
    
    # Wait up to 6 seconds for trycloudflare.com URL
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Path $logFile) {
            $content = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
            if ($content -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
                $tunnelUrl = $matches[0]
                Write-Host "[+] 4G Cellular Tunnel Active: $tunnelUrl" -ForegroundColor Green
                break
            }
        }
    }
}

$argsList = @("--port", $Port)
if ($Pin -ne "") {
    $argsList += @("--pin", $Pin)
}
if ($tunnelUrl -ne "") {
    $argsList += @("--tunnel-url", $tunnelUrl)
}
if ($EnableShellCommands) {
    $argsList += @("--enable-shell-commands")
}

try {
    if (Test-Path $relExe) {
        Write-Host "[+] Starting PulseBridge Server on port $Port..." -ForegroundColor Green
        & $relExe $argsList
    } elseif (Test-Path $dbgExe) {
        Write-Host "[+] Starting PulseBridge Server on port $Port..." -ForegroundColor Green
        & $dbgExe $argsList
    } else {
        Write-Host "[*] Executable not found. Compiling Rust server with Cargo..." -ForegroundColor Yellow
        Set-Location $serverDir
        cargo run --release -- $argsList
    }
} finally {
    if ($tunnelProc -and -not $tunnelProc.HasExited) {
        Stop-Process -Id $tunnelProc.Id -Force -ErrorAction SilentlyContinue
    }
}
