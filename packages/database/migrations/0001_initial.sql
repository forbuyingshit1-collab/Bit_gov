PRAGMA foreign_keys = ON;

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE source_resources (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  fiscal_year INTEGER,
  resource_url TEXT,
  source_last_modified TEXT,
  checksum TEXT,
  schema_fingerprint TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (source_id, external_id)
);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  resource_id TEXT REFERENCES source_resources(id),
  run_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'partial')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  source_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  quarantine_count INTEGER NOT NULL DEFAULT 0,
  checkpoint TEXT,
  error_summary TEXT,
  CHECK (source_count = accepted_count + duplicate_count + quarantine_count OR status IN ('queued', 'running', 'failed'))
);

CREATE TABLE raw_records (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES source_resources(id),
  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),
  source_record_id TEXT,
  fingerprint TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  payload_checksum TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  UNIQUE (resource_id, fingerprint)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  project_code TEXT,
  title TEXT NOT NULL,
  description TEXT,
  agency_name TEXT,
  department_name TEXT,
  province TEXT,
  fiscal_year INTEGER,
  announcement_date_raw TEXT,
  announcement_date_iso TEXT,
  budget_sat INTEGER,
  reference_price_sat INTEGER,
  source_url TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
  UNIQUE (project_code, raw_record_id)
);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  contract_number TEXT,
  contract_date_raw TEXT,
  contract_date_iso TEXT,
  agreed_price_sat INTEGER,
  contract_price_sat INTEGER,
  winning_price_sat INTEGER,
  winning_price_source TEXT CHECK (winning_price_source IN ('contract_price', 'agreed_price', NULL)),
  source_url TEXT,
  raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
  UNIQUE (project_id, contract_number, raw_record_id)
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  tax_id TEXT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  province TEXT,
  UNIQUE (tax_id),
  UNIQUE (normalized_name)
);

CREATE TABLE awards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  contract_id TEXT REFERENCES contracts(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  award_date_raw TEXT,
  award_date_iso TEXT,
  winning_price_sat INTEGER,
  raw_record_id TEXT NOT NULL REFERENCES raw_records(id),
  UNIQUE (project_id, contract_id, supplier_id)
);

CREATE TABLE bidders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  supplier_id TEXT REFERENCES suppliers(id),
  bidder_name_raw TEXT,
  bid_price_sat INTEGER,
  availability_status TEXT NOT NULL DEFAULT 'unavailable_from_source',
  raw_record_id TEXT REFERENCES raw_records(id)
);

CREATE TABLE product_matches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  category TEXT NOT NULL,
  subcategory TEXT,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  match_reason TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  decision_status TEXT NOT NULL CHECK (decision_status IN ('auto_approved', 'pending_review', 'approved', 'rejected')),
  UNIQUE (project_id, category, subcategory, rules_version)
);

CREATE TABLE location_matches (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  province TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  match_reason TEXT NOT NULL,
  decision_status TEXT NOT NULL CHECK (decision_status IN ('auto_approved', 'pending_review', 'approved', 'rejected')),
  UNIQUE (project_id, province)
);

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject', 'reset')),
  category_override TEXT,
  subcategory_override TEXT,
  province_override TEXT,
  reason TEXT,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL
);

CREATE TABLE ingestion_errors (
  id TEXT PRIMARY KEY,
  sync_run_id TEXT NOT NULL REFERENCES sync_runs(id),
  resource_id TEXT REFERENCES source_resources(id),
  source_record_id TEXT,
  fingerprint TEXT,
  stage TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX idx_projects_fiscal_year_province ON projects(fiscal_year, province);
CREATE INDEX idx_projects_announcement_date ON projects(announcement_date_iso);
CREATE INDEX idx_projects_agency ON projects(agency_name);
CREATE INDEX idx_projects_budget ON projects(budget_sat);
CREATE INDEX idx_awards_supplier ON awards(supplier_id);
CREATE INDEX idx_product_matches_category ON product_matches(category, subcategory, decision_status);
CREATE INDEX idx_location_matches_province ON location_matches(province, decision_status);
CREATE INDEX idx_sync_runs_started_at ON sync_runs(started_at DESC);
CREATE INDEX idx_ingestion_errors_open ON ingestion_errors(resolved_at, reason_code);

CREATE VIRTUAL TABLE projects_fts USING fts5(
  project_id UNINDEXED,
  title,
  description,
  agency_name,
  department_name,
  content=''
);

CREATE VIEW v_data_freshness AS
SELECT
  sr.fiscal_year,
  sr.external_id AS resource_external_id,
  sr.source_last_modified,
  MAX(r.observed_at) AS last_observed_at,
  COUNT(r.id) AS raw_record_count
FROM source_resources sr
LEFT JOIN raw_records r ON r.resource_id = sr.id
GROUP BY sr.id;

CREATE VIEW v_review_queue AS
SELECT
  p.id AS project_id,
  p.project_code,
  p.title,
  p.province,
  p.fiscal_year,
  pm.category,
  pm.subcategory,
  pm.confidence AS product_confidence,
  pm.match_reason AS product_match_reason
FROM projects p
JOIN product_matches pm ON pm.project_id = p.id
WHERE pm.decision_status = 'pending_review';

CREATE VIEW v_award_history AS
SELECT
  p.id AS project_id,
  p.project_code,
  p.title,
  p.agency_name,
  p.province,
  p.fiscal_year,
  c.contract_number,
  c.winning_price_sat,
  c.winning_price_source,
  s.name AS winner_name,
  s.tax_id AS winner_tax_id,
  rr.resource_id,
  rr.r2_object_key
FROM projects p
LEFT JOIN contracts c ON c.project_id = p.id
LEFT JOIN awards a ON a.project_id = p.id AND (a.contract_id = c.id OR c.id IS NULL)
LEFT JOIN suppliers s ON s.id = a.supplier_id
JOIN raw_records rr ON rr.id = p.raw_record_id;

CREATE VIEW v_project_opportunities_new AS
SELECT p.*
FROM projects p
WHERE EXISTS (
  SELECT 1 FROM product_matches pm
  WHERE pm.project_id = p.id AND pm.decision_status IN ('auto_approved', 'approved')
)
AND EXISTS (
  SELECT 1 FROM location_matches lm
  WHERE lm.project_id = p.id AND lm.decision_status IN ('auto_approved', 'approved')
);

CREATE VIEW v_market_by_province_category_month AS
SELECT
  p.province,
  pm.category,
  substr(p.announcement_date_iso, 1, 7) AS month,
  COUNT(DISTINCT p.id) AS project_count,
  SUM(COALESCE(p.budget_sat, 0)) AS budget_sat
FROM projects p
JOIN product_matches pm ON pm.project_id = p.id
WHERE pm.decision_status IN ('auto_approved', 'approved')
GROUP BY p.province, pm.category, substr(p.announcement_date_iso, 1, 7);

CREATE VIEW v_top_winners AS
SELECT
  s.id AS supplier_id,
  s.name AS supplier_name,
  COUNT(DISTINCT a.id) AS award_count,
  SUM(COALESCE(a.winning_price_sat, 0)) AS winning_price_sat
FROM suppliers s
JOIN awards a ON a.supplier_id = s.id
GROUP BY s.id;

CREATE VIEW v_price_discount AS
SELECT
  p.id AS project_id,
  p.reference_price_sat,
  c.winning_price_sat,
  CASE
    WHEN p.reference_price_sat > 0 AND c.winning_price_sat IS NOT NULL
    THEN ROUND((p.reference_price_sat - c.winning_price_sat) * 100.0 / p.reference_price_sat, 2)
  END AS discount_percent
FROM projects p
JOIN contracts c ON c.project_id = p.id;
