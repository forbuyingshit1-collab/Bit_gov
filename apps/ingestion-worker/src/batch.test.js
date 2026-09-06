import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { ingestNormalizedRecords } from './index.js';

test('batch replay is atomic and does not inflate row counts; manual rejection survives another contract', async () => {
  const sql = new DatabaseSync(':memory:');
  try {
    const root = new URL('../../../packages/database/migrations/', import.meta.url);
    for (const file of readdirSync(root).sort()) sql.exec(readFileSync(new URL(file, root), 'utf8'));
    sql.exec(`INSERT INTO sources VALUES ('source','test','ckan',NULL,1,'2026-01-01');
      INSERT INTO source_resources VALUES ('ckan:r','source','r',2568,NULL,NULL,NULL,NULL,'2026-01-01','2026-01-01');
      INSERT INTO sync_runs (id,resource_id,run_type,status,started_at) VALUES ('run','ckan:r','local_raw_capture','succeeded','2026-01-01');`);
    const DB = { prepare(query) {
      const statement = sql.prepare(query);
      return { bind(...values) { return { first: async () => statement.get(...values) ?? null, all: async () => ({ results: statement.all(...values) }), run: () => statement.run(...values) }; } };
    }, async batch(statements) {
      sql.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; }
      catch(error) { sql.exec('ROLLBACK'); throw error; }
    } };
    const env = { DB, RAW_BUCKET: { head: async () => ({}) } };
    const row = { project_code: '12345', project_name: 'เครื่องพิมพ์', province: 'ขอนแก่น', contract_number: '1', contract_price: '100', supplier_name: 'บริษัท ทดสอบ จำกัด' };
    const payload = { runId: 'run', resourceId: 'r', fiscalYear: 2568, sourceVersion: 'v1', rowStart: 0, records: [row, row] };
    const first = await ingestNormalizedRecords(payload, env);
    assert.equal(first.acceptedCount, 1); assert.equal(first.duplicateCount, 1);
    assert.deepEqual(await ingestNormalizedRecords(payload, env), first);
    assert.equal(sql.prepare('SELECT source_count FROM sync_runs').get().source_count, 2);
    const project = sql.prepare('SELECT id FROM projects').get();
    sql.prepare("INSERT INTO review_decisions (id,project_id,decision,decided_by,decided_at) VALUES ('decision',?,'reject','test','2026-09-06')").run(project.id);
    await ingestNormalizedRecords({ ...payload, rowStart: 2, records: [{ ...row, contract_number: '2', project_name: 'กล้องวงจรปิด' }] }, env);
    assert.equal(sql.prepare("SELECT decision_status FROM product_matches WHERE category='ความปลอดภัย'").get().decision_status, 'rejected');
    await assert.rejects(() => ingestNormalizedRecords({ ...payload, records: [{ ...row, contract_price: '200' }] }, env), /batch_payload_changed/);
  } finally { sql.close(); }
});
