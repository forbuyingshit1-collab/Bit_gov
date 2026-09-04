CREATE TABLE ingestion_pages (
  id TEXT PRIMARY KEY,
  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),
  resource_id TEXT NOT NULL REFERENCES source_resources(id),
  page_offset INTEGER NOT NULL,
  page_limit INTEGER NOT NULL,
  source_total INTEGER NOT NULL,
  record_count INTEGER NOT NULL,
  accepted_count INTEGER NOT NULL,
  duplicate_count INTEGER NOT NULL,
  quarantine_count INTEGER NOT NULL DEFAULT 0,
  payload_checksum TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  UNIQUE (sync_run_id, page_offset),
  CHECK (record_count = accepted_count + duplicate_count + quarantine_count)
);

CREATE INDEX idx_ingestion_pages_run_offset ON ingestion_pages(sync_run_id, page_offset);
