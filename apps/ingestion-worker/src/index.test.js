import assert from "node:assert/strict";
import test from "node:test";
import { contractNaturalIdentity, projectNaturalIdentity } from "./index.js";

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
