import test from "node:test";
import assert from "node:assert/strict";
import { fiscalYearDatasetTitle, selectCsvResources } from "../src/ckan.js";

test("builds the exact Thai fiscal-year dataset title", () => {
  assert.equal(
    fiscalYearDatasetTitle(2568),
    "ข้อมูลโครงการจัดซื้อจัดจ้างจากระบบการจัดซื้อจัดจ้างภาครัฐ ปีงบประมาณ 2568",
  );
});

test("selects only active CSV DataStore resources", () => {
  const resources = selectCsvResources({
    resources: [
      { id: "a", format: "CSV", datastore_active: true },
      { id: "b", format: "CSV", datastore_active: false },
      { id: "c", format: "JSON", datastore_active: true },
    ],
  });
  assert.deepEqual(resources.map(({ id }) => id), ["a"]);
});
