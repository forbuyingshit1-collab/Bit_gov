# Bootstrap Runbook

## Preconditions

- GitHub authenticated with write access to `forbuyingshit1-collab/Bit_gov`
- Vercel authenticated to the intended team/account
- Cloudflare account upgraded to Workers Paid and Wrangler authenticated
- Never paste credentials or tokens into issues, source files, chat, logs or terminal commands

## Safe order

1. Verify repository access and default branch
2. Establish monorepo folders and baseline CI
3. Create staging-only Cloudflare resources
4. Link `apps/dashboard` to the new Vercel project
5. Add secret names and `.env.example`; inject real values only through platform secret stores
6. Implement one source resource end to end in staging
7. Prove idempotency, row accounting and restore
8. Approve full backfill
9. Create production resources only after staging proof

Do not run database migrations, start ingestion or deploy production before resource linkage and environment-key verification pass.

## Staging resource status

- D1 `bit-gov-staging`: retained read-only as the pre-rebuild rollback database
- D1 `bit-gov-v2-staging`: created and migrated through `0003_capture_progress.sql`; this is the parallel rebuild target
- Queue `bit-gov-ingestion-staging`: created and bound to the deployed ingestion consumer
- R2 `bit-gov-raw-staging`: created 4 September 2026; ingestion binding configured
- API Worker `bit-gov-api-staging`: deployed and smoke-tested through all public read endpoints
- Vercel `bit-gov-dashboard`: Git-linked under team `IQOA`; Production deploy from `main` is active
- Application PIN protection is implemented with server-only hashed configuration
- D1 migration `0002_ingestion_pages.sql`: applied and verified on staging
- Ingestion Worker: deployed with D1/R2/Queue bindings and secrets; cron intentionally disabled
- Source probe: CKAN API is blocked from Cloudflare and Vercel (HTTP 403), while direct CSV range download succeeds (HTTP 206)
- Local acquisition bridge: `scripts/seed-catalog.mjs` discovers resources using the Data.go API-key gateway, downloads one bounded range into the operating-system temporary directory, uploads it directly to R2, removes it immediately, and asks the Worker to verify the actual bytes before moving the checkpoint. Only gitignored resume metadata persists locally.
- Windows task `BitGov-OvernightCapture`: active daily at 01:30, starts after a missed schedule, waits for network, runs on battery, wakes the computer when permitted, and retries transient process failures. Install or repair it with `scripts/install-scheduled-capture.ps1`.
- Bulk capture: FY2568 resource 1 is immutable in R2 (626,564,320 bytes) and has been rehydrated into D1 v2 without downloading it again. The normalizer reads a contiguous, checksum-backed path from R2; the official CSV's missing district/subdistrict headers are repaired by an explicit source-specific mapping before validation.

The checked-in Wrangler configuration contains resource IDs only. It must never contain an API token, source API key, PIN, or PIN hash.
