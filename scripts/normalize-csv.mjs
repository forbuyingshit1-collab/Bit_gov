import { Readable } from "node:stream";
import { readFile, writeFile } from "node:fs/promises";
import { repairCsvHeaders } from "../packages/ingestion/src/index.js";
import { csvRecords } from "../packages/ingestion/src/csv-stream.js";

const controlToken = process.env.INGESTION_CONTROL_TOKEN;
const workerUrl = process.env.INGESTION_WORKER_URL;
const sourceUrl = process.env.SOURCE_CSV_URL;
const runId = process.env.CAPTURE_RUN_ID;
const resourceId = process.env.RESOURCE_ID;
const fiscalYear = Number(process.env.FISCAL_YEAR);
const sourceVersion = process.env.SOURCE_VERSION;
const batchSize = Number(process.env.NORMALIZE_BATCH_SIZE ?? 10);
const maxRows = Number(process.env.NORMALIZE_MAX_ROWS ?? Number.MAX_SAFE_INTEGER);
const deadline = Date.now() + Number(process.env.NORMALIZE_MAX_MILLISECONDS ?? Number.MAX_SAFE_INTEGER);
const statePath = process.env.NORMALIZE_STATE_PATH ?? ".bit-gov-normalization-state.json";

if (!controlToken || !workerUrl || !sourceUrl || !runId || !resourceId || !sourceVersion || !Number.isInteger(fiscalYear)) {
  throw new Error("Set INGESTION_CONTROL_TOKEN, INGESTION_WORKER_URL, SOURCE_CSV_URL, CAPTURE_RUN_ID, RESOURCE_ID, FISCAL_YEAR and SOURCE_VERSION");
}
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("NORMALIZE_BATCH_SIZE must be 1..100");


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

async function* r2CsvChunks(startByte = 0) {
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
    expectedStart = chunk.end + 1;
    if (chunk.end < startByte) continue;
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
    yield bytes.subarray(Math.max(0, startByte - chunk.start));
  }
  if (expectedStart !== manifest.totalBytes) throw new Error("Raw manifest total length does not match its chunks");
}

async function submit(records, rowStart) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/normalize-records`, {
      method: "POST",
      headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
      body: JSON.stringify({ runId, fiscalYear, resourceId, sourceVersion, records, rowStart }),
    });
    if (response.ok) return response.json();
    const detail = (await response.text()).replace(/\s+/g, " ").slice(0, 180);
    lastError = new Error(`normalization endpoint returned HTTP ${response.status}: ${detail}`);
    if (response.status < 500 || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
  if (records.length > 1 && /HTTP 413/.test(lastError?.message ?? '')) {
    const midpoint = Math.ceil(records.length / 2);
    const left = await submit(records.slice(0, midpoint), rowStart);
    const right = await submit(records.slice(midpoint), rowStart + midpoint);
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
const startByte = process.env.NORMALIZE_INPUT === 'r2' ? Number(state[runId]?.nextByte ?? 0) : 0;
let headers = startByte ? state[runId].headers : null;
let batch = [];
let rowCount = startByte ? resumeFrom : 0;
let acceptedCount = 0;
let duplicateCount = 0;
let quarantineCount = 0;
let nextByte = startByte;
let reachedLimit = false;
const input = process.env.NORMALIZE_INPUT === "r2" ? r2CsvChunks(startByte) : await sourceCsvChunks();
for await (const record of csvRecords(input, startByte)) {
  const { row } = record;
  nextByte = record.nextByte;
  if (!headers) { headers = row.map((value) => value.replace(/^\uFEFF/, "").trim()); continue; }
  rowCount += 1;
  if (rowCount <= resumeFrom) continue;
  headers = repairCsvHeaders(headers, row.length);
  batch.push(row.length === headers.length
    ? Object.fromEntries(headers.map((header, index) => [header, row[index]]))
    : { _ingestion_parse_error: "csv_column_count_mismatch", _source_row_number: String(rowCount) });
  if (batch.length === batchSize || rowCount - resumeFrom >= maxRows) {
    const result = await submit(batch, rowCount - batch.length);
    acceptedCount += result.acceptedCount;
    duplicateCount += result.duplicateCount;
    quarantineCount += result.quarantineCount;
    batch = [];
    state[runId] = { processedRows: rowCount, nextByte, headers, updatedAt: new Date().toISOString() };
    await writeState(state);
    if (rowCount - resumeFrom >= maxRows || Date.now() >= deadline) { reachedLimit = true; break; }
  }
}
if (batch.length) {
  const result = await submit(batch, rowCount - batch.length);
  acceptedCount += result.acceptedCount;
  duplicateCount += result.duplicateCount;
  quarantineCount += result.quarantineCount;
  state[runId] = { processedRows: rowCount, nextByte, headers, updatedAt: new Date().toISOString() };
  await writeState(state);
}
if (!reachedLimit) {
  const response = await fetch(`${workerUrl.replace(/\/$/, '')}/internal/complete-normalization`, {
    method: 'POST', headers: { authorization: `Bearer ${controlToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ runId, rowCount, totalBytes: nextByte }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    if (response.status === 409 && detail.error === 'normalization_ledger_incomplete') {
      // Older checkpoints predate the ledger. Replay from immutable R2; existing batches are idempotent.
      // Keep an explicit state entry so normalize-next-capture cannot mark this file complete.
      state[runId] = { processedRows: 0, updatedAt: new Date().toISOString(), replayReason: detail.error };
      await writeState(state);
      console.log(JSON.stringify({ runId, replayRequired: true }));
      process.exit(0);
    }
    throw new Error(`normalization completion returned HTTP ${response.status}`);
  }
  delete state[runId];
  await writeState(state);
}
console.log(JSON.stringify({ runId, rowCount, resumedFrom: resumeFrom, acceptedCount, duplicateCount, quarantineCount }));
