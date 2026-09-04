import { CKAN_ACTION_URL, fiscalYearDatasetTitle, sanitizeDataset } from "../../../../lib/catalog.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
};

function json(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function isAuthorized(request) {
  const token = process.env.CATALOG_RELAY_TOKEN;
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

async function ckanAction(action, params) {
  const url = new URL(`${CKAN_ACTION_URL}/${action}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const headers = {
    accept: "application/json",
    "accept-language": "th-TH,th;q=0.9,en;q=0.7",
    "user-agent": "Mozilla/5.0 (compatible; BIT-GOV/1.0; +https://github.com/forbuyingshit1-collab/Bit_gov)",
  };
  if (process.env.DATA_GO_TH_API_KEY) headers["api-key"] = process.env.DATA_GO_TH_API_KEY;

  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`CKAN responded with HTTP ${response.status}`);

  const payload = await response.json();
  if (payload?.success !== true) throw new Error("CKAN returned an unsuccessful response");
  return payload.result;
}

export async function GET(request) {
  if (!process.env.CATALOG_RELAY_TOKEN) return json({ error: "relay_not_configured" }, 503);
  if (!isAuthorized(request)) return json({ error: "unauthorized" }, 401);

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2565 || year > 3000) {
    return json({ error: "invalid_year" }, 400);
  }

  try {
    const title = fiscalYearDatasetTitle(year);
    const search = await ckanAction("package_search", { q: title, rows: 20 });
    const match = (search?.results ?? []).find((dataset) => dataset?.title === title);
    if (!match?.id) return json({ fiscal_year: year, dataset: null, resources: [] }, 404);

    const dataset = sanitizeDataset(await ckanAction("package_show", { id: match.id }));
    return json({ fiscal_year: year, dataset, resources: dataset.resources });
  } catch (error) {
    console.error("catalog relay upstream request failed", { message: error instanceof Error ? error.message : "unknown" });
    return json({ error: "upstream_unavailable" }, 502);
  }
}
