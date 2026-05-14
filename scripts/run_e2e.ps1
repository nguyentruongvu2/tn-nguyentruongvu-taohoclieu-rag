<#
.SYNOPSIS
    Khởi động Docker backend rồi chạy E2E tests.

.DESCRIPTION
    1. docker compose up backend (detached)
    2. Đợi backend healthy (tối đa 120s)
    3. Chạy test/test_e2e_docker.py
    4. docker compose stop backend (nếu --stop-after)

.PARAMETER StopAfter
    Dừng container sau khi test xong (mặc định: giữ container chạy).

.PARAMETER BaseUrl
    URL của backend (mặc định: http://localhost:8000).

.PARAMETER LlmTimeout
    Timeout (giây) cho các LLM call (mặc định: 120).

.EXAMPLE
    .\scripts\run_e2e.ps1
    .\scripts\run_e2e.ps1 -StopAfter
    .\scripts\run_e2e.ps1 -BaseUrl http://localhost:8000 -LlmTimeout 180
#>
param(
    [switch]$StopAfter,
    [string]$BaseUrl    = "http://localhost:8000",
    [int]   $LlmTimeout = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  RAG Teaching Material — E2E Test Run  " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check Docker ───────────────────────────────────────────────────────────
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error "Docker not found. Install Docker Desktop first."
    exit 1
}

# ── 2. Start backend ──────────────────────────────────────────────────────────
Write-Host "[1/4] Starting backend container..." -ForegroundColor Yellow
Push-Location $ROOT
try {
    docker compose up -d backend 2>&1 | Write-Host
} catch {
    Write-Error "docker compose up failed: $_"
    exit 1
}

# ── 3. Wait for healthy ───────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/4] Waiting for backend to be healthy..." -ForegroundColor Yellow
$maxWait = 120
$elapsed = 0
$ready   = $false

while ($elapsed -lt $maxWait) {
    try {
        $resp = Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch { }

    Start-Sleep -Seconds 3
    $elapsed += 3
    Write-Host "   ...waiting ($elapsed s / $maxWait s)" -ForegroundColor DarkGray
}

if (-not $ready) {
    Write-Error "Backend did not become healthy within ${maxWait}s. Check logs: docker compose logs backend"
    Pop-Location
    exit 1
}

Write-Host "   Backend is UP at $BaseUrl" -ForegroundColor Green
Write-Host ""

# ── 4. Run tests ──────────────────────────────────────────────────────────────
Write-Host "[3/4] Running E2E tests..." -ForegroundColor Yellow
Write-Host ""

$testScript = Join-Path $ROOT "test\test_e2e_docker.py"

# Prefer venv python, fallback to system python
$venvPython = Join-Path $ROOT "backend\venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    $pythonExe = $venvPython
} else {
    $pythonExe = "python"
}

Write-Host "   Python: $pythonExe" -ForegroundColor DarkGray
Write-Host ""

& $pythonExe $testScript --base $BaseUrl --timeout-llm $LlmTimeout
$testExit = $LASTEXITCODE

# ── 5. Optional stop ──────────────────────────────────────────────────────────
if ($StopAfter) {
    Write-Host ""
    Write-Host "[4/4] Stopping backend container..." -ForegroundColor Yellow
    docker compose stop backend 2>&1 | Write-Host
} else {
    Write-Host ""
    Write-Host "[4/4] Backend container left running (use -StopAfter to stop automatically)." -ForegroundColor DarkGray
}

Pop-Location

Write-Host ""
if ($testExit -eq 0) {
    Write-Host "All E2E tests PASSED." -ForegroundColor Green
} else {
    Write-Host "Some E2E tests FAILED (exit code $testExit)." -ForegroundColor Red
}
Write-Host ""
exit $testExit
