export const dynamic = "force-dynamic";

const apiUrl = process.env.BIT_GOV_API_URL;

async function loadStatus() {
  if (!apiUrl) return { state: "not_configured" };
  try {
    const response = await fetch(`${apiUrl}/v1/status`, { cache: "no-store" });
    if (!response.ok) return { state: "unavailable" };
    return { state: "ready", ...(await response.json()) };
  } catch {
    return { state: "unavailable" };
  }
}

function number(value) {
  return new Intl.NumberFormat("th-TH").format(value ?? 0);
}

export default async function Home() {
  const status = await loadStatus();
  const ready = status.state === "ready";
  const totals = status.totals ?? {};

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">BIT GOV · ระบบใหม่</p>
          <h1>ระบบค้นหางานประมูล</h1>
          <p className="subtitle">เก็บข้อมูลต้นทางให้ครบก่อน แล้วจึงคัดกรองและวิเคราะห์</p>
        </div>
        <span className={`status ${ready ? "ready" : "pending"}`}>
          {ready ? "เชื่อมต่อข้อมูลแล้ว" : "กำลังเชื่อมต่อข้อมูล"}
        </span>
      </header>

      <section className="notice" aria-live="polite">
        <strong>Staging สำหรับตรวจระบบ</strong>
        <span>ยังไม่ใช่ข้อมูล production และยังไม่เปิดการดึงข้อมูลรายวัน</span>
      </section>

      <section className="metrics" aria-label="สถานะข้อมูล">
        <article>
          <span>โครงการ</span>
          <strong>{number(totals.projects)}</strong>
          <small>ข้อมูลที่ผ่าน normalization</small>
        </article>
        <article>
          <span>สัญญา</span>
          <strong>{number(totals.contracts)}</strong>
          <small>แยกจากโครงการตลาด</small>
        </article>
        <article>
          <span>รายการรอตรวจ</span>
          <strong>{number(totals.unresolved_errors)}</strong>
          <small>ไม่ปะปนในรายงานหลัก</small>
        </article>
      </section>

      <section className="next">
        <h2>สถานะการย้ายระบบ</h2>
        <ol>
          <li className="done">Git ใหม่และโครง Monorepo</li>
          <li className="done">Cloudflare D1 และ Queue (staging)</li>
          <li className="active">เปิด R2 สำหรับเก็บไฟล์ดิบถาวร</li>
          <li>เชื่อม API ต้นทางและพิสูจน์จำนวนแถว</li>
          <li>เปิดหน้า Dashboard พร้อม PIN</li>
        </ol>
      </section>
    </main>
  );
}
