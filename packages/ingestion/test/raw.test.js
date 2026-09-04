import test from "node:test";
import assert from "node:assert/strict";
import { buildRawPage, canonicalJson, fingerprintRecord, sha256Hex } from "../src/raw.js";

test("canonical JSON is stable across key order", () => {
  assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }));
});

test("record fingerprint is deterministic", async () => {
  assert.equal(
    await fingerprintRecord("resource", { b: 2, a: 1 }),
    await fingerprintRecord("resource", { a: 1, b: 2 }),
  );
});

test("hashes binary payload bytes instead of its JavaScript object shape", async () => {
  assert.equal(await sha256Hex(new Uint8Array([1, 2, 3])), "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
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
