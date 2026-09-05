# BIT GOV

ระบบรวบรวม ตรวจสอบ และวิเคราะห์ข้อมูลจัดซื้อจัดจ้างภาครัฐ โดยเก็บข้อมูลต้นทางให้ครบก่อนจัดหมวดหรือคัดกรอง

## Architecture

- `apps/dashboard` — Next.js Dashboard บน Vercel
- `apps/api-worker` — Cloudflare Worker API
- `apps/ingestion-worker` — Daily sync และ ingestion orchestration
- `packages/database` — D1 schema และ migrations
- `packages/ingestion` — source adapters, mapping และ validation
- `packages/analytics` — category, company matching, recommendation และ forecast
- `packages/shared` — types และ data contracts กลาง
- `packages/test-fixtures` — golden fixtures ที่ไม่มี secret
- `infra` — Cloudflare/Vercel configuration
- `docs` — architecture decisions และ runbooks

## Status

Phase 1: staging ingestion กำลังทำงาน. Dashboard, PIN login, API Worker, ingestion Worker, D1, R2 และ Windows daily resume เชื่อมครบแล้ว ขณะนี้กำลังเก็บ raw source ปี 2565–2568 แบบ resumable ก่อน normalize; ปี 2569 รายงานว่า source ยังไม่พร้อมตามจริง

อ่าน [Architecture decisions](docs/architecture/decisions.md), [Bootstrap runbook](docs/runbooks/bootstrap.md) และ [Daily ingestion runbook](docs/runbooks/daily-ingestion.md) ก่อนดูแลระบบ
