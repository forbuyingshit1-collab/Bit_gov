CREATE TABLE catalog_coverage (
  source_id TEXT NOT NULL REFERENCES sources(id),
  fiscal_year INTEGER NOT NULL,
  coverage_status TEXT NOT NULL CHECK (coverage_status IN ('available', 'unavailable', 'check_failed')),
  dataset_id TEXT,
  resource_count INTEGER NOT NULL DEFAULT 0 CHECK (resource_count >= 0),
  checked_at TEXT NOT NULL,
  error_summary TEXT,
  PRIMARY KEY (source_id, fiscal_year)
);

CREATE INDEX idx_catalog_coverage_checked_at ON catalog_coverage(checked_at DESC);

CREATE VIEW v_published_coverage AS
SELECT
  cc.fiscal_year,
  cc.coverage_status,
  cc.dataset_id,
  cc.resource_count AS discovered_resource_count,
  COUNT(sr.id) AS registered_resource_count,
  cc.checked_at,
  cc.error_summary
FROM catalog_coverage cc
LEFT JOIN source_resources sr
  ON sr.source_id = cc.source_id AND sr.fiscal_year = cc.fiscal_year
GROUP BY cc.source_id, cc.fiscal_year;
