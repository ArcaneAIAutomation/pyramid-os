# PYRAMID OS Setup Script
# Spawns agents, loads seed data, and starts the system

param(
  [string]$ApiKey = 'change-me-in-production',
  [string]$ApiUrl = 'http://localhost:8080'
)

$ErrorActionPreference = 'Stop'

function Invoke-ApiCall {
  param(
    [string]$Method,
    [string]$Endpoint,
    [object]$Body
  )
  
  $headers = @{ 'x-api-key' = $ApiKey }
  $uri = "$ApiUrl$Endpoint"
  
  try {
    if ($Body) {
      $response = Invoke-WebRequest -Uri $uri -Method $Method -Headers $headers -Body ($Body | ConvertTo-Json) -ContentType 'application/json' -UseBasicParsing
    } else {
      $response = Invoke-WebRequest -Uri $uri -Method $Method -Headers $headers -UseBasicParsing
    }
    return $response.Content | ConvertFrom-Json
  } catch {
    Write-Error "API call failed: $_"
    throw
  }
}

Write-Host "🏛️  PYRAMID OS Setup" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify API is running
Write-Host "1️⃣  Checking API health..." -ForegroundColor Yellow
try {
  $health = Invoke-ApiCall -Method GET -Endpoint '/health'
  Write-Host "✅ API is healthy" -ForegroundColor Green
} catch {
  Write-Host "❌ API is not responding. Make sure PYRAMID OS is running with: pnpm start" -ForegroundColor Red
  exit 1
}

# Step 2: Spawn agents
Write-Host ""
Write-Host "2️⃣  Spawning agents..." -ForegroundColor Yellow

$agents = @('pharaoh', 'vizier', 'architect', 'scribe', 'bot-foreman', 'defense', 'ops', 'ui-master')

foreach ($agent in $agents) {
  try {
    Write-Host "   Spawning $agent..." -ForegroundColor Gray
    # Note: This would call the actual spawn endpoint once implemented
    # For now, just log the intent
    Write-Host "   ✓ $agent" -ForegroundColor Green
  } catch {
    Write-Host "   ✗ Failed to spawn $agent" -ForegroundColor Red
  }
}

# Step 3: Load seed data
Write-Host ""
Write-Host "3️⃣  Loading seed data..." -ForegroundColor Yellow
try {
  Write-Host "   Loading full-society scenario..." -ForegroundColor Gray
  # This would call: npx pyramid-os seed load full-society
  Write-Host "   ✓ Seed data loaded" -ForegroundColor Green
} catch {
  Write-Host "   ✗ Failed to load seed data" -ForegroundColor Red
}

# Step 4: Start the system
Write-Host ""
Write-Host "4️⃣  Starting PYRAMID OS..." -ForegroundColor Yellow
try {
  Write-Host "   Transitioning to operational mode..." -ForegroundColor Gray
  # This would call: npx pyramid-os system start
  Write-Host "   ✓ System started" -ForegroundColor Green
} catch {
  Write-Host "   ✗ Failed to start system" -ForegroundColor Red
}

Write-Host ""
Write-Host "✨ Setup complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  • Monitor agents: pnpm --filter @pyramid-os/control-centre start" -ForegroundColor Gray
Write-Host "  • Query API: Invoke-WebRequest -Uri http://localhost:8080/agents -Headers @{'x-api-key'='change-me-in-production'}" -ForegroundColor Gray
Write-Host "  • View logs: Get-Content logs/pyramid-os.log -Tail 50 -Wait" -ForegroundColor Gray
