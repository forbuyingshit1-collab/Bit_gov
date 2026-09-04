# Approved Architecture Decisions

อัปเดต: 4 กันยายน 2569

1. ใช้ Private Monorepo `forbuyingshit1-collab/Bit_gov`
2. Clean Build และ port เฉพาะ logic, fixtures และ UI ที่พิสูจน์แล้ว
3. Vercel ใหม่ใช้สำหรับ Dashboard และ PIN Login
4. Cloudflare Workers Paid ใช้สำหรับ API และ ingestion
5. R2 เก็บข้อมูลดิบทั่วประเทศ ทุกหมวด ตั้งแต่ปี 2565 ถึงปีล่าสุดที่ต้นทางมี แบบ immutable
6. D1 เก็บ normalized data และ analytics; Dashboard เรียกผ่าน Worker API เท่านั้น
7. แยก staging และ production ทุก resource
8. Daily sync เวลา 06:00 และ weekly reconciliation วันอาทิตย์ 02:00 `Asia/Bangkok`
9. Raw objects และ manifest/checksum เก็บถาวร; daily snapshots 30 วัน; month-end snapshots 12 เดือน
10. แจ้งเตือนผ่าน Dashboard และอีเมล
11. รันระบบเก่าและใหม่คู่กันอย่างน้อย 7 วัน และเก็บระบบเก่า read-only 30 วันหลัง cutover
12. Production ต้องพิสูจน์ว่า `source = accepted + duplicate + quarantine` ทุก resource
13. Quarantine ต้องไม่เกิน 1% เว้นแต่ผู้ใช้อนุมัติเป็นกรณีพิเศษ

ห้ามเปลี่ยนข้อตกลงเหล่านี้โดยไม่มีการอนุมัติจากผู้ใช้

## Resource names

| Service | Production | Staging |
| --- | --- | --- |
| Vercel | `bit-gov-dashboard` | Preview deployments |
| API Worker | `bit-gov-api` | `bit-gov-api-staging` |
| Ingestion Worker | `bit-gov-ingestion` | `bit-gov-ingestion-staging` |
| D1 | `bit-gov-prod` | `bit-gov-staging` |
| R2 | `bit-gov-raw-prod` | `bit-gov-raw-staging` |

## Security invariants

- ห้าม commit หรือแสดง API key, PIN, PIN hash, Cloudflare/Vercel/GitHub token
- PIN ต้องเก็บเป็น salted hash และมี rate limit/lockout
- session cookie ต้องเป็น `HttpOnly`, `Secure`, `SameSite=Lax`
- staging/production ใช้ secret และ storage แยกกัน
- ระบบใหม่ห้ามแก้หรือลบระบบเดิมระหว่าง rebuild

