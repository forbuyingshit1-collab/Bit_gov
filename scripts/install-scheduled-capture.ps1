param(
  [string]$TaskName = 'BitGov-OvernightCapture',
  [string]$DailyAt = '01:30',
  [string]$BackfillTaskName = 'BitGov-BackfillPump'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'scripts\run-capture-window.ps1'
if (-not (Test-Path -LiteralPath $runner)) { throw "Capture runner not found: $runner" }

$at = [DateTime]::ParseExact($DailyAt, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -WindowMinutes 4 -NormalizeMaxRows 2000" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $at
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -WakeToRun `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Hours 12) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Resume Bit Gov raw capture and normalization without storing source files locally.' -Force | Out-Null

$backfillTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 31)
$backfillSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -WakeToRun `
  -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $BackfillTaskName -Action $action -Trigger $backfillTrigger -Settings $backfillSettings -Description 'Short resumable Bit Gov backfill slices; safe to restart after interruption.' -Force | Out-Null
Get-ScheduledTask -TaskName $TaskName, $BackfillTaskName | Select-Object TaskName, State
