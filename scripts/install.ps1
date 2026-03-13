#Requires -Version 5.1
<#
.SYNOPSIS
    PYRAMID OS Installation Script
.DESCRIPTION
    Bootstraps the PYRAMID OS development environment on Windows.
    Verifies prerequisites, installs dependencies, builds packages,
    initializes the database, and runs health checks.
.NOTES
    Requirements: Node.js 22+, pnpm, Ollama with gpt-oss:20b and qwen3 models
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step  { param([string]$msg) Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Write-Ok    { param([string]$msg) Write-Host "  ✔ $msg" -ForegroundColor Green }
function Write-Warn  { param([string]$msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$msg) Write-Host "  ✖ $msg" -ForegroundColor Red }
function Write-Info  { param([string]$msg) Write-Host "  ℹ $msg" -ForegroundColor Gray }

function Exit-WithError {
    param([string]$message, [string]$remediation)
    Write-Fail $message
    if ($remediation) { Write-Info "Remediation: $remediation" }
    Write-Host ""
    exit 1
}

$ProjectRoot = Split-Path -Parent $PSScriptRoot

# ── 1. Node.js 22+ ──────────────────────────────────────────────────────────

Write-Step "Checking Node.js version..."

try {
    $nodeVersion = & node --version 2>&1
} catch {
    Exit-WithError "Node.js is not installed or not on PATH." `
        "Install Node.js 22+ from https://nodejs.org/ and ensure it is on your PATH."
}

if ($nodeVersion -match 'v(\d+)') {
    $major = [int]$Matches[1]
    if ($major -lt 22) {
        Exit-WithError "Node.js $nodeVersion detected — version 22+ is required." `
            "Upgrade Node.js from https://nodejs.org/ (LTS 22.x recommended)."
    }
    Write-Ok "Node.js $nodeVersion"
} else {
    Exit-WithError "Unable to parse Node.js version from output: $nodeVersion" `
        "Ensure 'node --version' returns a valid semver string."
}

# ── 2. pnpm ──────────────────────────────────────────────────────────────────

Write-Step "Checking pnpm..."

$pnpmAvailable = $false
try {
    $pnpmVersion = & pnpm --version 2>&1
    $pnpmAvailable = $true
} catch {
    $pnpmAvailable = $false
}

if (-not $pnpmAvailable) {
    Write-Warn "pnpm not found — installing via corepack..."
    try {
        & corepack enable 2>&1 | Out-Null
        & corepack prepare pnpm@latest --activate 2>&1 | Out-Null
        $pnpmVersion = & pnpm --version 2>&1
        Write-Ok "pnpm $pnpmVersion installed via corepack"
    } catch {
        Exit-WithError "Failed to install pnpm automatically." `
            "Install pnpm manually: npm install -g pnpm   or   corepack enable && corepack prepare pnpm@latest --activate"
    }
} else {
    Write-Ok "pnpm $pnpmVersion"
}

# ── 3. Ollama ────────────────────────────────────────────────────────────────

Write-Step "Checking Ollama..."

$ollamaRunning = $false
try {
    $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 5
    $ollamaRunning = $true
} catch {
    $ollamaRunning = $false
}

if (-not $ollamaRunning) {
    Exit-WithError "Ollama is not running or not reachable at http://localhost:11434." `
        "Start Ollama with:  ollama serve   (or launch the Ollama desktop app). Download from https://ollama.com if not installed."
}

Write-Ok "Ollama is running"

# ── 4. Required models ──────────────────────────────────────────────────────

Write-Step "Checking required Ollama models..."

$requiredModels = @("gpt-oss:20b", "qwen3")
$availableModels = @()

try {
    $tagsResponse = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 10
    if ($tagsResponse.models) {
        $availableModels = $tagsResponse.models | ForEach-Object { $_.name }
    }
} catch {
    Write-Warn "Could not retrieve model list from Ollama."
}

$missingModels = @()
foreach ($model in $requiredModels) {
    # Check for exact match or match without tag suffix
    $found = $false
    foreach ($available in $availableModels) {
        if ($available -eq $model -or $available -like "$model*" -or $model -like "$available*") {
            $found = $true
            break
        }
    }
    if ($found) {
        Write-Ok "Model '$model' is available"
    } else {
        $missingModels += $model
        Write-Warn "Model '$model' is NOT available"
    }
}

if ($missingModels.Count -gt 0) {
    Write-Host ""
    Write-Host "  The following models need to be pulled:" -ForegroundColor Yellow
    foreach ($m in $missingModels) {
        Write-Host "    ollama pull $m" -ForegroundColor Yellow
    }
    Write-Host ""

    $pullChoice = Read-Host "  Would you like to pull missing models now? (Y/n)"
    if ($pullChoice -eq "" -or $pullChoice -match "^[Yy]") {
        foreach ($m in $missingModels) {
            Write-Info "Pulling $m — this may take a while..."
            try {
                & ollama pull $m
                Write-Ok "Model '$m' pulled successfully"
            } catch {
                Exit-WithError "Failed to pull model '$m'." `
                    "Run manually:  ollama pull $m"
            }
        }
    } else {
        Write-Warn "Skipping model pull. PYRAMID OS requires these models to function."
        Write-Info "Pull them later with:  ollama pull <model-name>"
    }
}

# ── 5. pnpm install ─────────────────────────────────────────────────────────

Write-Step "Installing dependencies (pnpm install)..."

try {
    Push-Location $ProjectRoot
    & pnpm install --frozen-lockfile 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -ne 0) {
        # Retry without frozen lockfile in case lockfile is stale
        Write-Warn "Frozen lockfile install failed — retrying with regular install..."
        & pnpm install 2>&1 | ForEach-Object { Write-Info $_ }
        if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
    }
    Write-Ok "Dependencies installed"
} catch {
    Exit-WithError "pnpm install failed: $_" `
        "Check network connectivity and try running 'pnpm install' manually in the project root."
} finally {
    Pop-Location
}

# ── 6. Build ─────────────────────────────────────────────────────────────────

Write-Step "Building all packages (pnpm build)..."

try {
    Push-Location $ProjectRoot
    & pnpm build 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed" }
    Write-Ok "All packages built successfully"
} catch {
    Exit-WithError "Build failed: $_" `
        "Run 'pnpm build' manually to see detailed errors. Check TypeScript compilation output."
} finally {
    Pop-Location
}

# ── 7. Initialize SQLite schema ─────────────────────────────────────────────

Write-Step "Initializing database schema..."

try {
    Push-Location $ProjectRoot
    & pnpm exec pyramid-os db init 2>&1 | ForEach-Object { Write-Info $_ }
    if ($LASTEXITCODE -ne 0) { throw "db init failed" }
    Write-Ok "Database schema initialized"
} catch {
    Write-Warn "Database initialization via CLI failed: $_"
    Write-Info "You can initialize the database later with:  pnpm exec pyramid-os db init"
    Write-Info "The database will also auto-initialize on first system start."
} finally {
    Pop-Location
}

# ── 8. Default configuration ────────────────────────────────────────────────

Write-Step "Checking default configuration..."

$configPath = Join-Path $ProjectRoot "config" "default.yaml"

if (Test-Path $configPath) {
    Write-Ok "config/default.yaml already exists"
} else {
    $examplePath = Join-Path $ProjectRoot "config" "default.yaml.example"
    if (Test-Path $examplePath) {
        Write-Info "Copying config/default.yaml.example → config/default.yaml..."
        Copy-Item $examplePath $configPath
        Write-Ok "config/default.yaml created from example"
        Write-Warn "IMPORTANT: Edit config/default.yaml and set a strong api.apiKey before exposing the API"
    } else {
        Write-Info "Creating config/default.yaml with default values..."

    $configDir = Join-Path $ProjectRoot "config"
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }

    $defaultConfig = @"
ollama:
  host: localhost
  port: 11434
  timeout: 30000
  maxConcurrentRequests: 4

connections:
  - name: local
    host: localhost
    port: 25565
    authMethod: none

safety:
  prohibitedBlocks:
    - minecraft:tnt
    - minecraft:lava
    - minecraft:fire
  prohibitedCommands:
    - /op
    - /gamemode
    - /kill
    - /ban
  maxDecisionTimeMs: 30000
  maxActionsPerSecond: 10
  maxReasoningLoops: 50

controlCentre:
  port: 3000
  theme: egyptian
  refreshRateMs: 2000

logging:
  level: info
  outputPath: logs/pyramid-os.log
  maxFileSizeMb: 10

api:
  port: 8080
  apiKey: change-me-in-production
  rateLimitPerMin: 100

database:
  path: data/pyramid-os.db
  poolSize: 5

workspace:
  dataDir: data
  snapshotsDir: data/snapshots
  logsDir: logs

resourceThresholds:
  - resourceType: sandstone
    minimum: 500
    critical: 100
  - resourceType: limestone
    minimum: 300
    critical: 50
  - resourceType: gold_block
    minimum: 50
    critical: 10
  - resourceType: wood
    minimum: 200
    critical: 40
  - resourceType: food
    minimum: 100
    critical: 20
  - resourceType: tools
    minimum: 20
    critical: 5
  - resourceType: stone
    minimum: 400
    critical: 80
  - resourceType: iron
    minimum: 100
    critical: 20
"@

    Set-Content -Path $configPath -Value $defaultConfig -Encoding UTF8
    Write-Ok "config/default.yaml created"
    Write-Warn "IMPORTANT: Edit config/default.yaml and set a strong api.apiKey before exposing the API"
    } # end else (no example file)
}

# ── 9. Health checks ────────────────────────────────────────────────────────

Write-Step "Running health checks..."

$healthResults = @()

# Ollama health
try {
    $null = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 5
    $healthResults += @{ Component = "Ollama"; Status = "OK" }
} catch {
    $healthResults += @{ Component = "Ollama"; Status = "FAIL" }
}

# Database directory
$dbDir = Join-Path $ProjectRoot "data"
if (-not (Test-Path $dbDir)) {
    New-Item -ItemType Directory -Path $dbDir -Force | Out-Null
}
$healthResults += @{ Component = "Data directory"; Status = "OK" }

# Logs directory
$logsDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}
$healthResults += @{ Component = "Logs directory"; Status = "OK" }

# Config file
if (Test-Path $configPath) {
    $healthResults += @{ Component = "Configuration"; Status = "OK" }
} else {
    $healthResults += @{ Component = "Configuration"; Status = "FAIL" }
}

# Node modules
$nodeModulesPath = Join-Path $ProjectRoot "node_modules"
if (Test-Path $nodeModulesPath) {
    $healthResults += @{ Component = "Dependencies"; Status = "OK" }
} else {
    $healthResults += @{ Component = "Dependencies"; Status = "FAIL" }
}

# Built packages check
$distCheck = Join-Path $ProjectRoot "packages" "shared-types" "dist"
if (Test-Path $distCheck) {
    $healthResults += @{ Component = "Build output"; Status = "OK" }
} else {
    $healthResults += @{ Component = "Build output"; Status = "WARN" }
}

# Print results
Write-Host ""
Write-Host "  ┌──────────────────────┬────────┐" -ForegroundColor Cyan
Write-Host "  │ Component            │ Status │" -ForegroundColor Cyan
Write-Host "  ├──────────────────────┼────────┤" -ForegroundColor Cyan

foreach ($result in $healthResults) {
    $name = $result.Component.PadRight(20)
    $status = $result.Status
    $color = switch ($status) {
        "OK"   { "Green" }
        "WARN" { "Yellow" }
        "FAIL" { "Red" }
        default { "Gray" }
    }
    Write-Host "  │ $name │ " -ForegroundColor Cyan -NoNewline
    Write-Host $status.PadRight(5) -ForegroundColor $color -NoNewline
    Write-Host " │" -ForegroundColor Cyan
}

Write-Host "  └──────────────────────┴────────┘" -ForegroundColor Cyan

$failures = $healthResults | Where-Object { $_.Status -eq "FAIL" }
if ($failures.Count -gt 0) {
    Write-Host ""
    Write-Fail "Some health checks failed. Review the issues above and re-run this script."
    exit 1
}

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   PYRAMID OS installation complete! 🏛️       ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "    1. Review config/default.yaml and adjust settings" -ForegroundColor Gray
Write-Host "    2. Start the system:  pnpm exec pyramid-os system start" -ForegroundColor Gray
Write-Host "    3. Open Control Centre:  http://localhost:3000" -ForegroundColor Gray
Write-Host ""
