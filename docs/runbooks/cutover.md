# V2 cutover and rollback

Do not deploy `apps/api-worker/wrangler.toml` until the completion-plan gates pass.

1. Run `node scripts/check-data-gate.mjs`. Exit 0 is required. Keep the JSON evidence.
2. Verify the v2 preview against official CSV samples and company contracts. Validate classification and forecast backtesting; verify the current preview PIN, CSV, multi-province pagination and mobile layouts.
3. Confirm the D1 size projection fits the selected database layout. Cloudflare D1 has a hard 10 GB/database limit: https://developers.cloudflare.com/d1/platform/limits/ . Capturing all 43 CSV resources does not demonstrate that the normalized records fit one D1 database.
4. Record current API version and Vercel production deployment before deploying. Preserve the legacy database for 30 days.
5. Deploy API from `apps/api-worker/wrangler.toml`, then promote the validated Dashboard. Run all view smoke checks immediately.

## Recorded rollback target (2026-09-06)

API worker `bit-gov-api-staging` currently runs version `b7412bf3-4d3c-4d8e-a8cd-e7d527771851`. Confirm it again immediately before cutover:

```powershell
node node_modules/wrangler/bin/wrangler.js deployments list --config apps/api-worker/wrangler.toml
```

Use Worker version rollback to restore the **code and bindings** together. Merely deploying current code with the old D1 binding is not a valid rollback: the new API expects migrations 0004 and 0005 that the legacy DB does not contain.

```powershell
node node_modules/wrangler/bin/wrangler.js rollback b7412bf3-4d3c-4d8e-a8cd-e7d527771851 --config apps/api-worker/wrangler.toml
```

Restore the recorded Vercel production deployment if its UI contract is incompatible. Do not delete either database or R2 objects. Rollback procedure is recorded; a post-cutover rollback drill is still pending.
