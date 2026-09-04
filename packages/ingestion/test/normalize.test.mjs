import assert from "node:assert/strict";
import test from "node:test";
import { classifyProduct, normalizeProcurementRecord, thaiDateToIso, toSatang } from "../src/index.js";

test("normalizes Thai dates and money into analytic values", () => {
  assert.equal(thaiDateToIso("๑๒/๐๙/๒๕๖๘"), "2025-09-12");
  assert.equal(toSatang("฿7,680.50"), 768050);
});

test("keeps contract price ahead of agreed price and classifies target products", () => {
  const result = normalizeProcurementRecord({
    "รหัสโครงการ": "66119347723",
    "ชื่อโครงการ": "จัดซื้อพร้อมติดตั้งกล้องวงจรปิด CCTV",
    "จังหวัด": "อุดรธานี",
    "งบประมาณ": "1,000,000",
    "ราคาที่ตกลง": "980,000",
    "ราคาสัญญา": "970,000",
    "ชื่อผู้ชนะ": "บริษัท ตัวอย่าง จำกัด",
    "วันที่ประกาศ": "12/09/2568",
  }, 2568);
  assert.equal(result.contract.winningPriceSat, 97000000);
  assert.equal(result.contract.winningPriceSource, "contract_price");
  assert.equal(result.productMatch.category, "ความปลอดภัย");
  assert.equal(result.locationMatch.province, "อุดรธานี");
});

test("excludes LED street lighting", () => {
  assert.equal(classifyProduct("จัดซื้อโคมไฟถนน LED", ""), null);
});

test("maps the official EGP contract CSV headers", () => {
  const result = normalizeProcurementRecord({
    "รหัสโครงการ": "67039549408",
    "ชื่อโครงการ": "จัดซื้อกล้องวงจรปิด",
    "ชื่อหน่วยงาน": "เทศบาลตัวอย่าง",
    "จังหวัด": "อุดรธานี",
    "วันที่ประกาศ": "21 มิ.ย. 67",
    "งบประมาณ(บาท)": "1,250,000.50",
    "ราคากลาง(บาท)": "1,200,000",
    "ราคาตกลงซื้อ/จ้าง": "1,100,000",
    "งบสัญญา(บาท)": "1,050,000",
    "วันที่ลงนามสัญญา": "12 ธ.ค. 67",
    "เลขนิติบุคคล": "0105543008219",
    "ชื่อผู้ชนะ": "บริษัท ตัวอย่าง จำกัด",
  }, 2568);
  assert.equal(result.project.announcementDateIso, "2024-06-21");
  assert.equal(result.project.budgetSat, 125000050);
  assert.equal(result.contract.contractPriceSat, 105000000);
  assert.equal(result.contract.contractDateIso, "2024-12-12");
  assert.equal(result.supplier.taxId, "0105543008219");
});
