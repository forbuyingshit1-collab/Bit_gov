const apiKey = process.env.DATA_GO_TH_API_KEY;
const controlToken = process.env.INGESTION_CONTROL_TOKEN;
const workerUrl = process.env.INGESTION_WORKER_URL;
const years = (process.env.FISCAL_YEARS ?? "2565:2568").split(":").map(Number);
const resourceLimit = Number(process.env.RESOURCE_LIMIT ?? Number.MAX_SAFE_INTEGER);

if (!apiKey || !controlToken || !workerUrl || years.length !== 2 || years.some((year) => !Number.isInteger(year))) {
  throw new Error("Set DATA_GO_TH_API_KEY, INGESTION_CONTROL_TOKEN, INGESTION_WORKER_URL and FISCAL_YEARS=2565:2568");
}

const titleFor = (year) => `ข้อมูลโครงการจัดซื้อจัดจ้างจากระบบการจัดซื้อจัดจ้างภาครัฐ ปีงบประมาณ ${year}`;
async function ckan(action, params) {
  const url = new URL(`https://opend.data.go.th/get-ckan/${action}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { "api-key": apiKey, accept: "application/json" } });
  if (!response.ok) throw new Error(`${action} returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.success) throw new Error(`${action} returned success=false`);
  return payload.result;
}

for (let fiscalYear = years[0]; fiscalYear <= years[1]; fiscalYear += 1) {
  const title = titleFor(fiscalYear);
  const search = await ckan("package_search", { q: title, rows: 20 });
  const dataset = (search.results ?? []).find((item) => item.title === title);
  if (!dataset) { console.log(`${fiscalYear}: unavailable`); continue; }
  const detail = await ckan("package_show", { id: dataset.id });
  const resources = (detail.resources ?? []).filter((resource) =>
    String(resource.format ?? "").toUpperCase() === "CSV" && resource.datastore_active === true && typeof resource.url === "string",
  );
  for (const resource of resources.slice(0, resourceLimit)) {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/seed-catalog-resource`, {
      method: "POST",
      headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
      body: JSON.stringify({ fiscalYear, resource, direct: process.env.DIRECT === "1", stopAfterChunk: process.env.SMOKE === "1", chunkBytes: process.env.SMOKE === "1" ? 1024 * 1024 : undefined }),
    });
    if (!response.ok) throw new Error(`worker seed returned HTTP ${response.status}`);
    console.log(`${fiscalYear}: queued ${resource.id}`);
  }
}
