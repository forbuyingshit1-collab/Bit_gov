param(
  [int]$WindowMinutes = 330,
  [int]$PauseSeconds = 10,
  [int]$NormalizeMaxRows = 50000
)

$ErrorActionPreference = 'Stop'
if ($WindowMinutes -lt 1) { throw 'WindowMinutes must be at least 1' }
if ($NormalizeMaxRows -lt 1 -or $NormalizeMaxRows -gt 50000) { throw 'NormalizeMaxRows must be 1..50000' }
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logDirectory = Join-Path $root '.bit-gov-logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory ("capture-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Get-ChildItem -LiteralPath $logDirectory -Filter 'capture-*.log' -File |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-14) |
  Remove-Item -Force
$mutex = New-Object System.Threading.Mutex($false, 'Global\BitGovCaptureRunner')
if (-not $mutex.WaitOne(0)) { return }

try {
Start-Transcript -LiteralPath $logPath | Out-Null

foreach ($name in 'DATA_GO_TH_API_KEY','INGESTION_CONTROL_TOKEN','INGESTION_WORKER_URL') {
  $value = [Environment]::GetEnvironmentVariable($name, 'User')
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing user environment variable: $name" }
  Set-Item -Path "Env:$name" -Value $value
}

if ([string]::IsNullOrWhiteSpace($env:FISCAL_YEARS)) { $env:FISCAL_YEARS = '2565:2569' }
$env:LOCAL_UPLOAD = '1'
$env:DIRECT_R2 = '1'
$env:CAPTURE_BYTES = '8388608'
$env:MAX_CHUNKS = '4'
$env:RESOURCE_LIMIT = '1'
$env:CHUNK_DELAY_MS = '15000'
$deadline = (Get-Date).AddMinutes($WindowMinutes)

# Shard migration is deliberately explicit: raw capture continues, but normalizing
# into the single legacy v2 database is paused so it does not grow into a dead end.
$shardMigrationMarker = Join-Path $root '.bit-gov-shard-migration-required'
if (Test-Path -LiteralPath $shardMigrationMarker) {
  Write-Warning 'Shard migration is active; raw R2 capture continues and single-database normalization is paused.'
  $normalizationAllowed = $false
} else {
  $normalizationAllowed = $false
}

# Leave headroom below D1's per-database limit. Raw R2 capture can continue while
# the normalized database layout is expanded; never fill D1 blindly.
if (-not (Test-Path -LiteralPath $shardMigrationMarker)) { try {
  $capacityJson = node node_modules/wrangler/bin/wrangler.js d1 info bit-gov-v2-staging --config apps/ingestion-worker/wrangler.toml --json
  if ($LASTEXITCODE -ne 0) { throw 'D1 capacity query failed' }
  $capacity = ($capacityJson -join "`n") | ConvertFrom-Json
  if ($null -eq $capacity.database_size) { throw 'D1 capacity response missing size' }
  $normalizationAllowed = [long]$capacity.database_size -lt 8000000000
  if (-not $normalizationAllowed) { Write-Warning 'Normalization deferred at 8 GB safety threshold; raw R2 capture continues. Database partitioning is required.' }
} catch { Write-Warning 'Cannot verify D1 capacity; deferring normalization this slice, continuing raw capture.' } }

$catalogStamp = Join-Path $root '.bit-gov-catalog-check-date'
$today = Get-Date -Format 'yyyy-MM-dd'
if (-not (Test-Path -LiteralPath $catalogStamp) -or (Get-Content -LiteralPath $catalogStamp -Raw).Trim() -ne $today) {
  $env:DISCOVERY_ONLY = '1'
  try {
    node scripts/seed-catalog.mjs
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Daily catalog check failed; captured files can still be normalized.' }
    else { Set-Content -LiteralPath $catalogStamp -Value $today }
  } finally { Remove-Item Env:DISCOVERY_ONLY -ErrorAction SilentlyContinue }
}

function Invoke-NormalizationSlice {
  if (-not $normalizationAllowed) { return $true }
  $env:NORMALIZE_BATCH_SIZE = '100'
  $env:NORMALIZE_MAX_ROWS = [string]$NormalizeMaxRows
  $env:NORMALIZE_MAX_MILLISECONDS = '90000'
  $env:NORMALIZE_INPUT = 'r2'
  node scripts/normalize-next-capture.mjs
  if ($LASTEXITCODE -eq 75) {
    Write-Warning 'D1 daily write limit reached; deferring this slice until quota resets.'
    return $false
  }
  if ($LASTEXITCODE -ne 0) { throw "Normalization runner stopped with exit code $LASTEXITCODE" }
  return $true
}

while ((Get-Date) -lt $deadline) {
  $canWrite = Invoke-NormalizationSlice
  if (-not $canWrite) { break }
  node scripts/seed-catalog.mjs
  if ($LASTEXITCODE -ne 0) { throw "Capture runner stopped with exit code $LASTEXITCODE" }
  Start-Sleep -Seconds $PauseSeconds
}
} finally {
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
