-- A source resource is mutable catalog metadata. A sync run is immutable evidence.
ALTER TABLE source_resources ADD COLUMN data_shard TEXT;
ALTER TABLE sync_runs ADD COLUMN source_version TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX idx_source_resources_shard ON source_resources(data_shard, fiscal_year);
CREATE INDEX idx_sync_runs_resource_version ON sync_runs(resource_id, source_version, started_at DESC);
