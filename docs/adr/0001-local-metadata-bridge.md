# Use a local metadata bridge for Data.go discovery

Data.go accepts the authenticated CKAN gateway from the administrator machine but returns 403 from Cloudflare and Vercel. Cloudflare can retrieve an initial public CSV range but has not reliably resumed later ranges. The system therefore uses a local acquisition bridge: it discovers allowlisted Source Resources, streams bounded CSV ranges from the approved source, and forwards each range over a control-token-protected endpoint to immutable R2 storage. Cloudflare remains responsible for R2 storage and D1 processing.

## Consequences

The daily scheduler must run where the approved source API key works. Raw bytes transit from the source to R2 through the administrator machine but are not retained locally; only a gitignored resume checkpoint is written. API keys, control tokens, and user-facing dashboard requests never pass through a checked-in file.
