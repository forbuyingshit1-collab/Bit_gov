import assert from "node:assert/strict";
import test from "node:test";
import { fiscalYearDatasetTitle, sanitizeDataset } from "./catalog.mjs";

test("uses the exact official fiscal-year dataset title", () => {
  assert.equal(
    fiscalYearDatasetTitle(2568),
    "ข้อมูลโครงการจัดซื้อจัดจ้างจากระบบการจัดซื้อจัดจ้างภาครัฐ ปีงบประมาณ 2568",
  );
});

test("returns only active CSV resources and allowlisted metadata", () => {
  const result = sanitizeDataset({
    id: "dataset-1",
    title: "dataset",
    metadata_modified: "2026-09-04T00:00:00.000000",
    private_note: "must not leave Vercel",
    resources: [
      {
        id: "csv-1",
        name: "contract csv",
        format: "CSV",
        datastore_active: true,
        url: "https://example.test/contracts.csv",
        last_modified: "2026-09-04",
        hash: "sha256",
        secret: "must not leave Vercel",
      },
      { id: "csv-disabled", format: "CSV", datastore_active: false, url: "https://example.test/a" },
      { id: "json-1", format: "JSON", datastore_active: true, url: "https://example.test/b" },
    ],
  });

  assert.deepEqual(result, {
    id: "dataset-1",
    title: "dataset",
    metadata_modified: "2026-09-04T00:00:00.000000",
    resources: [
      {
        id: "csv-1",
        name: "contract csv",
        format: "CSV",
        datastore_active: true,
        url: "https://example.test/contracts.csv",
        last_modified: "2026-09-04",
        hash: "sha256",
      },
    ],
  });
});
