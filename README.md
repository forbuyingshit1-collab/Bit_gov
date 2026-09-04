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

Phase 0: repository bootstrap. ยังไม่เชื่อม production resource และยังไม่ย้ายข้อมูลจากระบบเดิม

อ่าน [Architecture decisions](docs/architecture/decisions.md) และ [Bootstrap runbook](docs/runbooks/bootstrap.md) ก่อนเริ่มงาน

