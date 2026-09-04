export const CKAN_BASE_URL = "https://data.go.th/api/3/action";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response, attempt) {
  const retryAfter = Number(response?.headers?.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return Math.min(30_000, 500 * 2 ** attempt);
}

export function fiscalYearDatasetTitle(fiscalYear) {
  return `ข้อมูลโครงการจัดซื้อจัดจ้างจากระบบการจัดซื้อจัดจ้างภาครัฐ ปีงบประมาณ ${fiscalYear}`;
}

export function selectCsvResources(dataset) {
  return (dataset?.resources ?? []).filter(
    (resource) =>
      String(resource.format ?? "").toUpperCase() === "CSV" &&
      resource.datastore_active === true &&
      typeof resource.id === "string",
  );
}

export async function ckanAction(action, params, options) {
  const {
    apiKey,
    useApiKey = false,
    fetchImpl = fetch,
    retries = 5,
    baseUrl = CKAN_BASE_URL,
  } = options;
  if (useApiKey && !apiKey) throw new Error("DATA_GO_TH_API_KEY is not configured");

  const url = new URL(`${baseUrl.replace(/\/$/, "")}/${action}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const headers = {
          accept: "application/json",
          "accept-language": "th-TH,th;q=0.9,en;q=0.7",
          "user-agent": "Mozilla/5.0 (compatible; BIT-GOV/1.0; +https://github.com/forbuyingshit1-collab/Bit_gov)",
      };
      if (useApiKey) headers["api-key"] = apiKey;
      const response = await fetchImpl(url, { headers });
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          await sleep(retryDelay(response, attempt));
          continue;
        }
        throw new Error(`CKAN ${action} failed with HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (payload?.success !== true) throw new Error(`CKAN ${action} returned success=false`);
      return payload.result;
    } catch (error) {
      if (attempt >= retries || String(error).includes("HTTP 4")) throw error;
      await sleep(retryDelay(undefined, attempt));
    }
  }
  throw new Error(`CKAN ${action} failed after retries`);
}

export async function discoverFiscalYear(fiscalYear, options) {
  const title = fiscalYearDatasetTitle(fiscalYear);
  const search = await ckanAction("package_search", { q: title, rows: 20 }, options);
  const match = (search?.results ?? []).find((dataset) => dataset.title === title);
  if (!match) return null;
  return ckanAction("package_show", { id: match.id }, options);
}

export async function fetchDatastorePage(resourceId, offset, limit, options) {
  const result = await ckanAction(
    "datastore_search",
    { resource_id: resourceId, offset, limit },
    options,
  );
  return {
    records: Array.isArray(result?.records) ? result.records : [],
    fields: Array.isArray(result?.fields) ? result.fields : [],
    total: Number(result?.total ?? 0),
    offset,
    limit,
  };
}
