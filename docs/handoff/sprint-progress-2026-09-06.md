# Three-sprint continuation — 2026-09-06

## Release state

Not complete. Production still uses the legacy API/database. Do not promote the v2 preview or deploy the production API configuration until the saved completion-plan gates pass.

Preview API: https://bit-gov-api-v2-preview.bit-gov.workers.dev

Preview Dashboard: https://bit-gov-dashboard-qqscmfkmo-anantasak-cs-projects.vercel.app

The Vercel preview has deployment protection. The Chrome account tested could not access it; do not remove that protection as a workaround. Authenticated local HTTP verification against the real preview API passed all six views and company CSV. Desktop/mobile visual QA remains outstanding.

## Completed implementation and evidence

- Byte-offset UTF-8 CSV resume, idempotent transactional batch ledger, in-batch deduplication, EOF completion endpoint, and uninterrupted row-ledger proof before a file may be considered normalized.
- Old pre-ledger checkpoints will replay once from immutable R2 at EOF to prove row coverage; they must not be marked complete merely because download finished.
- Catalog checks persisted for FY2565–2569; daily catalog failures do not prevent normalization of already captured raw data. A short-lived resource cache does not refresh the official coverage timestamp.
- Manual review precedence retained across later ingestion; scope=all includes uncategorized projects. Company view and market view are separate; market totals deduplicate product matches.
- Thai company search no longer uses D1 LIKE patterns, which reject long UTF-8 strings. It uses bound substring comparison.
- Independent page filters, pagination preserving province/price inputs, explicit company contract counts, CSV formula protection and Excel BOM. Exports over 5,000 records return an explicit error instead of silently truncating; larger asynchronous exports still need implementation.
- High-score recommendations are labeled suitability, not probability of winning. Forecast remains gated until history is validated.
- 37 automated tests passed across the four workspaces (36 full-suite tests plus the new ledger-proof test). Next build and authenticated six-view HTTP smoke passed before the final ingestion-only changes.
- Migration 0005 applied to v2 only. Latest ingestion deployment: `2d7253d9-19c1-4d2c-a17f-db1f230b58f5`.
- Backfill scheduled every five minutes, four-minute slices, normalization capped by 90-second budget rather than 2,000 rows. Normalization pauses at an 8 GB safety threshold or if capacity cannot be verified; raw R2 capture may continue.

## Actual data, not a completeness claim

At 2026-09-06 11:32 UTC: 43 registered resources, 0 fully normalized resources, 0 unresolved quarantine, 0 missing project/contract lineage, 0 natural-key duplicates, 0 accounting discrepancies.

Resources by FY: 2565=10, 2566=12, 2567=11, 2568=10. FY2569 latest successful exact-title catalog check reported no source; this is the result of that catalog discovery strategy, not proof that no differently named source exists anywhere.

At 11:35 UTC: 50,267 projects, D1 size 200,159,232 bytes. Local first-file checkpoint subsequently reached 58,000 rows. Two complete raw files are in R2 and a third is in progress. Counts change as the scheduled worker runs.

## Capacity migration in progress

`node scripts/check-capacity.mjs` estimated roughly 67 GB from a very early two-file sample. This is not an exact forecast: file schemas, deduplication and sizes vary, and checkpoint replay distorts the estimate. It does show that assuming all data fits a single 10 GB D1 database is unsafe.

Sixteen APAC staging D1 shards are provisioned and migrated. The staging ingestion Worker has all bindings and routes source data deterministically by resource ID. The initial FY2568 rehydrated source is writing to its routed shard; raw R2 capture remains continuous. Preserve R2 objects and checkpoints. Do not silently reduce source scope to make one D1 fit. Cross-partition project deduplication, roll-up counts, pagination and exports still need tests before migration/cutover.

## Remaining work in order

1. Validate partition size with additional real samples and implement the chosen layout, routing, cross-partition querying and rebuild from R2.
2. Pin immutable source version to each sync run. Current capture-status compares mutable source-resource metadata, which is insufficient to prove that a completed run matches a later changed resource. Fix this and add changed-resource tests before claiming daily incremental sync is complete.
3. Complete normalization across all published years; inspect quarantine, enforce row-ledger proof, verify resource versions, then run `node scripts/check-data-gate.mjs`. Current gate is false.
4. Compare both legal entities by verified tax IDs and official contract samples; reclassify older ingested rows under the latest rules. Low current company counts do not prove source completeness.
5. Finish recommendation explanations in UI and validate forecast history/backtesting before exposing forecasts. Finish review pagination and large exports.
6. Verify mobile/desktop visual interactions and protected preview under the correct account, compare official samples and legacy, then exercise cutover/rollback per `docs/runbooks/cutover.md`.

Keep the previous database for at least 30 days after successful cutover. No production cutover or legacy deletion has occurred.
