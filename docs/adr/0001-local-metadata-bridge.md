# Use a local metadata bridge for Data.go discovery

Data.go accepts the authenticated CKAN gateway from the administrator machine but returns 403 from Cloudflare and Vercel. The system therefore uses a local metadata bridge to submit only allowlisted Source Resource metadata to the control-token-protected ingestion Worker; Cloudflare remains responsible for raw public CSV capture, R2 storage, and D1 processing.

## Consequences

The daily scheduler must run where the approved source API key works, while no raw CSV, API key, or user-facing dashboard request passes through the bridge.
