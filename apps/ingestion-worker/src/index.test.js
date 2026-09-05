import assert from "node:assert/strict";
import test from "node:test";
import { contractNaturalIdentity, projectNaturalIdentity, supplierNaturalIdentity } from "./index.js";

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
