# PulseBridge PowerShell Launcher with Dual Wi-Fi & 4G Cellular Pairing
param(
    [int]$Port = 8080,
    [string]$Pin = $env:PULSEBRIDGE_PIN,
    [switch]$NoTunnel,
    [switch]$EnableShellCommands,
    [switch]$NoBrowser,
    [switch]$Dev
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PULSEBRIDGE - UNIVERSAL AI IDE COMPANION & REMOTE BRIDGE" -ForegroundColor Green
Write-Host "  Cursor AI | Antigravity | VS Code | Visual Studio" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

$serverDir = Resolve-Path (Join-Path $PSScriptRoot "..\pulsebridge-server")
$webDir = Resolve-Path (Join-Path $PSScriptRoot "..\pulsebridge-web")
$distDir = Join-Path $webDir "dist"
$relExe = Join-Path $serverDir "target\release\pulsebridge-server.exe"
$dbgExe = Join-Path $serverDir "target\debug\pulsebridge-server.exe"
$cloudflaredExe = Join-Path $PSScriptRoot "cloudflared.exe"

# 1. Clean up any stale instances on the target port
$staleConns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($staleConns) {
    foreach ($conn in $staleConns) {
        $pidToKill = $conn.OwningProcess
        if ($pidToKill -and $pidToKill -gt 0) {
            Write-Host "[*] Freeing occupied port $Port (terminating PID $pidToKill)..." -ForegroundColor Yellow
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 400
}

# 2. Verify Frontend Dist exists (Build if missing)
if (-not (Test-Path (Join-Path $distDir "index.html"))) {
    Write-Host "[*] React mobile bundle not found in dist. Building frontend..." -ForegroundColor Yellow
    Push-Location $webDir
    npm run build
    Pop-Location
    Write-Host "[+] Frontend bundled successfully!" -ForegroundColor Green
}

# 3. If Dev Mode requested, launch Vite Dev Server on port 5173
$devProc = $null
if ($Dev) {
    Write-Host "[*] Starting React Vite Dev Server (HMR) on port 5173..." -ForegroundColor Cyan
    $devProc = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "cd /d `"$webDir`" && npm run dev") -PassThru -WindowStyle Normal
}

# 4. Initialize Cloudflare 4G/WAN Tunnel
$tunnelUrl = ""
$tunnelProc = $null

if (-not $NoTunnel -and (Test-Path $cloudflaredExe)) {
    Write-Host "[*] Initializing secure 4G/WAN Cloudflare Quick Tunnel..." -ForegroundColor Yellow
    $logFile = [System.IO.Path]::GetTempFileName()
    $tunnelProc = Start-Process -FilePath $cloudflaredExe -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$Port") -NoNewWindow -PassThru -RedirectStandardError $logFile
    
    # Wait up to 15 seconds for trycloudflare.com URL
    for ($i = 0; $i -lt 30; $i++) {
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

# 5. Launch Browser Companion once server is active
if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($Port, $Pin, $IsDev)
        Start-Sleep -Seconds 2
        $targetPort = if ($IsDev) { 5173 } else { $Port }
        
        $queryParts = @()
        if ($Pin) {
            $queryParts += "pin=$Pin"
        }
        $tokenFile = Join-Path $env:TEMP "pulsebridge_tokens.json"
        if (Test-Path $tokenFile) {
            try {
                $raw = Get-Content $tokenFile -Raw -ErrorAction SilentlyContinue
                $arr = ConvertFrom-Json $raw -ErrorAction SilentlyContinue
                if ($arr -and $arr.Count -gt 0) {
                    $queryParts += "token=" + $arr[-1]
                }
            } catch {}
        }
        
        $qs = if ($queryParts.Count -gt 0) { "?" + ($queryParts -join "&") } else { "" }
        $launchUrl = "http://localhost:${targetPort}/${qs}"
        Start-Process $launchUrl
    } -ArgumentList $Port, $Pin, $Dev.IsPresent | Out-Null
}

# 6. Execute PulseBridge Server
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
    if ($devProc -and -not $devProc.HasExited) {
        Stop-Process -Id $devProc.Id -Force -ErrorAction SilentlyContinue
    }
}
