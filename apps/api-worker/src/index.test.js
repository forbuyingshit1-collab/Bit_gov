import assert from "node:assert/strict";
import test from "node:test";
import { optionalNonNegativeInteger } from "./index.js";

test("omitted numeric filters do not become zero", () => {
  assert.equal(optionalNonNegativeInteger(null), null);
  assert.equal(optionalNonNegativeInteger(""), null);
});

test("accepts explicit non-negative integer filters", () => {
  assert.equal(optionalNonNegativeInteger("0"), 0);
  assert.equal(optionalNonNegativeInteger("2568"), 2568);
  assert.equal(optionalNonNegativeInteger("-1"), null);
  assert.equal(optionalNonNegativeInteger("1.5"), null);
});
