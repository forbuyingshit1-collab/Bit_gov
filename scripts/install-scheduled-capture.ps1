param(
  [string]$TaskName = 'BitGov-OvernightCapture',
  [string]$DailyAt = '01:30'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'scripts\run-capture-window.ps1'
if (-not (Test-Path -LiteralPath $runner)) { throw "Capture runner not found: $runner" }

$at = [DateTime]::ParseExact($DailyAt, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Resume Bit Gov raw capture and normalization without storing source files locally.' -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName, State
