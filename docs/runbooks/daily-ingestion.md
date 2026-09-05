# Daily ingestion on Windows

The acquisition bridge runs on the administrator machine because the official CKAN gateway accepts its API key there. Raw CSV ranges are uploaded directly to R2 and are not retained locally.

## Install or repair the task

Run PowerShell as the intended Windows user:

```powershell
.\scripts\install-scheduled-capture.ps1
```

The task runs daily at 01:30, starts when a missed schedule becomes available, waits for network access, can run on battery, restarts up to three times after transient failure, and resumes from gitignored checkpoints.
Each run writes a secret-free operational transcript under `.bit-gov-logs/`; logs older than 14 days are removed automatically.

## Inspect without exposing secrets

```powershell
Get-ScheduledTask -TaskName BitGov-OvernightCapture
Get-ScheduledTaskInfo -TaskName BitGov-OvernightCapture
Get-Content .bit-gov-capture-state.json
```

Do not print the API key or control token. The required values are read from Windows user environment variables at runtime.
