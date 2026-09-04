import { Readable } from "node:stream";

const controlToken = process.env.INGESTION_CONTROL_TOKEN;
const workerUrl = process.env.INGESTION_WORKER_URL;
const sourceUrl = process.env.SOURCE_CSV_URL;
const runId = process.env.CAPTURE_RUN_ID;
const resourceId = process.env.RESOURCE_ID;
const fiscalYear = Number(process.env.FISCAL_YEAR);
const sourceVersion = process.env.SOURCE_VERSION;
const batchSize = Number(process.env.NORMALIZE_BATCH_SIZE ?? 10);
const maxRows = Number(process.env.NORMALIZE_MAX_ROWS ?? Number.MAX_SAFE_INTEGER);

if (!controlToken || !workerUrl || !sourceUrl || !runId || !resourceId || !sourceVersion || !Number.isInteger(fiscalYear)) {
  throw new Error("Set INGESTION_CONTROL_TOKEN, INGESTION_WORKER_URL, SOURCE_CSV_URL, CAPTURE_RUN_ID, RESOURCE_ID, FISCAL_YEAR and SOURCE_VERSION");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("NORMALIZE_BATCH_SIZE must be 1..100");

async function* csvRows(body) {
  const decoder = new TextDecoder("utf-8");
  let field = "";
  let row = [];
  let inQuotes = false;
  let pendingQuote = false;
  for await (const chunk of Readable.fromWeb(body)) {
    const text = decoder.decode(chunk, { stream: true });
    for (let index = 0; index < text.length; index += 1) {
      let character = text[index];
      if (pendingQuote) {
        pendingQuote = false;
        if (character === '"') { field += '"'; continue; }
        inQuotes = false;
      }
      if (inQuotes) {
        if (character === '"') {
          if (index + 1 < text.length && text[index + 1] === '"') { field += '"'; index += 1; }
          else if (index + 1 === text.length) pendingQuote = true;
          else inQuotes = false;
        } else field += character;
        continue;
      }
      if (character === '"' && field.length === 0) { inQuotes = true; continue; }
      if (character === ",") { row.push(field); field = ""; continue; }
      if (character === "\n") { row.push(field); field = ""; yield row; row = []; continue; }
      if (character !== "\r") field += character;
    }
  }
  const tail = decoder.decode();
  if (tail) field += tail;
  if (inQuotes || pendingQuote) throw new Error("CSV ended inside a quoted field");
  if (field.length || row.length) { row.push(field); yield row; }
}

async function submit(records) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/normalize-records`, {
      method: "POST",
      headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
      body: JSON.stringify({ runId, fiscalYear, resourceId, sourceVersion, records }),
    });
    if (response.ok) return response.json();
    if (response.status < 500 || attempt === 3) throw new Error(`normalization endpoint returned HTTP ${response.status}`);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

const response = await fetch(sourceUrl);
if (!response.ok || !response.body) throw new Error(`source CSV returned HTTP ${response.status}`);
let headers;
let batch = [];
let rowCount = 0;
let acceptedCount = 0;
let duplicateCount = 0;
let quarantineCount = 0;
for await (const row of csvRows(response.body)) {
  if (!headers) { headers = row.map((value) => value.replace(/^\uFEFF/, "").trim()); continue; }
  if (row.length !== headers.length) throw new Error(`CSV row ${rowCount + 1} has ${row.length} fields; expected ${headers.length}`);
  batch.push(Object.fromEntries(headers.map((header, index) => [header, row[index]])));
  rowCount += 1;
  if (batch.length === batchSize || rowCount >= maxRows) {
    const result = await submit(batch);
    acceptedCount += result.acceptedCount;
    duplicateCount += result.duplicateCount;
    quarantineCount += result.quarantineCount;
    batch = [];
    if (rowCount >= maxRows) break;
  }
}
if (batch.length) {
  const result = await submit(batch);
  acceptedCount += result.acceptedCount;
  duplicateCount += result.duplicateCount;
  quarantineCount += result.quarantineCount;
}
console.log(JSON.stringify({ runId, rowCount, acceptedCount, duplicateCount, quarantineCount }));
