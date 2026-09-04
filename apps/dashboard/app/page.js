export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logoutAction } from "./login/actions";
import { SESSION_COOKIE, verifySessionToken } from "../lib/session.mjs";

const apiUrl = process.env.BIT_GOV_API_URL;
const ISAN_PROVINCES = [
  "กาฬสินธุ์", "ขอนแก่น", "ชัยภูมิ", "นครพนม", "นครราชสีมา", "บึงกาฬ", "บุรีรัมย์", "มหาสารคาม", "มุกดาหาร", "ยโสธร",
  "ร้อยเอ็ด", "ศรีสะเกษ", "สกลนคร", "สุรินทร์", "หนองคาย", "หนองบัวลำภู", "อำนาจเจริญ", "อุดรธานี", "อุบลราชธานี", "เลย",
];
const CATEGORIES = ["เครื่องพิมพ์", "จอ LED", "จอ Interactive", "ระบบเสียงและแสง", "ความปลอดภัย"];
const SUBCATEGORIES = ["ตัวเครื่องและมัลติฟังก์ชัน", "หมึกและวัสดุสิ้นเปลือง", "เช่าเครื่องพิมพ์", "ซ่อมและบำรุงรักษา", "จอ LED", "Video Wall", "ป้ายดิจิทัล", "จอ Interactive", "กระดานอัจฉริยะ", "ห้องเรียนอัจฉริยะ", "ระบบเสียง", "ระบบแสง", "ระบบเสียงและแสงแบบบูรณาการ", "กล้องวงจรปิด CCTV", "เครื่องบันทึก NVR/DVR", "VMS และห้องควบคุม", "Access Control"];

function list(value) { return Array.isArray(value) ? value : value ? [value] : []; }
function number(value) { return new Intl.NumberFormat("th-TH").format(value ?? 0); }
function money(satang) {
  if (satang === null || satang === undefined) return "ไม่ระบุ";
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(satang / 100);
}
function thaiDate(value) {
  if (!value) return "ไม่ระบุวันที่";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(`${value}T00:00:00Z`));
}

function shortMoney(satang) {
  const baht = (satang ?? 0) / 100;
  if (baht >= 1_000_000_000) return `${(baht / 1_000_000_000).toFixed(1)} พันล้าน`;
  if (baht >= 1_000_000) return `${(baht / 1_000_000).toFixed(1)} ล้าน`;
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 }).format(baht);
}

function BarChart({ title, rows, tone = "blue" }) {
  const maximum = Math.max(1, ...rows.map((row) => row.budget_sat ?? 0));
  return <article className="chart-card"><h2>{title}</h2>{rows.length ? <div className="bar-chart">{rows.slice(0, 8).map((row) => <div className="bar-row" key={row.label ?? "unknown"}>
    <div className="bar-label"><span>{row.label || "ไม่ระบุ"}</span><strong>{number(row.project_count)} โครงการ · {shortMoney(row.budget_sat)} บาท</strong></div>
    <div className="bar-track"><span className={tone} style={{ width: `${Math.max(3, ((row.budget_sat ?? 0) / maximum) * 100)}%` }} /></div>
  </div>)}</div> : <div className="chart-empty">กราฟจะแสดงเมื่อข้อมูลชุดแรกพร้อม</div>}</article>;
}

async function loadStatus() {
  if (!apiUrl) return { state: "not_configured", totals: {} };
  try {
    const response = await fetch(`${apiUrl}/v1/status`, { cache: "no-store" });
    return response.ok ? { state: "ready", ...(await response.json()) } : { state: "unavailable", totals: {} };
  } catch { return { state: "unavailable", totals: {} }; }
}

async function loadProjects(filters) {
  if (!apiUrl) return { total: 0, items: [] };
  const url = new URL("/v1/projects", apiUrl);
  if (filters.q) url.searchParams.set("q", filters.q);
  if (filters.provinces.length) url.searchParams.set("provinces", filters.provinces.join(","));
  if (filters.fiscalYear) url.searchParams.set("fiscalYear", filters.fiscalYear);
  if (filters.category) url.searchParams.set("category", filters.category);
  if (filters.subcategory) url.searchParams.set("subcategory", filters.subcategory);
  if (filters.minPrice) url.searchParams.set("minPriceSat", String(Math.round(Number(filters.minPrice) * 100)));
  if (filters.maxPrice) url.searchParams.set("maxPriceSat", String(Math.round(Number(filters.maxPrice) * 100)));
  url.searchParams.set("sort", filters.sort);
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? response.json() : { total: 0, items: [], unavailable: true };
  } catch { return { total: 0, items: [], unavailable: true }; }
}

async function loadMarket(filters) {
  if (!apiUrl) return { categories: [], provinces: [], months: [] };
  const url = new URL("/v1/market-summary", apiUrl);
  if (filters.provinces.length) url.searchParams.set("provinces", filters.provinces.join(","));
  if (filters.fiscalYear) url.searchParams.set("fiscalYear", filters.fiscalYear);
  if (filters.category) url.searchParams.set("category", filters.category);
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? response.json() : { categories: [], provinces: [], months: [] };
  } catch { return { categories: [], provinces: [], months: [] }; }
}

async function loadCompanyWork(filters) {
  if (!apiUrl) return { totals: {}, items: [] };
  const url = new URL("/v1/company-work", apiUrl);
  if (filters.provinces.length) url.searchParams.set("provinces", filters.provinces.join(","));
  if (filters.fiscalYear) url.searchParams.set("fiscalYear", filters.fiscalYear);
  if (filters.category) url.searchParams.set("category", filters.category);
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? response.json() : { totals: {}, items: [] };
  } catch { return { totals: {}, items: [] }; }
}

async function loadRecommendations(filters) {
  if (!apiUrl) return { items: [] };
  const url = new URL("/v1/recommendations", apiUrl);
  if (filters.provinces.length) url.searchParams.set("provinces", filters.provinces.join(","));
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? response.json() : { items: [] };
  } catch { return { items: [] }; }
}

export default async function Home({ searchParams }) {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) redirect("/login");
  const params = await searchParams;
  const hasProvinceParam = Object.prototype.hasOwnProperty.call(params, "province");
  const filters = {
    q: String(params.q ?? "").trim(),
    provinces: hasProvinceParam ? list(params.province).filter((item) => ISAN_PROVINCES.includes(item)) : ["อุดรธานี", "ขอนแก่น"],
    fiscalYear: String(params.fiscalYear ?? ""), category: String(params.category ?? ""), subcategory: String(params.subcategory ?? ""),
    minPrice: String(params.minPrice ?? ""), maxPrice: String(params.maxPrice ?? ""),
    sort: params.sort === "oldest" ? "oldest" : "newest",
  };
  const [status, projects, market, companyWork, recommended] = await Promise.all([loadStatus(), loadProjects(filters), loadMarket(filters), loadCompanyWork(filters), loadRecommendations(filters)]);
  const ready = status.state === "ready";
  const totals = status.totals ?? {};
  const exportParams = new URLSearchParams();
  if (filters.q) exportParams.set("q", filters.q);
  if (filters.provinces.length) exportParams.set("provinces", filters.provinces.join(","));
  if (filters.fiscalYear) exportParams.set("fiscalYear", filters.fiscalYear);
  if (filters.category) exportParams.set("category", filters.category);
  if (filters.subcategory) exportParams.set("subcategory", filters.subcategory);
  if (filters.minPrice) exportParams.set("minPriceSat", String(Math.round(Number(filters.minPrice) * 100)));
  if (filters.maxPrice) exportParams.set("maxPriceSat", String(Math.round(Number(filters.maxPrice) * 100)));
  exportParams.set("sort", filters.sort);

  return (
    <main>
      <header>
        <div><p className="eyebrow">Bid Dashboard</p><h1>ระบบค้นหางานประมูล ภาคอีสาน</h1><p className="subtitle">ค้นหาโครงการภาครัฐ ดูผลงานตลาด และดาวน์โหลดข้อมูลเพื่อวิเคราะห์</p></div>
        <div className="header-actions"><span className={`status ${ready ? "ready" : "pending"}`}>{ready ? "เชื่อมต่อข้อมูลแล้ว" : "กำลังเชื่อมต่อข้อมูล"}</span><form action={logoutAction}><button className="logout" type="submit">ออกจากระบบ</button></form></div>
      </header>

      <nav className="main-nav" aria-label="เมนูหลัก"><a href="#recommended">โครงการแนะนำ</a><a href="#search">ค้นหาโครงการ</a><a href="#overview">ภาพรวมตลาด</a><a href="#company-work">ผลงานบริษัท</a></nav>

      <section id="overview" className="metrics" aria-label="ภาพรวมข้อมูล">
        <article><span>โครงการในฐานข้อมูล</span><strong>{number(totals.projects)}</strong><small>ผ่าน normalization แล้ว</small></article>
        <article><span>สัญญา</span><strong>{number(totals.contracts)}</strong><small>พร้อมวิเคราะห์ผู้ชนะและราคา</small></article>
        <article><span>รายการต้องตรวจ</span><strong>{number(totals.unresolved_errors)}</strong><small>ไม่นำมาปะปนในรายงานหลัก</small></article>
      </section>

      <section className="charts" aria-label="กราฟสรุปตลาด">
        <BarChart title="งบประมาณตามหมวดสินค้า" rows={market.categories} />
        <BarChart title="งบประมาณตามจังหวัด" rows={market.provinces} tone="green" />
      </section>

      <section id="recommended" className="results-section recommended-section">
        <div className="section-heading"><div><h2>โครงการแนะนำ</h2><p>ให้คะแนนจากความคล้ายกับผลงานบริษัทในอดีต ไม่ใช่การยืนยันว่ายังเปิดรับข้อเสนอ</p></div></div>
        {recommended.items?.length ? <div className="recommendation-grid">{recommended.items.slice(0, 6).map((item)=><article className="recommendation-card" key={item.id}><div className={`score score-${item.opportunity_level}`}>{item.opportunity_score}% · โอกาส{item.opportunity_level}</div><h3>{item.title}</h3><p>{item.agency_name || "ไม่ระบุหน่วยงาน"} · {item.province || "ไม่ระบุจังหวัด"}</p><div className="project-tags"><span>{item.category}</span>{item.subcategory ? <span>{item.subcategory}</span> : null}<span>{money(item.budget_sat)}</span></div></article>)}</div> : <div className="empty-state"><strong>กำลังสร้างฐานเปรียบเทียบ</strong><span>คำแนะนำจะเริ่มแสดงเมื่อมีทั้งประวัติบริษัทและโครงการตลาดใน D1</span></div>}
      </section>

      <section id="search" className="filter-panel">
        <div className="section-heading"><div><h2>ค้นหาโครงการ</h2><p>เลือกได้หลายจังหวัด และไม่จำเป็นต้องกรอกครบทุกช่อง</p></div></div>
        <form method="get" className="filters">
          <label className="field field-wide"><span>คำค้น</span><input name="q" defaultValue={filters.q} placeholder="ชื่อโครงการ หน่วยงาน หรือบริษัทผู้ชนะ" /></label>
          <label className="field"><span>ปีงบประมาณ</span><select name="fiscalYear" defaultValue={filters.fiscalYear}><option value="">ทุกปีที่มีข้อมูล</option>{[2569,2568,2567,2566,2565].map((year)=><option key={year}>{year}</option>)}</select></label>
          <label className="field"><span>หมวดสินค้า</span><select name="category" defaultValue={filters.category}><option value="">ทุกหมวดสินค้า</option>{CATEGORIES.map((category)=><option key={category}>{category}</option>)}</select></label>
          <label className="field"><span>หมวดย่อย</span><select name="subcategory" defaultValue={filters.subcategory}><option value="">ทุกหมวดย่อย</option>{SUBCATEGORIES.map((subcategory)=><option key={subcategory}>{subcategory}</option>)}</select></label>
          <label className="field"><span>ราคาต่ำสุด (บาท)</span><input name="minPrice" type="number" min="0" step="1000" defaultValue={filters.minPrice} placeholder="0" /></label>
          <label className="field"><span>ราคาสูงสุด (บาท)</span><input name="maxPrice" type="number" min="0" step="1000" defaultValue={filters.maxPrice} placeholder="ไม่จำกัด" /></label>
          <label className="field"><span>เรียงรายการ</span><select name="sort" defaultValue={filters.sort}><option value="newest">ใหม่ไปเก่า</option><option value="oldest">เก่าไปใหม่</option></select></label>
          <details className="province-picker" open><summary>จังหวัดที่เลือก: {filters.provinces.length || "ทั้งหมด"}</summary><div className="province-grid">{ISAN_PROVINCES.map((province)=><label key={province}><input type="checkbox" name="province" value={province} defaultChecked={filters.provinces.includes(province)} /><span>{province}</span></label>)}</div></details>
          <div className="filter-actions"><button className="primary" type="submit">ค้นหา</button><a className="secondary" href="/">ล้างตัวกรอง</a></div>
        </form>
      </section>

      <section id="results" className="results-section">
        <div className="section-heading"><div><h2>พบ {number(projects.total)} โครงการ</h2><p>รายการที่ระบบค้นพบ ไม่ได้ยืนยันว่ายังเปิดรับข้อเสนอ กรุณาตรวจสอบกับ e-GP ก่อนดำเนินการ</p></div><a className="secondary" href={`/api/export/projects?${exportParams}`}>ดาวน์โหลด CSV</a></div>
        {projects.items?.length ? <div className="project-list">{projects.items.map((project)=><article className="project-card" key={project.id}>
          <div className="project-tags"><span>{project.province || "ไม่ระบุจังหวัด"}</span>{project.category ? <span>{project.category}</span> : null}{project.subcategory ? <span>{project.subcategory}</span> : null}<span>ปี {project.fiscal_year}</span></div>
          <h3>{project.title}</h3><p>{project.agency_name || "ไม่ระบุหน่วยงาน"}</p>
          <dl><div><dt>งบประมาณ</dt><dd>{money(project.budget_sat)}</dd></div><div><dt>ราคาชนะ</dt><dd>{money(project.winning_price_sat)}</dd></div><div><dt>ผู้ชนะ</dt><dd>{project.winner_name || "ยังไม่มีข้อมูล"}</dd></div><div><dt>วันที่ประกาศ</dt><dd>{thaiDate(project.announcement_date_iso)}</dd></div></dl>
        </article>)}</div> : <div className="empty-state"><strong>ยังไม่พบโครงการตามตัวกรองนี้</strong><span>{totals.projects ? "ลองล้างตัวกรองหรือเลือกจังหวัดเพิ่ม" : "ระบบกำลังนำเข้าข้อมูลชุดแรก เมื่อพร้อมรายการจะแสดงที่หน้านี้อัตโนมัติ"}</span></div>}
      </section>

      <section id="company-work" className="results-section company-section">
        <div className="section-heading"><div><h2>ผลงานจริงของบริษัท</h2><p>แสดงเฉพาะสัญญาที่บริษัทของเราเป็นผู้ชนะ แยกจากโครงการตลาดอย่างชัดเจน</p></div></div>
        <div className="company-metrics"><div><span>สัญญาที่พบ</span><strong>{number(companyWork.totals?.project_count)}</strong></div><div><span>มูลค่ารวม</span><strong>{shortMoney(companyWork.totals?.winning_price_sat)} บาท</strong></div><div><span>บริษัทที่พบ</span><strong>{number(companyWork.totals?.company_count)}</strong></div></div>
        {companyWork.items?.length ? <div className="company-table-wrap"><table><thead><tr><th>โครงการ</th><th>หมวด</th><th>จังหวัด/หน่วยงาน</th><th>มูลค่า</th></tr></thead><tbody>{companyWork.items.map((item)=><tr key={item.id}><td><strong>{item.title}</strong><small>{thaiDate(item.announcement_date_iso)}</small></td><td>{item.category || "ผลงานอื่น ๆ"}<small>{item.subcategory}</small></td><td>{item.province || "ไม่ระบุจังหวัด"}<small>{item.agency_name}</small></td><td className="money-cell">{money(item.winning_price_sat)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>กำลังรอข้อมูลผลงานบริษัท</strong><span>เมื่อสัญญาถูก normalize แล้ว รายการจะแสดงในส่วนนี้เท่านั้นและจะไม่ปนกับผลค้นหาตลาด</span></div>}
      </section>
    </main>
  );
}
