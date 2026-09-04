import test from "node:test";
import assert from "node:assert/strict";
import { buildRawPage, canonicalJson, fingerprintRecord } from "../src/raw.js";

test("canonical JSON is stable across key order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test("record fingerprint is deterministic", async () => {
  assert.equal(
    await fingerprintRecord("resource", { b: 2, a: 1 }),
    await fingerprintRecord("resource", { a: 1, b: 2 }),
  );
});

test("raw page key changes when content changes", async () => {
  const base = { offset: 0, limit: 1, total: 2, fields: [], records: [{ _id: 1 }] };
  const first = await buildRawPage("r", 2568, "v1", base);
  const second = await buildRawPage("r", 2568, "v1", {
    ...base,
    records: [{ _id: 2 }],
  });
  assert.notEqual(first.key, second.key);
  assert.match(first.key, /^raw\/ckan\/fy=2568\/resource=r\/version=v1\/offset=000000000-/);
});
