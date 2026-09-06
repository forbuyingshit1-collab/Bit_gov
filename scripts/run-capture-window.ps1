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

if ([string]::IsNullOrWhiteSpace($env:FISCAL_YEARS)) { $env:FISCAL_YEARS = '2565:2568' }
$env:LOCAL_UPLOAD = '1'
$env:DIRECT_R2 = '1'
$env:CAPTURE_BYTES = '8388608'
$env:MAX_CHUNKS = '8'
$env:RESOURCE_LIMIT = '1'
$env:CHUNK_DELAY_MS = '15000'
$deadline = (Get-Date).AddMinutes($WindowMinutes)

function Invoke-NormalizationSlice {
  $env:NORMALIZE_BATCH_SIZE = '100'
  $env:NORMALIZE_MAX_ROWS = [string]$NormalizeMaxRows
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
