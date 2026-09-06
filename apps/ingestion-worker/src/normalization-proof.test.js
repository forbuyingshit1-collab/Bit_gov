import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { hasCompleteBatchCoverage } from './normalization-proof.js';

test('completion requires a gap-free, non-overlapping ledger covering every row', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    sql.exec('CREATE TABLE normalization_batches (run_id TEXT, row_start INTEGER, row_count INTEGER)');
    const db = { prepare(query) { return { bind(...args) { return { first: async () => sql.prepare(query).get(...args) }; } }; } };
    assert.equal(await hasCompleteBatchCoverage(db, 'r', 0), true);
    assert.equal(await hasCompleteBatchCoverage(db, 'r', 100), false);
    sql.exec("INSERT INTO normalization_batches VALUES ('r',100,100)");
    assert.equal(await hasCompleteBatchCoverage(db, 'r', 200), false);
    sql.exec("INSERT INTO normalization_batches VALUES ('r',0,100)");
    assert.equal(await hasCompleteBatchCoverage(db, 'r', 200), true);
    assert.equal(await hasCompleteBatchCoverage(db, 'r', 201), false);
    sql.exec("INSERT INTO normalization_batches VALUES ('r',150,100)");
    assert.equal(await hasCompleteBatchCoverage(db, 'r', 300), false);
  } finally { sql.close(); }
});
