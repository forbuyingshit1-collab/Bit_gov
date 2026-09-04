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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "bit-gov-api", environment: env.APP_ENV });
    }

    if (request.method === "GET" && url.pathname === "/v1/status") {
      return json(await status(env.DB));
    }

    return json({ error: "not_found" }, 404);
  },
};
