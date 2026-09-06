import assert from "node:assert/strict";
import test from "node:test";
import { contiguousRawChunks, contractNaturalIdentity, projectNaturalIdentity, supplierNaturalIdentity } from "./index.js";

test("project identity merges rows with the same project code", () => {
  const project = { projectCode: "65010001" };
  assert.equal(projectNaturalIdentity(project, 2568, "row-a"), projectNaturalIdentity(project, 2568, "row-b"));
});

test("project identity keeps uncoded rows separate", () => {
  const project = { projectCode: null };
  assert.notEqual(projectNaturalIdentity(project, 2568, "row-a"), projectNaturalIdentity(project, 2568, "row-b"));
});

test("contract identity separates contract numbers under one project", () => {
  assert.notEqual(
    contractNaturalIdentity("project-a", { contractNumber: "1/2568" }, "row-a"),
    contractNaturalIdentity("project-a", { contractNumber: "2/2568" }, "row-b"),
  );
});

test("supplier identity prefers a valid tax id over spelling variants", () => {
  assert.equal(
    supplierNaturalIdentity({ taxId: "0105543008219", normalizedName: "บริษัทหนึ่งจำกัด" }),
    supplierNaturalIdentity({ taxId: "0105543008219", normalizedName: "บริษัทหนึ่งจากัด" }),
  );
});

test("supplier identity falls back to normalized name without a valid tax id", () => {
  assert.equal(
    supplierNaturalIdentity({ taxId: null, normalizedName: "บริษัทหนึ่งจำกัด" }),
    "name:บริษัทหนึ่งจำกัด",
  );
});

test("raw manifest selects a contiguous path when earlier capture chunks overlap", () => {
  const base = "raw/source-csv/2568/resource/version";
  const chunks = contiguousRawChunks([
    { key: `${base}/bytes-0-1.csv` },
    { key: `${base}/bytes-2-3.csv` },
    { key: `${base}/bytes-2-7.csv` },
    { key: `${base}/bytes-8-9.csv` },
  ], 10);
  assert.deepEqual(chunks.map((chunk) => chunk.key), [
    `${base}/bytes-0-1.csv`,
    `${base}/bytes-2-7.csv`,
    `${base}/bytes-8-9.csv`,
  ]);
});

test("raw manifest rejects gaps", () => {
  assert.throws(() => contiguousRawChunks([
    { key: "raw/bytes-0-1.csv" },
    { key: "raw/bytes-3-4.csv" },
  ], 5), /gap/);
});
