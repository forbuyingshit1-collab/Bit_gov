const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
const THAI_MONTHS = new Map([
  ["ม.ค.", 1], ["ก.พ.", 2], ["มี.ค.", 3], ["เม.ย.", 4], ["พ.ค.", 5], ["มิ.ย.", 6],
  ["ก.ค.", 7], ["ส.ค.", 8], ["ก.ย.", 9], ["ต.ค.", 10], ["พ.ย.", 11], ["ธ.ค.", 12],
]);
const ISAN_PROVINCES = new Set([
  "กาฬสินธุ์", "ขอนแก่น", "ชัยภูมิ", "นครพนม", "นครราชสีมา", "บึงกาฬ", "บุรีรัมย์", "มหาสารคาม",
  "มุกดาหาร", "ยโสธร", "ร้อยเอ็ด", "ศรีสะเกษ", "สกลนคร", "สุรินทร์", "หนองคาย", "หนองบัวลำภู",
  "อำนาจเจริญ", "อุดรธานี", "อุบลราชธานี", "เลย",
]);

const CATEGORY_RULES = [
  { category: "เครื่องพิมพ์", include: [/เครื่องพิมพ์|printer|multifunction|มัลติฟังก์ชัน|หมึกพิมพ์|ตลับหมึก/i], exclude: [], subcategories: [
    ["ซ่อมและบำรุงรักษา", /ซ่อม|บำรุงรักษา|maintenance/i], ["เช่าเครื่องพิมพ์", /เช่า|rent/i],
    ["หมึกและวัสดุสิ้นเปลือง", /หมึก|ตลับหมึก|toner|drum|ribbon/i], ["ตัวเครื่องและมัลติฟังก์ชัน", /./],
  ] },
  { category: "จอ LED", include: [/จอ\s*led|led\s*(display|screen|wall)|video\s*wall|ป้ายดิจิทัล/i], exclude: [/ไฟถนน|หลอดไฟ|โคมไฟ/i], subcategories: [
    ["Video Wall", /video\s*wall/i], ["ป้ายดิจิทัล", /ป้ายดิจิทัล|digital\s*signage/i], ["จอ LED", /./],
  ] },
  { category: "จอ Interactive", include: [/interactive|กระดานอัจฉริยะ|จออัจฉริยะ|smart\s*board/i], exclude: [], subcategories: [
    ["ห้องเรียนอัจฉริยะ", /ห้องเรียน|classroom/i], ["กระดานอัจฉริยะ", /กระดาน|smart\s*board/i], ["จอ Interactive", /./],
  ] },
  { category: "ระบบเสียงและแสง", include: [/ระบบเสียง|ระบบแสง|sound\s*system|lighting\s*system/i], exclude: [/เช่า.*(เวที|เครื่องเสียง|แสง)|รับจ้าง.*อีเวนต์/i], subcategories: [
    ["ระบบเสียง", /ระบบเสียง|sound\s*system/i], ["ระบบแสง", /ระบบแสง|lighting\s*system/i], ["ระบบเสียงและแสงแบบบูรณาการ", /./],
  ] },
  { category: "ความปลอดภัย", include: [/cctv|กล้องวงจรปิด|nvr|dvr|vms|access\s*control|control\s*room/i], exclude: [], subcategories: [
    ["Access Control", /access\s*control|ควบคุมการเข้าออก/i], ["VMS และห้องควบคุม", /vms|control\s*room|ห้องควบคุม/i],
    ["เครื่องบันทึก NVR/DVR", /nvr|dvr|เครื่องบันทึก/i], ["กล้องวงจรปิด CCTV", /./],
  ] },
];

const FIELD_ALIASES = {
  projectCode: ["project_code", "รหัสโครงการ", "project_id", "เลขที่โครงการ"],
  title: ["project_name", "ชื่อโครงการ", "ชื่อโครงการจัดซื้อจัดจ้าง"],
  description: ["project_description", "รายละเอียดโครงการ", "รายละเอียด"],
  agency: ["agency_name", "ชื่อหน่วยงาน", "หน่วยงาน"],
  department: ["department_name", "หน่วยงานย่อย", "กรม"],
  province: ["province", "จังหวัด"],
  announcementDate: ["announce_date", "วันที่ประกาศ", "วันที่ประกาศผล"],
  budget: ["budget", "งบประมาณ", "งบประมาณ(บาท)", "project_budget"],
  referencePrice: ["reference_price", "ราคากลาง", "ราคากลาง(บาท)"],
  agreedPrice: ["agreed_price", "ราคาที่ตกลง", "ราคาตกลง", "ราคาตกลงซื้อ/จ้าง"],
  contractPrice: ["contract_price", "ราคาสัญญา", "งบสัญญา(บาท)"],
  contractNumber: ["contract_number", "เลขที่สัญญา"],
  contractDate: ["contract_date", "วันที่ทำสัญญา", "วันที่ลงนามสัญญา"],
  supplier: ["supplier_name", "ชื่อผู้ชนะ", "ผู้ชนะ", "คู่สัญญา"],
  supplierTaxId: ["supplier_tax_id", "เลขนิติบุคคล", "เลขประจำตัวผู้เสียภาษี"],
};

export function normalizeText(value) {
  return String(value ?? "").replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit))).replace(/\s+/g, " ").trim();
}

function field(record, aliases) {
  for (const alias of aliases) if (record[alias] !== undefined && record[alias] !== null && record[alias] !== "") return record[alias];
  return null;
}

export function toSatang(value) {
  const text = normalizeText(value).replace(/[฿,]/g, "");
  if (!text) return null;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

export function thaiDateToIso(value) {
  const text = normalizeText(value).replace(/\//g, "-");
  const thaiMonthMatch = /^(\d{1,2})\s+([^\s]+)\s+(\d{2,4})$/.exec(text);
  if (thaiMonthMatch && THAI_MONTHS.has(thaiMonthMatch[2])) {
    const [, day, thaiMonth, year] = thaiMonthMatch;
    let numericYear = Number(year);
    if (numericYear > 2400) numericYear -= 543;
    // EGP CSV abbreviates Buddhist Era years (e.g. 67 means 2567, or 2024 CE).
    if (numericYear < 100) numericYear += 1957;
    const month = String(THAI_MONTHS.get(thaiMonth)).padStart(2, "0");
    const iso = `${numericYear}-${month}-${day.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
  }
  const match = /^(\d{1,2})-(\d{1,2})-(\d{2,4})$/.exec(text);
  if (!match) return null;
  let [, day, month, year] = match;
  let numericYear = Number(year);
  if (numericYear > 2400) numericYear -= 543;
  if (numericYear < 100) numericYear += 1957;
  const iso = `${numericYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

export function normalizeSupplierName(value) {
  return normalizeText(value).replace(/^(บริษัท|ห้างหุ้นส่วนจำกัด|หจก\.)\s*/i, "").replace(/\s*(จำกัด|มหาชน)$/i, "").trim();
}

export function classifyProduct(title, description) {
  const text = `${normalizeText(title)} ${normalizeText(description)}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.include.some((expression) => expression.test(text)) && !rule.exclude.some((expression) => expression.test(text))) {
      const subcategory = rule.subcategories.find(([, expression]) => expression.test(text))?.[0] ?? null;
      return { category: rule.category, subcategory, confidence: 0.9, reason: "keyword_rule" };
    }
  }
  return null;
}

export function locateIsan(record) {
  const province = normalizeText(field(record, FIELD_ALIASES.province));
  if (ISAN_PROVINCES.has(province)) return { province, confidence: 1, reason: "province_field" };
  const text = `${normalizeText(field(record, FIELD_ALIASES.title))} ${normalizeText(field(record, FIELD_ALIASES.description))} ${normalizeText(field(record, FIELD_ALIASES.agency))}`;
  const found = [...ISAN_PROVINCES].find((candidate) => text.includes(candidate));
  return found ? { province: found, confidence: 0.65, reason: "text_reference" } : null;
}

export function normalizeProcurementRecord(record, fiscalYear) {
  const title = normalizeText(field(record, FIELD_ALIASES.title));
  if (!title) return { error: "missing_project_title" };
  const description = normalizeText(field(record, FIELD_ALIASES.description)) || null;
  const agreedPriceSat = toSatang(field(record, FIELD_ALIASES.agreedPrice));
  const contractPriceSat = toSatang(field(record, FIELD_ALIASES.contractPrice));
  const supplierName = normalizeText(field(record, FIELD_ALIASES.supplier)) || null;
  return {
    project: {
      projectCode: normalizeText(field(record, FIELD_ALIASES.projectCode)) || null,
      title, description,
      agencyName: normalizeText(field(record, FIELD_ALIASES.agency)) || null,
      departmentName: normalizeText(field(record, FIELD_ALIASES.department)) || null,
      fiscalYear,
      announcementDateRaw: normalizeText(field(record, FIELD_ALIASES.announcementDate)) || null,
      announcementDateIso: thaiDateToIso(field(record, FIELD_ALIASES.announcementDate)),
      budgetSat: toSatang(field(record, FIELD_ALIASES.budget)),
      referencePriceSat: toSatang(field(record, FIELD_ALIASES.referencePrice)),
    },
    contract: {
      contractNumber: normalizeText(field(record, FIELD_ALIASES.contractNumber)) || null,
      contractDateRaw: normalizeText(field(record, FIELD_ALIASES.contractDate)) || null,
      contractDateIso: thaiDateToIso(field(record, FIELD_ALIASES.contractDate)),
      agreedPriceSat, contractPriceSat,
      winningPriceSat: contractPriceSat ?? agreedPriceSat,
      winningPriceSource: contractPriceSat !== null ? "contract_price" : agreedPriceSat !== null ? "agreed_price" : null,
    },
    supplier: supplierName ? { name: supplierName, normalizedName: normalizeSupplierName(supplierName), taxId: normalizeText(field(record, FIELD_ALIASES.supplierTaxId)) || null } : null,
    productMatch: classifyProduct(title, description),
    locationMatch: locateIsan(record),
  };
}
