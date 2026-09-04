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
$env:CAPTURE_BYTES = '1048576'
$env:MAX_CHUNKS = '1'
$env:RESOURCE_LIMIT = '1'
$env:CHUNK_DELAY_MS = '15000'
$deadline = (Get-Date).AddMinutes($WindowMinutes)

while ((Get-Date) -lt $deadline) {
  node scripts/seed-catalog.mjs
  if ($LASTEXITCODE -ne 0) { throw "Capture runner stopped with exit code $LASTEXITCODE" }
  Start-Sleep -Seconds $PauseSeconds
}
