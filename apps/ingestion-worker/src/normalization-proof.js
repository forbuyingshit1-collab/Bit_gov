// A successful HTTP response or byte checkpoint does not prove every CSV row was ingested.
export async function hasCompleteBatchCoverage(db, runId, expectedRows) {
  const proof = await db.prepare(`SELECT COUNT(*) AS batches,
    COALESCE(SUM(row_count), 0) AS rows,
    COALESCE(MAX(row_start + row_count), 0) AS end_row,
    COALESCE(SUM(CASE WHEN row_start <> previous_end OR row_count <= 0 THEN 1 ELSE 0 END), 0) AS gaps
    FROM (SELECT row_start, row_count,
      COALESCE(LAG(row_start + row_count) OVER (ORDER BY row_start), 0) AS previous_end
      FROM normalization_batches WHERE run_id = ?)`)
    .bind(runId).first();
  return proof.rows === expectedRows && proof.end_row === expectedRows && proof.gaps === 0;
}
