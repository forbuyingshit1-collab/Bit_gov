# Daily ingestion on Windows

The acquisition bridge runs on the administrator machine because the official CKAN gateway accepts its API key there. Raw CSV ranges are uploaded directly to R2 and are not retained locally.

The normalizer reads those immutable R2 chunks back through the authenticated ingestion Worker. It does not re-download a completed source CSV from Data.go.th. If a capture was made before a D1 rebuild, run `node scripts/rehydrate-captured-resource.mjs` once after deploying the Worker bound to the new D1; this records a new completed run against the existing manifest without copying the raw bytes.

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
Get-Content .bit-gov-completed-captures.json
Get-Content .bit-gov-normalization-state.json
```

Do not print the API key or control token. The required values are read from Windows user environment variables at runtime.

Do not deploy the API Worker to the rebuilt D1 until row accounting, duplicate checks, and sample province/company checks pass. The Dashboard remains on its previous database until that cutover.
