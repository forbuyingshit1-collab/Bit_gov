import { spawnSync } from 'node:child_process';
const command = `SELECT
 (SELECT COUNT(*) FROM source_resources) AS registered_resources,
 (SELECT COUNT(*) FROM sync_runs WHERE run_type='local_raw_capture' AND normalized_at IS NOT NULL) AS normalized_runs,
 (SELECT COUNT(*) FROM ingestion_errors WHERE resolved_at IS NULL) AS unresolved_errors,
 (SELECT COUNT(*) FROM projects p LEFT JOIN raw_records r ON r.id=p.raw_record_id LEFT JOIN source_resources s ON s.id=r.resource_id WHERE r.id IS NULL OR s.id IS NULL) AS missing_project_lineage,
 (SELECT COUNT(*) FROM contracts c LEFT JOIN raw_records r ON r.id=c.raw_record_id WHERE r.id IS NULL) AS missing_contract_lineage,
 (SELECT COUNT(*) FROM (SELECT project_code,fiscal_year FROM projects WHERE project_code IS NOT NULL GROUP BY project_code,fiscal_year HAVING COUNT(*)>1)) AS duplicate_projects,
 (SELECT COUNT(*) FROM (SELECT project_id,contract_number FROM contracts WHERE contract_number IS NOT NULL GROUP BY project_id,contract_number HAVING COUNT(*)>1)) AS duplicate_contracts,
 (SELECT COUNT(*) FROM (SELECT project_id,contract_id,supplier_id FROM awards GROUP BY project_id,contract_id,supplier_id HAVING COUNT(*)>1)) AS duplicate_awards,
 (SELECT COUNT(*) FROM sync_runs WHERE source_count<>accepted_count+duplicate_count+quarantine_count) AS accounting_errors;
 SELECT c.fiscal_year,c.coverage_status,c.resource_count,c.checked_at,
 (SELECT COUNT(*) FROM source_resources sr WHERE sr.fiscal_year=c.fiscal_year AND EXISTS (SELECT 1 FROM sync_runs r WHERE r.resource_id=sr.id AND r.run_type='local_raw_capture' AND r.normalized_at IS NOT NULL AND r.started_at=(SELECT MAX(x.started_at) FROM sync_runs x WHERE x.resource_id=sr.id AND x.run_type='local_raw_capture'))) AS normalized_resources
 FROM catalog_coverage c ORDER BY c.fiscal_year;`;
const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js','d1','execute','bit-gov-v2-staging','--remote','--config','apps/ingestion-worker/wrangler.toml','--json','--command',command], { encoding: 'utf8' });
if (result.status !== 0) { console.error('Cannot verify data gate: D1 query failed'); process.exit(2); }
const data = JSON.parse(result.stdout);
const totals = data[0].results[0], years = data[1].results;
const rowChecks = Object.entries(totals).filter(([key]) => !['registered_resources','normalized_runs'].includes(key)).every(([,value]) => value === 0);
const coverageChecks = [2565,2566,2567,2568,2569].every(year => {
  const c = years.find(x => x.fiscal_year === year);
  if (!c || Date.now() - Date.parse(c.checked_at) > 36 * 3600 * 1000) return false;
  return (year === 2569 && c.coverage_status === 'unavailable') || (c.coverage_status === 'available' && c.resource_count > 0 && c.normalized_resources === c.resource_count);
});
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), passed: rowChecks && coverageChecks, totals, years }, null, 2));
process.exitCode = rowChecks && coverageChecks ? 0 : 1;
