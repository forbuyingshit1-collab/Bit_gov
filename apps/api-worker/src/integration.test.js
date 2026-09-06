import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from './index.js';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  const root = new URL('../../../packages/database/migrations/', import.meta.url);
  for (const file of readdirSync(root).sort()) sqlite.exec(readFileSync(new URL(file, root), 'utf8'));
  sqlite.exec(`INSERT INTO sources VALUES ('source','test','ckan',NULL,1,'2026-01-01');
    INSERT INTO source_resources VALUES ('resource','source','resource',2568,NULL,NULL,NULL,NULL,'2026-01-01','2026-01-01');
    INSERT INTO sync_runs (id,resource_id,run_type,status,started_at) VALUES ('run','resource','local_raw_capture','running','2026-01-01');
    INSERT INTO raw_records VALUES ('raw','resource','run','1','fingerprint','raw/manifest','checksum','2026-01-01');
    INSERT INTO projects (id,title,province,fiscal_year,budget_sat,first_seen_at,last_seen_at,raw_record_id) VALUES ('project:1','เครื่องพิมพ์','ขอนแก่น',2568,10000,'2026-01-01','2026-01-01','raw');
    INSERT INTO product_matches VALUES ('pm1','project:1','เครื่องพิมพ์','ซื้อ',0.9,'test','v1','auto_approved');
    INSERT INTO product_matches VALUES ('pm2','project:1','เครื่องพิมพ์','ซ่อม',0.9,'test','v1','auto_approved');
    INSERT INTO location_matches VALUES ('lm1','project:1','ขอนแก่น',1,'test','auto_approved');
    INSERT INTO projects (id,title,province,fiscal_year,budget_sat,first_seen_at,last_seen_at,raw_record_id) VALUES ('project:2','ทั่วไป','ขอนแก่น',2568,20000,'2026-01-01','2026-01-01','raw');`);
  const DB = { prepare(sql) {
    const statement = sqlite.prepare(sql);
    return { bind(...values) { return { first: async () => statement.get(...values) ?? null, all: async () => ({ results: statement.all(...values) }), run: async () => statement.run(...values) }; },
      first: async () => statement.get() ?? null, all: async () => ({ results: statement.all() }) };
  } };
  return { sqlite, DB, get: async path => (await worker.fetch(new Request(`https://test${path}`), { DB })).json() };
}

test('search all scope exposes uncategorized records; focus is narrower', async () => {
  const f = fixture();
  try { assert.equal((await f.get('/v1/projects')).total, 1); assert.equal((await f.get('/v1/projects?scope=all')).total, 2); }
  finally { f.sqlite.close(); }
});
test('market totals do not multiply a project with two product matches', async () => {
  const f = fixture();
  try { const data = await f.get('/v1/market-summary'); assert.equal(data.provinces[0].budget_sat, 10000); assert.equal(data.categories[0].budget_sat, 10000); }
  finally { f.sqlite.close(); }
});
test('unexamined catalog and raw-capture success cannot pass the cutover gate', async () => {
  const f = fixture();
  try { const data = await f.get('/v1/status'); assert.equal(data.data_gate_passed, false); assert.equal(data.coverage[4].state, 'unchecked'); assert.equal((await f.get('/v1/forecast')).state, 'awaiting_validated_history'); }
  finally { f.sqlite.close(); }
});
