import { readFile, writeFile } from "node:fs/promises";

const apiKey = process.env.DATA_GO_TH_API_KEY;
const controlToken = process.env.INGESTION_CONTROL_TOKEN;
const workerUrl = process.env.INGESTION_WORKER_URL;
const years = (process.env.FISCAL_YEARS ?? "2565:2568").split(":").map(Number);
const resourceLimit = Number(process.env.RESOURCE_LIMIT ?? Number.MAX_SAFE_INTEGER);
const captureBytes = Number(process.env.CAPTURE_BYTES ?? 1 * 1024 * 1024);
const maxChunks = Number(process.env.MAX_CHUNKS ?? 1);
// Pace writes conservatively: staging has returned transient 503s after burst R2 uploads.
const chunkDelayMs = Number(process.env.CHUNK_DELAY_MS ?? 15000);
const statePath = process.env.CAPTURE_STATE_PATH ?? ".bit-gov-capture-state.json";

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

async function seed(payload) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/seed-catalog-resource`, {
      method: "POST",
      headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return response.json();
    if (response.status < 500 || attempt === 3) throw new Error(`worker seed returned HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) throw new Error("Source did not return Content-Range");
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

async function uploadChunk({ runId, fiscalYear, resource, rangeStart, chunkBytes }) {
  const rangeEnd = rangeStart + chunkBytes - 1;
  const source = await fetch(resource.url, { headers: { range: `bytes=${rangeStart}-${rangeEnd}` } });
  if (source.status !== 206) throw new Error(`source range returned HTTP ${source.status}`);
  const range = parseContentRange(source.headers.get("content-range"));
  if (range.start !== rangeStart || range.end > rangeEnd) throw new Error("source returned an inconsistent range");
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (bytes.byteLength !== range.end - range.start + 1) throw new Error("source range body length is inconsistent");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/upload-csv-chunk`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${controlToken}`,
        "content-type": "text/csv",
        "content-range": `bytes ${range.start}-${range.end}/${range.total}`,
        "x-bit-gov-run-id": runId,
        "x-bit-gov-resource-id": resource.id,
        "x-bit-gov-fiscal-year": String(fiscalYear),
        "x-bit-gov-source-version": resource.last_modified || resource.hash || "unknown",
      },
      body: bytes,
    });
    if (response.ok) return response.json();
    if (response.status < 500 || attempt === 3) throw new Error(`worker upload returned HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

async function failCapture(runId, reason) {
  await fetch(`${workerUrl.replace(/\/$/, "")}/internal/fail-capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
    body: JSON.stringify({ runId, reason }),
  });
}

async function captureStatus(fiscalYear, resourceId) {
  const url = new URL(`${workerUrl.replace(/\/$/, "")}/internal/capture-status`);
  url.searchParams.set("fiscalYear", String(fiscalYear));
  url.searchParams.set("resourceId", resourceId);
  const response = await fetch(url, { headers: { authorization: `Bearer ${controlToken}` } });
  if (!response.ok) throw new Error(`capture status returned HTTP ${response.status}`);
  return (await response.json()).capture;
}

async function readCaptureState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error(`Could not read capture state: ${error.message}`);
  }
}

async function writeCaptureState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

const initialState = process.env.LOCAL_UPLOAD === "1" ? await readCaptureState() : {};
const activeResourceId = Object.keys(initialState)[0]?.split(":")[1] ?? process.env.RESOURCE_ID ?? null;
let remainingResources = resourceLimit;

catalog: for (let fiscalYear = years[0]; fiscalYear <= years[1]; fiscalYear += 1) {
  const title = titleFor(fiscalYear);
  const search = await ckan("package_search", { q: title, rows: 20 });
  const dataset = (search.results ?? []).find((item) => item.title === title);
  if (!dataset) { console.log(`${fiscalYear}: unavailable`); continue; }
  const detail = await ckan("package_show", { id: dataset.id });
  const discoveredResources = (detail.resources ?? []).filter((resource) =>
    String(resource.format ?? "").toUpperCase() === "CSV" && resource.datastore_active === true && typeof resource.url === "string",
  );
  const resources = activeResourceId ? discoveredResources.filter((resource) => resource.id === activeResourceId) : discoveredResources;
  for (const resource of resources) {
    if (process.env.LOCAL_UPLOAD === "1") {
      const state = await readCaptureState();
      const stateKey = `${fiscalYear}:${resource.id}:${resource.last_modified || resource.hash || "unknown"}`;
      const previous = state[stateKey];
      const remote = previous ? null : await captureStatus(fiscalYear, resource.id);
      if (!previous && remote?.status === "succeeded") {
        console.log(`${fiscalYear}: already completed ${resource.id}`);
        continue;
      }
      const started = previous ?? (remote?.status === "running" ? {
        run_id: remote.id, nextRangeStart: Number(remote.checkpoint || 0),
      } : { run_id: (await seed({ fiscalYear, resource, localUpload: true })).run_id, nextRangeStart: 0 });
      let nextRangeStart = started.nextRangeStart;
      let workingChunkBytes = started.chunkBytes ?? captureBytes;
      let chunks = 0;
      let uploaded;
      try {
        while (chunks < maxChunks) {
          try {
            uploaded = await uploadChunk({ runId: started.run_id, fiscalYear, resource, rangeStart: nextRangeStart, chunkBytes: workingChunkBytes });
          } catch (error) {
            if (workingChunkBytes > 262144) {
              workingChunkBytes = Math.max(262144, Math.floor(workingChunkBytes / 2));
              console.warn(`${fiscalYear}: transient upload failure; reducing chunk to ${workingChunkBytes} bytes`);
              continue;
            }
            throw error;
          }
          chunks += 1;
          nextRangeStart = uploaded.nextRangeStart;
          state[stateKey] = { run_id: started.run_id, nextRangeStart, totalBytes: uploaded.totalBytes, chunkBytes: workingChunkBytes, updatedAt: new Date().toISOString() };
          if (uploaded.finished) delete state[stateKey];
          await writeCaptureState(state);
          if (uploaded.finished) break;
          await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
        }
      } catch (error) {
        await failCapture(started.run_id, error.message);
        throw error;
      }
      console.log(`${fiscalYear}: ${uploaded.finished ? "completed" : "checkpointed"} ${resource.id} (${chunks} local-upload chunk, run ${started.run_id})`);
      remainingResources -= 1;
      if (remainingResources <= 0) break catalog;
      continue;
    }
    const direct = process.env.DIRECT === "1";
    let result = await seed({ fiscalYear, resource, direct, stopAfterChunk: process.env.SMOKE === "1", chunkBytes: captureBytes });
    let chunks = 1;
    while (direct && !result.capture.finished && chunks < maxChunks) {
      await new Promise((resolve) => setTimeout(resolve, chunkDelayMs));
      result = await seed({ fiscalYear, resource, runId: result.run_id, rangeStart: result.capture.nextRangeStart, direct: true, chunkBytes: captureBytes });
      chunks += 1;
    }
    console.log(`${fiscalYear}: ${result.capture?.finished ? "completed" : "checkpointed"} ${resource.id} (${chunks} chunk)`);
    remainingResources -= 1;
    if (remainingResources <= 0) break catalog;
  }
}
