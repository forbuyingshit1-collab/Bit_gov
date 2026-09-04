const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

async function status(db) {
  const latestRun = await db
    .prepare(
      `SELECT id, run_type, status, started_at, finished_at,
              source_count, accepted_count, duplicate_count, quarantine_count
       FROM sync_runs ORDER BY started_at DESC LIMIT 1`,
    )
    .first();

  const totals = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM projects) AS projects,
         (SELECT COUNT(*) FROM contracts) AS contracts,
         (SELECT COUNT(*) FROM ingestion_errors WHERE resolved_at IS NULL) AS unresolved_errors`,
    )
    .first();

  return { environment: "staging", latestRun, totals };
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function provinces(value) {
  return [...new Set(String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

async function searchProjects(db, url) {
  const where = [];
  const values = [];
  const selectedProvinces = provinces(url.searchParams.get("provinces"));
  if (selectedProvinces.length) {
    where.push(`p.province IN (${selectedProvinces.map(() => "?").join(",")})`);
    values.push(...selectedProvinces);
  }
  const fiscalYear = Number(url.searchParams.get("fiscalYear"));
  if (Number.isInteger(fiscalYear)) { where.push("p.fiscal_year = ?"); values.push(fiscalYear); }
  const category = url.searchParams.get("category")?.trim();
  if (category) {
    where.push("EXISTS (SELECT 1 FROM product_matches pm WHERE pm.project_id = p.id AND pm.category = ? AND pm.decision_status IN ('auto_approved', 'approved'))");
    values.push(category);
  }
  const query = url.searchParams.get("q")?.trim();
  if (query) {
    where.push("(p.title LIKE ? OR p.agency_name LIKE ? OR EXISTS (SELECT 1 FROM awards a JOIN suppliers s ON s.id = a.supplier_id WHERE a.project_id = p.id AND s.name LIKE ?))");
    values.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  const minPrice = Number(url.searchParams.get("minPriceSat"));
  if (Number.isSafeInteger(minPrice) && minPrice >= 0) { where.push("COALESCE((SELECT c.winning_price_sat FROM contracts c WHERE c.project_id = p.id LIMIT 1), p.budget_sat, 0) >= ?"); values.push(minPrice); }
  const maxPrice = Number(url.searchParams.get("maxPriceSat"));
  if (Number.isSafeInteger(maxPrice) && maxPrice >= 0) { where.push("COALESCE((SELECT c.winning_price_sat FROM contracts c WHERE c.project_id = p.id LIMIT 1), p.budget_sat, 0) <= ?"); values.push(maxPrice); }
  const direction = url.searchParams.get("sort") === "oldest" ? "ASC" : "DESC";
  const limit = positiveInteger(url.searchParams.get("limit"), 25, 100);
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
  const predicate = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const base = `FROM projects p ${predicate}`;
  const count = await db.prepare(`SELECT COUNT(*) AS count ${base}`).bind(...values).first();
  const result = await db.prepare(
    `SELECT p.id, p.project_code, p.title, p.agency_name, p.province, p.fiscal_year, p.announcement_date_iso,
       p.budget_sat, p.reference_price_sat,
       (SELECT winning_price_sat FROM contracts c WHERE c.project_id = p.id LIMIT 1) AS winning_price_sat,
       (SELECT s.name FROM awards a JOIN suppliers s ON s.id = a.supplier_id WHERE a.project_id = p.id LIMIT 1) AS winner_name,
       (SELECT category FROM product_matches pm WHERE pm.project_id = p.id AND pm.decision_status IN ('auto_approved', 'approved') LIMIT 1) AS category
     ${base} ORDER BY p.announcement_date_iso ${direction}, p.id ${direction} LIMIT ? OFFSET ?`,
  ).bind(...values, limit, offset).all();
  return { total: count?.count ?? 0, limit, offset, items: result.results ?? [] };
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

    return json({ error: "not_found" }, 404);
  },
};
