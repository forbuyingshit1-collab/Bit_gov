import assert from "node:assert/strict";
import test from "node:test";
import { repairCsvHeaders } from "../src/index.js";

test("repairs the official FY2568 contract CSV with omitted district headers", () => {
  const headers = [
    "ลำดับ", "รหัสโครงการ", "ชื่อโครงการ", "ชื่อประเภทโครงการ", "ชื่อหน่วยงาน", "ชื่อหน่วยงานย่อย",
    "วิธีจัดซื้อฯ", "กลุ่มวิธีจัดซื้อฯ", "วันที่ประกาศ", "งบประมาณ(บาท)", "ราคากลาง(บาท)",
    "ราคาตกลงซื้อ/จ้าง", "ปีงบประมาณ", "วันที่เกิดรายการ", "จังหวัด", "สถานะโครงการ",
    "พิกัดของโครงการ", "ละติจูดโครงการ", "ลองจิจูดโครงการ", "เลขนิติบุคคล", "ชื่อผู้ชนะ",
    "เลขที่สัญญา", "วันที่ลงนามสัญญา", "วันที่สิ้นสุดสัญญา", "งบสัญญา(บาท)", "สถานะสัญญา",
  ];

  const repaired = repairCsvHeaders(headers, 28);
  assert.equal(repaired.length, 28);
  assert.deepEqual(repaired.slice(14, 19), ["จังหวัด", "อำเภอ", "ตำบล", "สถานะโครงการ", "พิกัดของโครงการ"]);
  assert.equal(repaired[21], "เลขนิติบุคคล");
  assert.equal(repaired[22], "ชื่อผู้ชนะ");
});

test("does not guess when an unknown CSV schema has a different column count", () => {
  const headers = ["a", "b"];
  assert.equal(repairCsvHeaders(headers, 3), headers);
});
