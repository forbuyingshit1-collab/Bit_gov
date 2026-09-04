param(
  [int]$WindowMinutes = 330,
  [int]$PauseSeconds = 35
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

foreach ($name in 'DATA_GO_TH_API_KEY','INGESTION_CONTROL_TOKEN','INGESTION_WORKER_URL') {
  $value = [Environment]::GetEnvironmentVariable($name, 'User')
  if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing user environment variable: $name" }
  Set-Item -Path "Env:$name" -Value $value
}

if ([string]::IsNullOrWhiteSpace($env:FISCAL_YEARS)) { $env:FISCAL_YEARS = '2565:2568' }
$env:LOCAL_UPLOAD = '1'
$env:DIRECT_R2 = '1'
$env:CAPTURE_BYTES = '8388608'
$env:MAX_CHUNKS = '1'
$env:RESOURCE_LIMIT = '1'
$env:CHUNK_DELAY_MS = '15000'
$deadline = (Get-Date).AddMinutes($WindowMinutes)

function Invoke-NormalizationSlice {
  $completedPath = Join-Path $root '.bit-gov-completed-captures.json'
  if (-not (Test-Path $completedPath)) { return }
  $completed = Get-Content -Raw $completedPath | ConvertFrom-Json
  $next = $completed.psobject.Properties | Where-Object { -not $_.Value.normalizedAt } | Select-Object -First 1
  if ($null -eq $next) { return }
  $entry = $next.Value
  $env:CAPTURE_RUN_ID = $entry.runId
  $env:RESOURCE_ID = $entry.resourceId
  $env:FISCAL_YEAR = [string]$entry.fiscalYear
  $env:SOURCE_VERSION = $entry.sourceVersion
  $env:SOURCE_CSV_URL = $entry.sourceUrl
  $env:NORMALIZE_MAX_ROWS = '5000'
  node scripts/normalize-csv.mjs
  if ($LASTEXITCODE -ne 0) { throw "Normalization runner stopped with exit code $LASTEXITCODE" }
  $normalizationPath = Join-Path $root '.bit-gov-normalization-state.json'
  $normalization = if (Test-Path $normalizationPath) { Get-Content -Raw $normalizationPath | ConvertFrom-Json } else { [pscustomobject]@{} }
  if ($normalization.psobject.Properties.Name -notcontains $entry.runId) {
    $next.Value.normalizedAt = (Get-Date).ToUniversalTime().ToString('o')
    $completed | ConvertTo-Json -Depth 8 | Set-Content -NoNewline $completedPath
  }
}

while ((Get-Date) -lt $deadline) {
  Invoke-NormalizationSlice
  node scripts/seed-catalog.mjs
  if ($LASTEXITCODE -ne 0) { throw "Capture runner stopped with exit code $LASTEXITCODE" }
  Start-Sleep -Seconds $PauseSeconds
}
