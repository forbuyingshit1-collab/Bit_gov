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

- D1 `bit-gov-staging`: created and migrated 4 September 2026 (APAC); 21 tables and 7 views verified
- Queue `bit-gov-ingestion-staging`: created and bound to the deployed ingestion consumer
- R2 `bit-gov-raw-staging`: created 4 September 2026; ingestion binding configured
- API Worker `bit-gov-api-staging`: deployed; first-time `workers.dev` TLS/DNS activation pending verification
- Vercel `bit-gov-dashboard`: Git-linked under team `IQOA`; Production deploy from `main` is active
- Application PIN protection is implemented with server-only hashed configuration
- D1 migration `0002_ingestion_pages.sql`: applied and verified on staging
- Ingestion Worker: deployed with D1/R2/Queue bindings and secrets; cron intentionally disabled
- Source probe: CKAN API is blocked from Cloudflare and Vercel (HTTP 403), while direct CSV range download succeeds (HTTP 206)
- Local metadata bridge: `scripts/seed-catalog.mjs` discovers resources using the Data.go API-key gateway then posts allowlisted metadata to the control-token-protected ingestion endpoint. It never uploads raw CSV or writes a secret file.
- Smoke capture: one FY2568 CSV object was written to R2 and verified at 1 MiB; queued bulk work remains disabled pending queue diagnostic and row accounting.

The checked-in Wrangler configuration contains resource IDs only. It must never contain an API token, source API key, PIN, or PIN hash.
