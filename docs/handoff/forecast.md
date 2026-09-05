# Forecast handoff

## Purpose

`GET /v1/forecast` identifies agencies that may need maintenance, renewal, or replacement based on historical procurement records. It is a planning signal, never proof that an agency has approved a budget or opened a tender.

## Version 1 methodology

- Include only product and location matches that are auto-approved at high confidence or approved by a reviewer.
- Restrict categories to those found in the two approved company supplier identities.
- Group history by agency, province, main category, and subcategory.
- Use a three-year replacement cycle for printers and five years for the other target equipment groups.
- Score company fit from category, agency, province, repeat purchasing, and elapsed asset age.
- Label 75–100 high, 60–74 medium, and below 60 low.
- Keep the API and Dashboard warning `forecast_not_open_tender_confirmation` visible in meaning: the result is not an open-tender confirmation.

## Calibration after backfill

1. Compare predictions generated from fiscal years 2565–2567 against actual records in 2568.
2. Measure precision by category, province, and score band. Do not optimize only for the total hit rate.
3. Replace category-wide lifecycle values with subcategory values only after sufficient samples exist.
4. Add agency budget cadence and median historical amount; avoid using winner identity as evidence that a tender will recur.
5. Promote a new methodology version only with a frozen validation query and documented before/after metrics.

## Known limits

- Data.go contract resources describe historical records and do not prove current tender status.
- Missing bidders remain `unavailable_from_source`; absence must not be interpreted as no competition.
- Fiscal year 2569 remains incomplete until an official source resource is discovered and captured.
- Version 1 is an explainable heuristic, not a statistical probability. The percentage is a fit score and must be displayed as such.

## Operational checks

- `v1/status` must show completed capture and non-zero normalized rows before evaluating forecast quality.
- Medium-confidence location or product matches stay out of forecast until reviewed.
- Company work, market search, recommendations, and forecast must remain separate datasets in both API and UI.
