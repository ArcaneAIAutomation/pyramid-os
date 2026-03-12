#Requires -Version 5.1
<#
.SYNOPSIS
    PYRAMID OS Standalone Health Check Script
.DESCRIPTION
    Runs diagnostics on all PYRAMID OS components and outputs results
    in a formatted table with pass/fail/warn indicators.
    Checks: Ollama, models, SQLite, Minecraft, API server, Control Centre,
    disk space, Node.js, and pnpm.
.PARAMETER config
    Optional path to a YAML/JSON config file. Defaults to config/default.yaml.
.EXAMPLE
    .\scripts\health-check.ps1
    .\scripts\health-check.ps1 -config "config\custom.yaml"
.NOTES
    Requirements: 29.10, 42.2
#>

param(
    [Alias("config")]
    [string]$ConfigPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $PSScriptRoot

# ── Defaults ─────────────────────────────────────────────────────────────────

$defaults = @{
    OllamaHost       = "localhost"
    OllamaPort       = 11434
    RequiredModels    = @("gpt-oss:20b", "qwen3")
    MinecraftHost     = "localhost"
    MinecraftPort     = 25565
    ApiPort           = 8080
    ControlCentrePort = 3000
    DatabasePath      = "data/pyramid-os.db"
}

# ── Config loading (lightweight YAML key: value parsing) ─────────────────────

function Read-SimpleConfig {
    param([string]$Path)

    $cfg = @{}
    if (-not (Test-Path $Path)) { return $cfg }

    $content = Get-Content $Path -Raw -ErrorAction SilentlyContinue
    if (-not $content) { return $cfg }

    # Extract simple key-value pairs from YAML
    if ($content -match '(?m)^\s*host:\s*(.+)$' -and $content -match '(?ms)^ollama:.*?host:\s*(\S+)') {
        $cfg["OllamaHost"] = $Matches[1].Trim()
    }
    if ($content -match '(?ms)^ollama:.*?port:\s*(\d+)') {
        $cfg["OllamaPort"] = [int]$Matches[1]
    }
    if ($content -match '(?ms)^connections:.*?host:\s*(\S+)') {
        $cfg["MinecraftHost"] = $Matches[1].Trim()
    }
    if ($content -match '(?ms)^connections:.*?port:\s*(\d+)') {
        $cfg["MinecraftPort"] = [int]$Matches[1]
    }
    if ($content -match '(?ms)^api:.*?port:\s*(\d+)') {
        $cfg["ApiPort"] = [int]$Matches[1]
    }
    if ($content -match '(?ms)^controlCentre:.*?port:\s*(\d+)') {
        $cfg["ControlCentrePort"] = [int]$Matches[1]
    }
    if ($content -match '(?ms)^database:.*?path:\s*(\S+)') {
        $cfg["DatabasePath"] = $Matches[1].Trim()
    }

    return $cfg
}

# Resolve config path
if (-not $ConfigPath) {
    $ConfigPath = Join-Path $ProjectRoot "config" "default.yaml"
}

$config = $defaults.Clone()
if (Test-Path $ConfigPath) {
    $fileConfig = Read-SimpleConfig $ConfigPath
    foreach ($key in $fileConfig.Keys) {
        $config[$key] = $fileConfig[$key]
    }
}

# ── Results collection ───────────────────────────────────────────────────────

$results = [System.Collections.ArrayList]::new()

function Add-Result {
    param(
        [string]$Component,
        [string]$Status,
        [string]$Details
    )
    [void]$results.Add([PSCustomObject]@{
        Component = $Component
        Status    = $Status
        Details   = $Details
    })
}

# ── 1. Ollama connectivity ───────────────────────────────────────────────────

$ollamaUrl = "http://$($config.OllamaHost):$($config.OllamaPort)/api/tags"
try {
    $response = Invoke-RestMethod -Uri $ollamaUrl -Method Get -TimeoutSec 5
    Add-Result "Ollama" "PASS" "Running at $($config.OllamaHost):$($config.OllamaPort)"
} catch {
    Add-Result "Ollama" "FAIL" "Not reachable at $ollamaUrl"
}

# ── 2. Ollama model availability ─────────────────────────────────────────────

$availableModels = @()
try {
    $tagsResponse = Invoke-RestMethod -Uri $ollamaUrl -Method Get -TimeoutSec 10
    if ($tagsResponse.models) {
        $availableModels = $tagsResponse.models | ForEach-Object { $_.name }
    }
} catch {
    # Ollama not reachable — models can't be checked
}

foreach ($model in $config.RequiredModels) {
    $found = $false
    foreach ($available in $availableModels) {
        if ($available -eq $model -or $available -like "$model*" -or $model -like "$available*") {
            $found = $true
            break
        }
    }
    if ($found) {
        Add-Result "Model: $model" "PASS" "Available in Ollama"
    } else {
        Add-Result "Model: $model" "FAIL" "Not found — run: ollama pull $model"
    }
}

# ── 3. SQLite database ──────────────────────────────────────────────────────

$dbPath = Join-Path $ProjectRoot $config.DatabasePath
if (Test-Path $dbPath) {
    $dbSize = (Get-Item $dbPath).Length
    $dbSizeMB = [math]::Round($dbSize / 1MB, 2)
    Add-Result "SQLite Database" "PASS" "Exists ($dbSizeMB MB) at $($config.DatabasePath)"
} else {
    Add-Result "SQLite Database" "WARN" "Not found at $($config.DatabasePath) — run install first"
}

# ── 4. Minecraft server connectivity ────────────────────────────────────────

$mcHost = $config.MinecraftHost
$mcPort = $config.MinecraftPort
try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $connectTask = $tcpClient.ConnectAsync($mcHost, $mcPort)
    $completed = $connectTask.Wait(3000)
    if ($completed -and $tcpClient.Connected) {
        Add-Result "Minecraft Server" "PASS" "Reachable at ${mcHost}:${mcPort}"
    } else {
        Add-Result "Minecraft Server" "WARN" "Connection timed out at ${mcHost}:${mcPort}"
    }
    $tcpClient.Close()
} catch {
    Add-Result "Minecraft Server" "WARN" "Not reachable at ${mcHost}:${mcPort}"
}

# ── 5. API server ───────────────────────────────────────────────────────────

$apiUrl = "http://localhost:$($config.ApiPort)/health"
try {
    $null = Invoke-RestMethod -Uri $apiUrl -Method Get -TimeoutSec 5
    Add-Result "API Server" "PASS" "Running on port $($config.ApiPort)"
} catch {
    Add-Result "API Server" "WARN" "Not responding at $apiUrl"
}

# ── 6. Control Centre ──────────────────────────────────────────────────────

$ccUrl = "http://localhost:$($config.ControlCentrePort)"
try {
    $null = Invoke-WebRequest -Uri $ccUrl -Method Get -TimeoutSec 5 -UseBasicParsing
    Add-Result "Control Centre" "PASS" "Running on port $($config.ControlCentrePort)"
} catch {
    Add-Result "Control Centre" "WARN" "Not responding at $ccUrl"
}

# ── 7. Disk space ───────────────────────────────────────────────────────────

try {
    $drive = (Get-Item $ProjectRoot).PSDrive
    $freeGB = [math]::Round($drive.Free / 1GB, 2)
    if ($freeGB -ge 5) {
        Add-Result "Disk Space" "PASS" "${freeGB} GB free on $($drive.Name): drive"
    } elseif ($freeGB -ge 1) {
        Add-Result "Disk Space" "WARN" "${freeGB} GB free — consider freeing space"
    } else {
        Add-Result "Disk Space" "FAIL" "${freeGB} GB free — critically low"
    }
} catch {
    Add-Result "Disk Space" "WARN" "Unable to determine free space"
}

# ── 8. Node.js version ─────────────────────────────────────────────────────

try {
    $nodeVersion = & node --version 2>&1
    if ($nodeVersion -match 'v(\d+)') {
        $major = [int]$Matches[1]
        if ($major -ge 22) {
            Add-Result "Node.js" "PASS" "$nodeVersion"
        } else {
            Add-Result "Node.js" "FAIL" "$nodeVersion — version 22+ required"
        }
    } else {
        Add-Result "Node.js" "FAIL" "Unable to parse version: $nodeVersion"
    }
} catch {
    Add-Result "Node.js" "FAIL" "Not installed or not on PATH"
}

# ── 9. pnpm availability ───────────────────────────────────────────────────

try {
    $pnpmVersion = & pnpm --version 2>&1
    Add-Result "pnpm" "PASS" "v$pnpmVersion"
} catch {
    Add-Result "pnpm" "FAIL" "Not installed or not on PATH"
}

# ── Output ──────────────────────────────────────────────────────────────────

$colComponent = 24
$colStatus = 6
$colDetails = 60

$divComponent = "-" * $colComponent
$divStatus    = "-" * $colStatus
$divDetails   = "-" * $colDetails

Write-Host ""
Write-Host "  PYRAMID OS Health Check" -ForegroundColor Cyan
Write-Host "  $('-' * 40)" -ForegroundColor DarkGray
Write-Host ""

# Table header
$header = "  {0}  {1}  {2}" -f "Component".PadRight($colComponent), "Status".PadRight($colStatus), "Details"
Write-Host $header -ForegroundColor Cyan
Write-Host ("  {0}  {1}  {2}" -f $divComponent, $divStatus, $divDetails) -ForegroundColor DarkGray

# Table rows
foreach ($row in $results) {
    $comp = $row.Component.PadRight($colComponent)
    $statusText = $row.Status.PadRight($colStatus)
    $details = $row.Details

    # Truncate details if too long
    if ($details.Length -gt $colDetails) {
        $details = $details.Substring(0, $colDetails - 3) + "..."
    }

    $statusColor = switch ($row.Status) {
        "PASS" { "Green" }
        "WARN" { "Yellow" }
        "FAIL" { "Red" }
        default { "Gray" }
    }

    Write-Host "  $comp  " -NoNewline
    Write-Host $statusText -ForegroundColor $statusColor -NoNewline
    Write-Host "  $details"
}

# Summary
Write-Host ""
$passCount = ($results | Where-Object { $_.Status -eq "PASS" }).Count
$warnCount = ($results | Where-Object { $_.Status -eq "WARN" }).Count
$failCount = ($results | Where-Object { $_.Status -eq "FAIL" }).Count
$total     = $results.Count

Write-Host "  Summary: " -NoNewline
Write-Host "$passCount passed" -ForegroundColor Green -NoNewline
Write-Host ", " -NoNewline
Write-Host "$warnCount warnings" -ForegroundColor Yellow -NoNewline
Write-Host ", " -NoNewline
Write-Host "$failCount failed" -ForegroundColor Red -NoNewline
Write-Host " out of $total checks"
Write-Host ""

if ($failCount -gt 0) {
    Write-Host "  Some checks FAILED. Review the issues above." -ForegroundColor Red
    Write-Host ""
    exit 1
} elseif ($warnCount -gt 0) {
    Write-Host "  System is operational with warnings." -ForegroundColor Yellow
    Write-Host ""
    exit 0
} else {
    Write-Host "  All checks passed. System is healthy." -ForegroundColor Green
    Write-Host ""
    exit 0
}
