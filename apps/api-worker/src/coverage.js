export async function publishedCoverage(db) {
  const checks = await db.prepare('SELECT * FROM catalog_coverage ORDER BY fiscal_year').all();
  const rows = await db.prepare(`SELECT sr.fiscal_year, sr.external_id, r.status, r.normalized_at, r.normalized_source_rows,
    r.source_count, r.accepted_count, r.duplicate_count, r.quarantine_count, r.total_bytes,
    CAST(r.checkpoint AS INTEGER) AS checkpoint_bytes
    FROM source_resources sr LEFT JOIN sync_runs r ON r.id = (
      SELECT x.id FROM sync_runs x WHERE x.resource_id = sr.id AND x.run_type = 'local_raw_capture'
      ORDER BY x.started_at DESC, x.id DESC LIMIT 1)`).all();
  return [2565, 2566, 2567, 2568, 2569].map(fiscal_year => {
    const check = checks.results.find(x => x.fiscal_year === fiscal_year);
    const resources = rows.results.filter(x => x.fiscal_year === fiscal_year);
    const normalized = resources.filter(x => x.normalized_at && x.source_count === x.accepted_count + x.duplicate_count + x.quarantine_count);
    const fresh = check && Date.now() - Date.parse(check.checked_at) < 36 * 3600 * 1000;
    const absent = fresh && check.coverage_status === 'unavailable';
    const complete = fresh && check.coverage_status === 'available' && check.resource_count > 0 && normalized.length === check.resource_count && resources.length === check.resource_count;
    return { fiscal_year, resource_count: check?.resource_count ?? null, registered_resources: resources.length,
      completed_resources: resources.filter(x => x.status === 'succeeded').length,
      normalized_resources: normalized.length, normalized_rows: normalized.reduce((n, x) => n + (x.normalized_source_rows ?? 0), 0),
      catalog_checked_at: check?.checked_at ?? null,
      state: !check ? 'unchecked' : !fresh ? 'stale_check' : check.coverage_status === 'check_failed' ? 'check_failed'
        : absent ? 'source_unavailable' : complete ? 'ready' : 'incomplete',
      gate_passed: complete || (fiscal_year === 2569 && absent),
      capture_percent: check?.resource_count > 0 ? Math.round(resources.reduce((n,x) => n + (x.total_bytes ? Math.min(1, x.checkpoint_bytes / x.total_bytes) : 0), 0) / check.resource_count * 1000) / 10 : null };
  });
}
