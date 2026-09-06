ALTER TABLE sync_runs ADD COLUMN normalized_at TEXT;
ALTER TABLE sync_runs ADD COLUMN normalized_source_rows INTEGER;
CREATE TABLE normalization_batches (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES sync_runs(id),
  row_start INTEGER NOT NULL,
  row_count INTEGER NOT NULL,
  payload_checksum TEXT NOT NULL,
  accepted_count INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  quarantine_count INTEGER NOT NULL,
  UNIQUE(run_id, row_start),
  CHECK(row_count = accepted_count + duplicate_count + quarantine_count)
);
CREATE INDEX idx_contracts_project ON contracts(project_id);
CREATE INDEX idx_awards_project ON awards(project_id);
