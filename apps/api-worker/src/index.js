const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

async function status(db) {
  const [latestRun, totals, coverageResult] = await Promise.all([
    db.prepare(
      `SELECT id, run_type, status, started_at, finished_at,
              source_count, accepted_count, duplicate_count, quarantine_count,
              CAST(checkpoint AS INTEGER) AS checkpoint_bytes, total_bytes
       FROM sync_runs ORDER BY started_at DESC LIMIT 1`,
    ).first(),
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM projects) AS projects,
         (SELECT COUNT(*) FROM contracts) AS contracts,
         (SELECT COUNT(*) FROM ingestion_errors WHERE resolved_at IS NULL) AS unresolved_errors`,
    ).first(),
    db.prepare(
      `SELECT sr.fiscal_year, sr.source_last_modified, sr.last_seen_at,
              r.status, r.started_at, r.finished_at,
              CAST(r.checkpoint AS INTEGER) AS checkpoint_bytes, r.total_bytes,
              r.source_count AS normalized_rows, r.accepted_count, r.quarantine_count
         FROM source_resources sr
         LEFT JOIN sync_runs r ON r.id = (
           SELECT x.id FROM sync_runs x
            WHERE x.resource_id = sr.id AND x.run_type = 'local_raw_capture'
            ORDER BY x.started_at DESC LIMIT 1
         )
        ORDER BY sr.fiscal_year DESC, sr.external_id`,
    ).all(),
  ]);

  const resources = (coverageResult.results ?? []).map((resource) => ({
    ...resource,
    capture_percent: resource.total_bytes > 0
      ? Math.min(100, Math.round((resource.checkpoint_bytes / resource.total_bytes) * 1000) / 10)
      : null,
  }));
  const requestedFiscalYears = [2565, 2566, 2567, 2568, 2569];
  const coverage = requestedFiscalYears.map((fiscalYear) => {
    const yearResources = resources.filter((resource) => resource.fiscal_year === fiscalYear);
    const measuredResources = yearResources.filter((resource) => resource.capture_percent !== null);
    return {
      fiscal_year: fiscalYear,
      resource_count: yearResources.length,
      completed_resources: yearResources.filter((resource) => resource.status === "succeeded").length,
      normalized_rows: yearResources.reduce((sum, resource) => sum + (resource.normalized_rows ?? 0), 0),
      capture_percent: measuredResources.length
        ? Math.round((measuredResources.reduce((sum, resource) => sum + resource.capture_percent, 0) / yearResources.length) * 10) / 10
        : null,
      state: yearResources.length === 0 ? "source_unavailable"
        : yearResources.every((resource) => resource.status === "succeeded") ? "captured"
          : yearResources.some((resource) => resource.status === "running") ? "capturing" : "incomplete",
    };
  });
  return { environment: "staging", latestRun, totals, coverage, resources };
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export function optionalNonNegativeInteger(value) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function provinces(value) {
  return [...new Set(String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

async function searchProjects(db, url, maximumLimit = 100) {
  const where = [];
  const values = [];
  const selectedProvinces = provinces(url.searchParams.get("provinces"));
  if (selectedProvinces.length) {
    where.push(`p.province IN (${selectedProvinces.map(() => "?").join(",")})`);
    values.push(...selectedProvinces);
  }
  const fiscalYear = optionalNonNegativeInteger(url.searchParams.get("fiscalYear"));
  if (fiscalYear !== null) { where.push("p.fiscal_year = ?"); values.push(fiscalYear); }
  const category = url.searchParams.get("category")?.trim();
  if (category) {
    where.push("EXISTS (SELECT 1 FROM product_matches pm WHERE pm.project_id = p.id AND pm.category = ? AND pm.decision_status IN ('auto_approved', 'approved'))");
    values.push(category);
  }
  const subcategory = url.searchParams.get("subcategory")?.trim();
  if (subcategory) {
    where.push("EXISTS (SELECT 1 FROM product_matches pm WHERE pm.project_id = p.id AND pm.subcategory = ? AND pm.decision_status IN ('auto_approved', 'approved'))");
    values.push(subcategory);
  }
  const query = url.searchParams.get("q")?.trim();
  if (query) {
    where.push("(p.title LIKE ? OR p.agency_name LIKE ? OR EXISTS (SELECT 1 FROM awards a JOIN suppliers s ON s.id = a.supplier_id WHERE a.project_id = p.id AND s.name LIKE ?))");
    values.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const minPrice = optionalNonNegativeInteger(url.searchParams.get("minPriceSat"));
  if (minPrice !== null) { where.push("COALESCE((SELECT c.winning_price_sat FROM contracts c WHERE c.project_id = p.id LIMIT 1), p.budget_sat, 0) >= ?"); values.push(minPrice); }
  const maxPrice = optionalNonNegativeInteger(url.searchParams.get("maxPriceSat"));
  if (maxPrice !== null) { where.push("COALESCE((SELECT c.winning_price_sat FROM contracts c WHERE c.project_id = p.id LIMIT 1), p.budget_sat, 0) <= ?"); values.push(maxPrice); }
  const direction = url.searchParams.get("sort") === "oldest" ? "ASC" : "DESC";
  const limit = positiveInteger(url.searchParams.get("limit"), 25, maximumLimit);
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const base = `FROM projects p ${predicate}`;
  const count = await db.prepare(`SELECT COUNT(*) AS count ${base}`).bind(...values).first();
  const result = await db.prepare(
    `SELECT p.id, p.project_code, p.title, p.agency_name, p.province, p.fiscal_year, p.announcement_date_iso,
       p.budget_sat, p.reference_price_sat,
       (SELECT winning_price_sat FROM contracts c WHERE c.project_id = p.id LIMIT 1) AS winning_price_sat,
       (SELECT s.name FROM awards a JOIN suppliers s ON s.id = a.supplier_id WHERE a.project_id = p.id LIMIT 1) AS winner_name,
       (SELECT category FROM product_matches pm WHERE pm.project_id = p.id AND pm.decision_status IN ('auto_approved', 'approved') LIMIT 1) AS category,
       (SELECT subcategory FROM product_matches pm WHERE pm.project_id = p.id AND pm.decision_status IN ('auto_approved', 'approved') LIMIT 1) AS subcategory
     ${base} ORDER BY p.announcement_date_iso ${direction}, p.id ${direction} LIMIT ? OFFSET ?`,
  ).bind(...values, limit, offset).all();
  return { total: count?.count ?? 0, limit, offset, items: result.results ?? [] };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function projectCsv(items) {
  const headers = ["รหัสโครงการ", "ชื่อโครงการ", "หน่วยงาน", "จังหวัด", "ปีงบประมาณ", "วันที่ประกาศ", "หมวดหลัก", "หมวดย่อย", "งบประมาณ(บาท)", "ราคากลาง(บาท)", "ราคาชนะ(บาท)", "ผู้ชนะ"];
  const rows = items.map((item) => [item.project_code, item.title, item.agency_name, item.province, item.fiscal_year,
    item.announcement_date_iso, item.category, item.subcategory, item.budget_sat == null ? "" : item.budget_sat / 100,
    item.reference_price_sat == null ? "" : item.reference_price_sat / 100,
    item.winning_price_sat == null ? "" : item.winning_price_sat / 100, item.winner_name]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

async function marketSummary(db, url) {
  const where = ["pm.decision_status IN ('auto_approved', 'approved')"];
  const values = [];
  const selectedProvinces = provinces(url.searchParams.get("provinces"));
  if (selectedProvinces.length) { where.push(`p.province IN (${selectedProvinces.map(() => "?").join(",")})`); values.push(...selectedProvinces); }
  const fiscalYear = optionalNonNegativeInteger(url.searchParams.get("fiscalYear"));
  if (fiscalYear !== null) { where.push("p.fiscal_year = ?"); values.push(fiscalYear); }
  const category = url.searchParams.get("category")?.trim();
  if (category) { where.push("pm.category = ?"); values.push(category); }
  const subcategory = url.searchParams.get("subcategory")?.trim();
  if (subcategory) { where.push("pm.subcategory = ?"); values.push(subcategory); }
  const query = url.searchParams.get("q")?.trim();
  if (query) {
    where.push("(p.title LIKE ? OR p.agency_name LIKE ? OR EXISTS (SELECT 1 FROM awards a JOIN suppliers s ON s.id = a.supplier_id WHERE a.project_id = p.id AND s.name LIKE ?))");
    values.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const minPrice = optionalNonNegativeInteger(url.searchParams.get("minPriceSat"));
  if (minPrice !== null) { where.push("COALESCE((SELECT c.winning_price_sat FROM contracts c WHERE c.project_id = p.id LIMIT 1), p.budget_sat, 0) >= ?"); values.push(minPrice); }
  const maxPrice = optionalNonNegativeInteger(url.searchParams.get("maxPriceSat"));
  if (maxPrice !== null) { where.push("COALESCE((SELECT c.winning_price_sat FROM contracts c WHERE c.project_id = p.id LIMIT 1), p.budget_sat, 0) <= ?"); values.push(maxPrice); }
  const predicate = `WHERE ${where.join(" AND ")}`;
  const [categories, provinceRows, months] = await Promise.all([
    db.prepare(`SELECT pm.category AS label, COUNT(DISTINCT p.id) AS project_count, SUM(COALESCE(p.budget_sat, 0)) AS budget_sat FROM projects p JOIN product_matches pm ON pm.project_id = p.id ${predicate} GROUP BY pm.category ORDER BY budget_sat DESC`).bind(...values).all(),
    db.prepare(`SELECT p.province AS label, COUNT(DISTINCT p.id) AS project_count, SUM(COALESCE(p.budget_sat, 0)) AS budget_sat FROM projects p JOIN product_matches pm ON pm.project_id = p.id ${predicate} GROUP BY p.province ORDER BY budget_sat DESC LIMIT 20`).bind(...values).all(),
    db.prepare(`SELECT substr(p.announcement_date_iso, 1, 7) AS label, COUNT(DISTINCT p.id) AS project_count, SUM(COALESCE(p.budget_sat, 0)) AS budget_sat FROM projects p JOIN product_matches pm ON pm.project_id = p.id ${predicate} AND p.announcement_date_iso IS NOT NULL GROUP BY substr(p.announcement_date_iso, 1, 7) ORDER BY label`).bind(...values).all(),
  ]);
  return { categories: categories.results ?? [], provinces: provinceRows.results ?? [], months: months.results ?? [] };
}

async function companyWork(db, url) {
  const companyNames = ["ไอคิวโอเอ โซลูชั่น", "ไอคิว เซ้าท์อีสต์ โอเอ อุดรธานี"];
  const where = [`s.normalized_name IN (${companyNames.map(() => "?").join(",")})`];
  const values = [...companyNames];
  const selectedProvinces = provinces(url.searchParams.get("provinces"));
  if (selectedProvinces.length) { where.push(`p.province IN (${selectedProvinces.map(() => "?").join(",")})`); values.push(...selectedProvinces); }
  const fiscalYear = optionalNonNegativeInteger(url.searchParams.get("fiscalYear"));
  if (fiscalYear !== null) { where.push("p.fiscal_year = ?"); values.push(fiscalYear); }
  const category = url.searchParams.get("category")?.trim();
  if (category) { where.push("EXISTS (SELECT 1 FROM product_matches pm WHERE pm.project_id = p.id AND pm.category = ?)"); values.push(category); }
  const subcategory = url.searchParams.get("subcategory")?.trim();
  if (subcategory) { where.push("EXISTS (SELECT 1 FROM product_matches pm WHERE pm.project_id = p.id AND pm.subcategory = ?)"); values.push(subcategory); }
  const query = url.searchParams.get("q")?.trim();
  if (query) { where.push("(p.title LIKE ? OR p.agency_name LIKE ? OR s.name LIKE ?)"); values.push(`%${query}%`, `%${query}%`, `%${query}%`); }
  const minPrice = optionalNonNegativeInteger(url.searchParams.get("minPriceSat"));
  if (minPrice !== null) { where.push("COALESCE(a.winning_price_sat, p.budget_sat, 0) >= ?"); values.push(minPrice); }
  const maxPrice = optionalNonNegativeInteger(url.searchParams.get("maxPriceSat"));
  if (maxPrice !== null) { where.push("COALESCE(a.winning_price_sat, p.budget_sat, 0) <= ?"); values.push(maxPrice); }
  const direction = url.searchParams.get("sort") === "oldest" ? "ASC" : "DESC";
  const predicate = `WHERE ${where.join(" AND ")}`;
  const joins = "FROM awards a JOIN projects p ON p.id = a.project_id JOIN suppliers s ON s.id = a.supplier_id";
  const [totals, items] = await Promise.all([
    db.prepare(`SELECT COUNT(DISTINCT p.id) AS project_count, SUM(COALESCE(a.winning_price_sat, 0)) AS winning_price_sat, COUNT(DISTINCT s.id) AS company_count ${joins} ${predicate}`).bind(...values).first(),
    db.prepare(`SELECT p.id, p.project_code, p.title, p.agency_name, p.province, p.fiscal_year, p.announcement_date_iso,
      a.winning_price_sat, s.name AS winner_name,
      (SELECT category FROM product_matches pm WHERE pm.project_id = p.id LIMIT 1) AS category,
      (SELECT subcategory FROM product_matches pm WHERE pm.project_id = p.id LIMIT 1) AS subcategory
      ${joins} ${predicate} ORDER BY p.announcement_date_iso ${direction}, p.id ${direction} LIMIT 100`).bind(...values).all(),
  ]);
  return { totals: totals ?? { project_count: 0, winning_price_sat: 0, company_count: 0 }, items: items.results ?? [] };
}

async function recommendations(db, url) {
  const companyNames = ["ไอคิวโอเอ โซลูชั่น", "ไอคิว เซ้าท์อีสต์ โอเอ อุดรธานี"];
  const selectedProvinces = provinces(url.searchParams.get("provinces"));
  const provinceClause = selectedProvinces.length ? `AND p.province IN (${selectedProvinces.map(() => "?").join(",")})` : "";
  const candidateWhere = [];
  const candidateValues = [];
  const fiscalYear = optionalNonNegativeInteger(url.searchParams.get("fiscalYear"));
  if (fiscalYear !== null) { candidateWhere.push("p.fiscal_year = ?"); candidateValues.push(fiscalYear); }
  const category = url.searchParams.get("category")?.trim();
  if (category) { candidateWhere.push("pm.category = ?"); candidateValues.push(category); }
  const subcategory = url.searchParams.get("subcategory")?.trim();
  if (subcategory) { candidateWhere.push("pm.subcategory = ?"); candidateValues.push(subcategory); }
  const query = url.searchParams.get("q")?.trim();
  if (query) { candidateWhere.push("(p.title LIKE ? OR p.agency_name LIKE ?)"); candidateValues.push(`%${query}%`, `%${query}%`); }
  const minPrice = optionalNonNegativeInteger(url.searchParams.get("minPriceSat"));
  if (minPrice !== null) { candidateWhere.push("COALESCE(p.budget_sat, 0) >= ?"); candidateValues.push(minPrice); }
  const maxPrice = optionalNonNegativeInteger(url.searchParams.get("maxPriceSat"));
  if (maxPrice !== null) { candidateWhere.push("COALESCE(p.budget_sat, 0) <= ?"); candidateValues.push(maxPrice); }
  const filterClause = candidateWhere.length ? `AND ${candidateWhere.join(" AND ")}` : "";
  const direction = url.searchParams.get("sort") === "oldest" ? "ASC" : "DESC";
  const values = [...companyNames, ...selectedProvinces, ...candidateValues];
  const result = await db.prepare(
    `WITH company_projects AS (
       SELECT DISTINCT cp.id, cp.agency_name, cp.province,
         (SELECT category FROM product_matches x WHERE x.project_id = cp.id LIMIT 1) AS category
       FROM projects cp JOIN awards ca ON ca.project_id = cp.id JOIN suppliers cs ON cs.id = ca.supplier_id
       WHERE cs.normalized_name IN (?, ?)
     ), candidates AS (
       SELECT p.id, p.project_code, p.title, p.agency_name, p.province, p.fiscal_year, p.announcement_date_iso,
         p.budget_sat, pm.category, pm.subcategory,
         30
         + 25 * EXISTS (SELECT 1 FROM company_projects h WHERE h.category = pm.category)
         + 20 * EXISTS (SELECT 1 FROM company_projects h WHERE h.province = p.province)
         + 15 * EXISTS (SELECT 1 FROM company_projects h WHERE h.agency_name = p.agency_name) AS opportunity_score
       FROM projects p JOIN product_matches pm ON pm.project_id = p.id
       WHERE pm.decision_status IN ('auto_approved', 'approved') ${provinceClause} ${filterClause}
         AND NOT EXISTS (SELECT 1 FROM awards a JOIN suppliers s ON s.id = a.supplier_id WHERE a.project_id = p.id AND s.normalized_name IN (?, ?))
     )
     SELECT *, CASE WHEN opportunity_score >= 75 THEN 'สูง' WHEN opportunity_score >= 50 THEN 'กลาง' ELSE 'ต่ำ' END AS opportunity_level
     FROM candidates ORDER BY opportunity_score DESC, announcement_date_iso ${direction} LIMIT 25`,
  ).bind(...values, ...companyNames).all();
  return { methodology: "historical_similarity_v1", warning: "historical_record_not_open_tender_confirmation", items: result.results ?? [] };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "bit-gov-api", environment: env.APP_ENV });
    }

    if (request.method === "GET" && url.pathname === "/v1/status") {
      return json(await status(env.DB));
    }

    if (request.method === "GET" && url.pathname === "/v1/projects") {
      return json(await searchProjects(env.DB, url));
    }

    if (request.method === "GET" && url.pathname === "/v1/export/projects.csv") {
      url.searchParams.set("limit", "5000");
      url.searchParams.set("offset", "0");
      const projects = await searchProjects(env.DB, url, 5000);
      return new Response(projectCsv(projects.items), { headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": "attachment; filename=bit-gov-projects.csv",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      } });
    }

    if (request.method === "GET" && url.pathname === "/v1/market-summary") {
      return json(await marketSummary(env.DB, url));
    }
    if (request.method === "GET" && url.pathname === "/v1/company-work") {
      return json(await companyWork(env.DB, url));
    }
    if (request.method === "GET" && url.pathname === "/v1/recommendations") {
      return json(await recommendations(env.DB, url));
    }

    return json({ error: "not_found" }, 404);
  },
};
