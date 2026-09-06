import { Readable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { repairCsvHeaders } from "../packages/ingestion/src/index.js";

const controlToken = process.env.INGESTION_CONTROL_TOKEN;
const workerUrl = process.env.INGESTION_WORKER_URL;
const sourceUrl = process.env.SOURCE_CSV_URL;
const runId = process.env.CAPTURE_RUN_ID;
const resourceId = process.env.RESOURCE_ID;
const fiscalYear = Number(process.env.FISCAL_YEAR);
const sourceVersion = process.env.SOURCE_VERSION;
const batchSize = Number(process.env.NORMALIZE_BATCH_SIZE ?? 10);
const maxRows = Number(process.env.NORMALIZE_MAX_ROWS ?? Number.MAX_SAFE_INTEGER);
const statePath = process.env.NORMALIZE_STATE_PATH ?? ".bit-gov-normalization-state.json";

if (!controlToken || !workerUrl || !sourceUrl || !runId || !resourceId || !sourceVersion || !Number.isInteger(fiscalYear)) {
  throw new Error("Set INGESTION_CONTROL_TOKEN, INGESTION_WORKER_URL, SOURCE_CSV_URL, CAPTURE_RUN_ID, RESOURCE_ID, FISCAL_YEAR and SOURCE_VERSION");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("NORMALIZE_BATCH_SIZE must be 1..100");

async function* csvRows(chunks) {
  const decoder = new TextDecoder("utf-8");
  let field = "";
  let row = [];
  let inQuotes = false;
  let pendingQuote = false;
  for await (const chunk of chunks) {
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

async function sourceCsvChunks() {
  const response = await fetch(sourceUrl);
  if (!response.ok || !response.body) throw new Error(`source CSV returned HTTP ${response.status}`);
  return Readable.fromWeb(response.body);
}

function rangeFromKey(key) {
  const match = /bytes-(\d+)-(\d+)\.csv$/.exec(key ?? "");
  if (!match) throw new Error("Raw manifest contains an invalid chunk key");
  return { start: Number(match[1]), end: Number(match[2]) };
}

async function* r2CsvChunks() {
  const manifestUrl = new URL(`${workerUrl.replace(/\/$/, "")}/internal/raw-csv-manifest`);
  manifestUrl.searchParams.set("fiscalYear", String(fiscalYear));
  manifestUrl.searchParams.set("resourceId", resourceId);
  manifestUrl.searchParams.set("sourceVersion", sourceVersion);
  const manifestResponse = await fetch(manifestUrl, { headers: { authorization: `Bearer ${controlToken}` } });
  if (!manifestResponse.ok) throw new Error(`raw manifest returned HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) throw new Error("Raw manifest has no chunks");
  const chunks = manifest.chunks.map((item) => ({ ...item, ...rangeFromKey(item.key) })).sort((left, right) => left.start - right.start);
  let expectedStart = 0;
  for (const chunk of chunks) {
    if (chunk.start !== expectedStart) throw new Error("Raw manifest has a gap or overlapping chunks");
    const chunkUrl = new URL(`${workerUrl.replace(/\/$/, "")}/internal/raw-csv-chunk`);
    chunkUrl.searchParams.set("fiscalYear", String(fiscalYear));
    chunkUrl.searchParams.set("resourceId", resourceId);
    chunkUrl.searchParams.set("sourceVersion", sourceVersion);
    chunkUrl.searchParams.set("rangeStart", String(chunk.start));
    chunkUrl.searchParams.set("rangeEnd", String(chunk.end));
    const response = await fetch(chunkUrl, { headers: { authorization: `Bearer ${controlToken}` } });
    if (!response.ok) throw new Error(`raw chunk returned HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== chunk.end - chunk.start + 1) throw new Error("Raw chunk length does not match its manifest");
    expectedStart = chunk.end + 1;
    yield bytes;
  }
  if (expectedStart !== manifest.totalBytes) throw new Error("Raw manifest total length does not match its chunks");
}

async function submit(records) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/normalize-records`, {
      method: "POST",
      headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
      body: JSON.stringify({ runId, fiscalYear, resourceId, sourceVersion, records }),
    });
    if (response.ok) return response.json();
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 180);
    lastError = new Error(`normalization endpoint returned HTTP ${response.status}: ${detail}`);
    if (response.status < 500 || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  if (records.length > 1) {
    const midpoint = Math.ceil(records.length / 2);
    const [left, right] = await Promise.all([submit(records.slice(0, midpoint)), submit(records.slice(midpoint))]);
    return {
      sourceCount: left.sourceCount + right.sourceCount,
      acceptedCount: left.acceptedCount + right.acceptedCount,
      duplicateCount: left.duplicateCount + right.duplicateCount,
      quarantineCount: left.quarantineCount + right.quarantineCount,
    };
  }
  throw lastError;
}

async function readState() {
  try { return JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return {}; throw error; }
}

async function writeState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

const state = await readState();
const resumeFrom = Number(state[runId]?.processedRows ?? 0);
let headers;
let batch = [];
let rowCount = 0;
let acceptedCount = 0;
let duplicateCount = 0;
let quarantineCount = 0;
const input = process.env.NORMALIZE_INPUT === "r2" ? r2CsvChunks() : await sourceCsvChunks();
for await (const row of csvRows(input)) {
  if (!headers) { headers = row.map((value) => value.replace(/^\uFEFF/, "").trim()); continue; }
  rowCount += 1;
  if (rowCount <= resumeFrom) continue;
  headers = repairCsvHeaders(headers, row.length);
  batch.push(row.length === headers.length
    ? Object.fromEntries(headers.map((header, index) => [header, row[index]]))
    : { _ingestion_parse_error: "csv_column_count_mismatch", _source_row_number: String(rowCount) });
  if (batch.length === batchSize || rowCount - resumeFrom >= maxRows) {
    const result = await submit(batch);
    acceptedCount += result.acceptedCount;
    duplicateCount += result.duplicateCount;
    quarantineCount += result.quarantineCount;
    batch = [];
    state[runId] = { processedRows: rowCount, updatedAt: new Date().toISOString() };
    await writeState(state);
    if (rowCount - resumeFrom >= maxRows) break;
  }
}
if (batch.length) {
  const result = await submit(batch);
  acceptedCount += result.acceptedCount;
  duplicateCount += result.duplicateCount;
  quarantineCount += result.quarantineCount;
  state[runId] = { processedRows: rowCount, updatedAt: new Date().toISOString() };
  await writeState(state);
}
if (rowCount - resumeFrom < maxRows) {
  delete state[runId];
  await writeState(state);
}
console.log(JSON.stringify({ runId, rowCount, resumedFrom: resumeFrom, acceptedCount, duplicateCount, quarantineCount }));
