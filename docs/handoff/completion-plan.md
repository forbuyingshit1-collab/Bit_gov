# Bit Gov — Completion Plan

## Purpose

Complete the procurement-intelligence data migration and cut over the existing Dashboard to D1 v2 without exposing incomplete data. The Dashboard remains available on its current data source until the quality gate passes.

## Agreed operating decisions

- Ingest fiscal years 2565–2568 in full. Inspect fiscal year 2569 every day.
- Fiscal year 2569 is not a cutover blocker only when Data.go.th has no Source Resource. The UI must say `ยังไม่มี source` and show the latest catalog-check time.
- Store every available record. Dashboard defaults focus on the company-relevant categories but search can include all data.
- Roll up the two company entities on the Company Work page, with an option to view each entity separately.
- Show only high-confidence Recommended Opportunities by default. Medium confidence remains in the review queue.
- Publish maintenance/replacement forecasts only after validated historical data is ready. Label them as trends/opportunities, never live tenders.
- Keep the previous database available for rollback for at least 30 days after cutover.
- Daily sync stays quiet when nothing changes; surface only a new Source Resource, a changed source, or a meaningful failure.

## Sprint 1 — Data foundation

### Deliverables

- Capture immutable, versioned Raw Capture objects in R2 for every discovered Source Resource in fiscal years 2565–2568.
- Normalize into D1 v2 with resumable checkpoints, deduplication, quarantine and source lineage.
- Run the 2569 catalog check daily and persist Published Coverage status.
- Keep Windows scheduled backfill and daily capture jobs running with retries.

### Quality gate

- Each completed sync run satisfies `source = accepted + duplicate + quarantine`.
- No active ingestion errors remain unresolved.
- Natural-key duplicate checks for projects, contracts and awards pass.
- Source Resources and raw records can be traced from every analytic record.

## Sprint 2 — Intelligence

### Deliverables

- Apply main/subcategory product rules, location matching and confidence decisions.
- Maintain separate Company Work for each target legal entity plus a group roll-up.
- Produce high/medium/low opportunity scoring with explainable reasons.
- Keep medium-confidence candidates out of Recommended Opportunities until reviewed.
- Generate forecast candidates only where validated history supports a trend.

### Quality gate

- Category and province fixtures pass, including exclusions.
- Manual review overrides take precedence over rules.
- Forecast cards include historical evidence and the trend disclaimer.

## Sprint 3 — Dashboard cutover

### Deliverables

- Wire API Worker and Dashboard to D1 v2 only after Sprint 1 and 2 gates pass.
- Provide independent filters on every relevant page: multi-province, fiscal year, category/subcategory, price range and date ordering.
- Verify CSV export, charts, PIN flow, pagination and both desktop and mobile views.
- Show data freshness and Published Coverage clearly.

### Cutover gate

- Fiscal years 2565–2568 pass the data quality gate.
- Fiscal year 2569 has either passed the same gate or is visibly marked `ยังไม่มี source` after a successful catalog check.
- Side-by-side sample checks against the legacy database and official source pass.
- Rollback route to the legacy database is documented and tested.

## Post-cutover operations

- Daily source discovery imports only new or changed resources.
- R2 retains immutable raw versions; D1 stores normalized, searchable data.
- Keep the legacy database read-only for 30 days, then retire it only after approval.
- Push the outstanding local commits once GitHub connectivity is restored, then deploy and smoke-test the release.

## Current status

- Detailed implementation evidence and remaining gates: [2026-09-06 continuation](sprint-progress-2026-09-06.md). All three sprints remain open until data, intelligence and cutover verification complete.
- Early measured capacity projection exceeds one D1 database; partitioning must be validated before full normalized backfill. Raw capture continues safely in R2.

- Workers Paid, R2, D1 v2 and scheduled ingestion are active.
- The Dashboard and API are currently healthy on the legacy data source.
- D1 v2 ingestion is in progress; no cutover occurs until the gates above pass.
