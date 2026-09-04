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
- Queue `bit-gov-ingestion-staging`: created 4 September 2026; consumer is not deployed yet
- R2 `bit-gov-raw-staging`: created 4 September 2026; ingestion binding configured
- API Worker `bit-gov-api-staging`: deployed; first-time `workers.dev` TLS/DNS activation pending verification
- Vercel `bit-gov-dashboard`: project linked and Preview deployed from CLI
- Git auto-deploy: waiting for the Vercel GitHub App to be granted access to `forbuyingshit1-collab/Bit_gov`
- Vercel Deployment Protection remains enabled until application PIN protection is implemented and verified

The checked-in Wrangler configuration contains resource IDs only. It must never contain an API token, source API key, PIN, or PIN hash.
