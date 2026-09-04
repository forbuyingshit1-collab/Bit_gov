import {
  buildRawPage,
  fetchDatastorePage,
  fingerprintRecord,
  normalizeProcurementRecord,
  sha256Hex,
} from "../../../packages/ingestion/src/index.js";

const SOURCE_ID = "data-go-th-ckan";
const DEFAULT_CSV_CHUNK_BYTES = 8 * 1024 * 1024;

function validatedResourceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || (url.hostname !== "data.go.th" && !url.hostname.endsWith(".data.go.th"))) {
    throw new Error("Catalog relay returned an untrusted resource URL");
  }
  return url.toString();
}

async function fetchRelayCatalog(fiscalYear, env) {
  if (!env.CATALOG_RELAY_URL || !env.CATALOG_RELAY_TOKEN) {
    throw new Error("Catalog relay is not configured");
  }
  const url = new URL(env.CATALOG_RELAY_URL);
  url.searchParams.set("year", String(fiscalYear));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${env.CATALOG_RELAY_TOKEN}`, accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Catalog relay failed with HTTP ${response.status}`);
  const payload = await response.json();
  return (payload?.resources ?? []).map((resource) => ({
    id: String(resource.id),
    url: validatedResourceUrl(resource.url),
    last_modified: typeof resource.last_modified === "string" ? resource.last_modified : null,
    hash: typeof resource.hash === "string" ? resource.hash : null,
  }));
}

async function secureTokenEqual(received, expected) {
  if (!received || !expected) return false;
  const [left, right] = await Promise.all([sha256Hex(received), sha256Hex(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function currentThaiFiscalYear() {
  return new Date().getUTCFullYear() + 543;
}

function scheduleMessage(cron, scheduledAt) {
  const currentYear = currentThaiFiscalYear();
  if (cron === "0 19 * * 6") {
    return {
      type: "catalog_sync",
      years: Array.from({ length: currentYear - 2564 }, (_, index) => 2565 + index),
      scheduledAt,
      schemaVersion: 1,
    };
  }
  return {
    type: "catalog_sync",
    years: [currentYear - 1, currentYear],
    scheduledAt,
    schemaVersion: 1,
  };
}

function assertInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

async function handleCatalogSync(message, env) {
  if (!Array.isArray(message.years) || message.years.length === 0) {
    throw new Error("catalog_sync requires at least one fiscal year");
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sources (id, name, source_type, base_url, enabled, created_at)
     VALUES (?, ?, 'ckan', ?, 1, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = 1`,
  )
    .bind(SOURCE_ID, "Data.go.th CKAN", "https://data.go.th/api/3/action", now)
    .run();

  let queuedResources = 0;
  const resourceLimit = message.resourceLimit ?? Number.MAX_SAFE_INTEGER;
  assertInteger(resourceLimit, "resourceLimit", { min: 1 });

  for (const fiscalYear of message.years) {
    assertInteger(fiscalYear, "fiscalYear", { min: 2500, max: 3000 });
    const resources = await fetchRelayCatalog(fiscalYear, env);
    if (!resources) {
      console.warn("Fiscal-year dataset is unavailable", { fiscalYear });
      continue;
    }

    for (const resource of resources) {
      if (queuedResources >= resourceLimit) return;
      const resourceDbId = `ckan:${resource.id}`;
      const runId = crypto.randomUUID();
      const sourceVersion = resource.last_modified || resource.hash || "unknown";

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO source_resources
             (id, source_id, external_id, fiscal_year, resource_url, source_last_modified,
              checksum, schema_fingerprint, first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
           ON CONFLICT(source_id, external_id) DO UPDATE SET
             fiscal_year = excluded.fiscal_year,
             resource_url = excluded.resource_url,
             source_last_modified = excluded.source_last_modified,
             checksum = excluded.checksum,
             last_seen_at = excluded.last_seen_at`,
        ).bind(
          resourceDbId,
          SOURCE_ID,
          resource.id,
          fiscalYear,
          resource.url ?? null,
          resource.last_modified ?? null,
          resource.hash || null,
          now,
          now,
        ),
        env.DB.prepare(
          `INSERT INTO sync_runs
             (id, resource_id, run_type, status, started_at,
              source_count, accepted_count, duplicate_count, quarantine_count, checkpoint)
           VALUES (?, ?, ?, 'running', ?, 0, 0, 0, 0, '0')`,
        ).bind(runId, resourceDbId, message.testMode ? "smoke_capture" : "raw_capture", now),
      ]);

      await env.INGESTION_QUEUE.send({
        type: "capture_csv_range",
        runId,
        resourceDbId,
        resourceId: resource.id,
        resourceUrl: resource.url,
        fiscalYear,
        sourceVersion,
        rangeStart: 0,
        chunkBytes: message.chunkBytes ?? DEFAULT_CSV_CHUNK_BYTES,
        stopAfterChunk: message.stopAfterChunk === true,
        schemaVersion: 1,
      });
      queuedResources += 1;
    }
  }
}

async function seedCatalogResource({ fiscalYear, resource, testMode = false, chunkBytes, stopAfterChunk, direct = false, localUpload = false }, env) {
  assertInteger(fiscalYear, "fiscalYear", { min: 2500, max: 3000 });
  if (!resource || typeof resource.id !== "string") throw new Error("seed resource id is required");
  const resourceUrl = validatedResourceUrl(resource.url);
  const now = new Date().toISOString();
  const resourceDbId = `ckan:${resource.id}`;
  const runId = crypto.randomUUID();
  const sourceVersion = resource.last_modified || resource.hash || "unknown";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO sources (id, name, source_type, base_url, enabled, created_at)
       VALUES (?, ?, 'ckan', ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET enabled = 1`,
    ).bind(SOURCE_ID, "Data.go.th CKAN", "https://opend.data.go.th/get-ckan", now),
    env.DB.prepare(
      `INSERT INTO source_resources
         (id, source_id, external_id, fiscal_year, resource_url, source_last_modified,
          checksum, schema_fingerprint, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(source_id, external_id) DO UPDATE SET
         fiscal_year = excluded.fiscal_year, resource_url = excluded.resource_url,
         source_last_modified = excluded.source_last_modified, checksum = excluded.checksum,
         last_seen_at = excluded.last_seen_at`,
    ).bind(resourceDbId, SOURCE_ID, resource.id, fiscalYear, resourceUrl, resource.last_modified ?? null, resource.hash || null, now, now),
    env.DB.prepare(
      `INSERT INTO sync_runs (id, resource_id, run_type, status, started_at,
        source_count, accepted_count, duplicate_count, quarantine_count, checkpoint)
       VALUES (?, ?, ?, 'running', ?, 0, 0, 0, 0, '0')`,
    ).bind(runId, resourceDbId, testMode ? "smoke_capture" : localUpload ? "local_raw_capture" : "raw_capture", now),
  ]);
  const captureMessage = {
    type: "capture_csv_range", runId, resourceDbId, resourceId: resource.id, resourceUrl,
    fiscalYear, sourceVersion, rangeStart: 0,
    chunkBytes: chunkBytes ?? DEFAULT_CSV_CHUNK_BYTES,
    stopAfterChunk: stopAfterChunk === true, direct, schemaVersion: 1,
  };
  let capture;
  if (localUpload) {
    capture = { localUpload: true, nextRangeStart: 0, totalBytes: null, finished: false };
  } else if (direct) {
    try {
      capture = await handleCaptureCsvRange(captureMessage, env);
    } catch (error) {
      await env.DB.prepare(
        "UPDATE sync_runs SET status = 'failed', finished_at = ?, error_summary = ? WHERE id = ?",
      ).bind(new Date().toISOString(), String(error).slice(0, 500), runId).run();
      throw error;
    }
  } else await env.INGESTION_QUEUE.send(captureMessage);
  return { runId, capture };
}

function uploadHeader(request, name) {
  const value = request.headers.get(name);
  if (!value) throw new Error(`Missing ${name} header`);
  return value;
}

async function handleLocalCsvUpload(request, env) {
  const runId = uploadHeader(request, "x-bit-gov-run-id");
  const resourceId = uploadHeader(request, "x-bit-gov-resource-id");
  const fiscalYear = Number(uploadHeader(request, "x-bit-gov-fiscal-year"));
  const sourceVersion = uploadHeader(request, "x-bit-gov-source-version");
  assertInteger(fiscalYear, "fiscalYear", { min: 2500, max: 3000 });
  const range = parseContentRange(uploadHeader(request, "content-range"));
  const expectedLength = range.end - range.start + 1;
  if (expectedLength > DEFAULT_CSV_CHUNK_BYTES) throw new Error("CSV upload chunk is too large");

  const run = await env.DB.prepare(
    `SELECT sr.id AS resource_db_id, sr.external_id, sr.fiscal_year, sr.resource_url, sync_runs.checkpoint
       FROM sync_runs JOIN source_resources sr ON sr.id = sync_runs.resource_id
      WHERE sync_runs.id = ? AND sync_runs.run_type = 'local_raw_capture'`,
  ).bind(runId).first();
  if (!run || run.external_id !== resourceId || run.fiscal_year !== fiscalYear) {
    throw new Error("Upload does not match a local raw capture run");
  }
  const checkpoint = Number(run.checkpoint || 0);
  if (!Number.isSafeInteger(checkpoint) || range.start > checkpoint) {
    throw new Error("CSV upload has a gap before its range");
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength !== expectedLength) throw new Error("CSV upload length does not match Content-Range");
  const message = { fiscalYear, resourceId, sourceVersion };
  const key = csvChunkKey(message, range.start, range.end);
  if (!(await env.RAW_BUCKET.head(key))) {
    const checksum = await sha256Hex(body);
    await env.RAW_BUCKET.put(key, body, {
      httpMetadata: { contentType: "text/csv" },
      customMetadata: { sha256: checksum, source: SOURCE_ID, contentRange: `${range.start}-${range.end}/${range.total}`, uploadedBy: "local-bridge" },
    });
  }

  const nextRangeStart = Math.max(checkpoint, range.end + 1);
  const finished = nextRangeStart >= range.total;
  const now = new Date().toISOString();
  if (finished) {
    const prefix = `raw/source-csv/${fiscalYear}/${resourceId}/${String(sourceVersion).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)}/bytes-`;
    const listed = await env.RAW_BUCKET.list({ prefix, limit: 1000 });
    const manifest = {
      schemaVersion: 1, source: SOURCE_ID, resourceId, fiscalYear, sourceVersion,
      totalBytes: range.total, completedAt: now,
      chunks: listed.objects.map((object) => ({ key: object.key, size: object.size, etag: object.etag })),
    };
    await env.RAW_BUCKET.put(csvManifestKey({ fiscalYear, resourceId, sourceVersion }), JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { source: SOURCE_ID, totalBytes: String(range.total) },
    });
  }
  await env.DB.prepare(
    `UPDATE sync_runs SET status = ?, finished_at = CASE WHEN ? = 'succeeded' THEN ? ELSE NULL END,
       checkpoint = ? WHERE id = ?`,
  ).bind(finished ? "succeeded" : "running", finished ? "succeeded" : "running", now, String(nextRangeStart), runId).run();
  return { runId, finished, nextRangeStart, totalBytes: range.total, key };
}

function csvChunkKey(message, rangeStart, rangeEnd) {
  const version = String(message.sourceVersion).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `raw/source-csv/${message.fiscalYear}/${message.resourceId}/${version}/bytes-${rangeStart}-${rangeEnd}.csv`;
}

function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) throw new Error("Source CSV response did not include a valid Content-Range");
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

function csvManifestKey({ fiscalYear, resourceId, sourceVersion }) {
  const version = String(sourceVersion).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `raw/source-csv/${fiscalYear}/${resourceId}/${version}/manifest.json`;
}

async function handleCaptureCsvRange(message, env) {
  assertInteger(message.rangeStart, "rangeStart");
  assertInteger(message.chunkBytes, "chunkBytes", { min: 1, max: DEFAULT_CSV_CHUNK_BYTES });
  const rangeEnd = message.rangeStart + message.chunkBytes - 1;
  const response = await fetch(validatedResourceUrl(message.resourceUrl), {
    headers: { range: `bytes=${message.rangeStart}-${rangeEnd}` },
  });
  if (response.status !== 206) throw new Error(`Source CSV range request returned HTTP ${response.status}`);
  const range = parseContentRange(response.headers.get("content-range"));
  if (range.start !== message.rangeStart || range.end > rangeEnd) throw new Error("Source CSV range response was inconsistent");

  const body = new Uint8Array(await response.arrayBuffer());
  const key = csvChunkKey(message, range.start, range.end);
  const checksum = await sha256Hex(body);
  if (!(await env.RAW_BUCKET.head(key))) {
    await env.RAW_BUCKET.put(key, body, {
      httpMetadata: { contentType: "text/csv" },
      customMetadata: { sha256: checksum, source: SOURCE_ID, contentRange: `${range.start}-${range.end}/${range.total}` },
    });
  }

  const finished = range.end + 1 >= range.total;
  const status = finished ? "succeeded" : (message.stopAfterChunk || message.direct) ? "partial" : "running";
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE sync_runs SET status = ?, finished_at = CASE WHEN ? IN ('succeeded', 'partial') THEN ? ELSE NULL END,
       checkpoint = ? WHERE id = ?`,
  ).bind(status, status, now, String(range.end + 1), message.runId).run();

  if (!finished && !message.stopAfterChunk && !message.direct) {
    await env.INGESTION_QUEUE.send({ ...message, rangeStart: range.end + 1 });
  }
  return { finished, nextRangeStart: range.end + 1, totalBytes: range.total };
}

async function existingRawRecordIds(db, ids) {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => "?").join(",");
  const result = await db
    .prepare(`SELECT id FROM raw_records WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();
  return new Set((result.results ?? []).map(({ id }) => id));
}

async function ingestNormalizedRecords({ runId, fiscalYear, resourceId, sourceVersion, records }, env) {
  assertInteger(fiscalYear, "fiscalYear", { min: 2500, max: 3000 });
  if (!Array.isArray(records) || records.length === 0 || records.length > 100) {
    throw new Error("records must contain between 1 and 100 rows");
  }
  const resourceDbId = `ckan:${resourceId}`;
  const run = await env.DB.prepare(
    `SELECT sync_runs.id FROM sync_runs JOIN source_resources sr ON sr.id = sync_runs.resource_id
      WHERE sync_runs.id = ? AND sr.id = ? AND sr.fiscal_year = ? AND sync_runs.run_type = 'local_raw_capture'`,
  ).bind(runId, resourceDbId, fiscalYear).first();
  if (!run) throw new Error("Normalized records do not match an approved raw capture run");

  const observedAt = new Date().toISOString();
  const r2ObjectKey = csvManifestKey({ fiscalYear, resourceId, sourceVersion });
  const statements = [];
  let acceptedCount = 0;
  let duplicateCount = 0;
  let quarantineCount = 0;

  for (const record of records) {
    const fingerprint = await fingerprintRecord(resourceId, record);
    const rawId = `raw:${fingerprint}`;
    const normalized = normalizeProcurementRecord(record, fiscalYear);
    if (normalized.error) {
      quarantineCount += 1;
      statements.push(env.DB.prepare(
        `INSERT OR IGNORE INTO ingestion_errors (id, sync_run_id, resource_id, source_record_id, fingerprint, stage, reason_code, detail, created_at)
         VALUES (?, ?, ?, ?, ?, 'normalize', ?, NULL, ?)`,
      ).bind(`error:${fingerprint}`, runId, resourceDbId, String(record._id ?? record["ลำดับ"] ?? ""), fingerprint, normalized.error, observedAt));
      continue;
    }

    const exists = await env.DB.prepare("SELECT id FROM raw_records WHERE id = ?").bind(rawId).first();
    if (exists) {
      duplicateCount += 1;
      continue;
    }
    acceptedCount += 1;
    const projectId = `project:${fingerprint}`;
    const project = normalized.project;
    const contract = normalized.contract;
    statements.push(
      env.DB.prepare(
        `INSERT INTO raw_records (id, resource_id, sync_run_id, source_record_id, fingerprint, r2_object_key, payload_checksum, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(rawId, resourceDbId, runId, String(record._id ?? record["ลำดับ"] ?? ""), fingerprint, r2ObjectKey, fingerprint, observedAt),
      env.DB.prepare(
        `INSERT INTO projects (id, project_code, title, description, agency_name, department_name, province, fiscal_year,
          announcement_date_raw, announcement_date_iso, budget_sat, reference_price_sat, source_url, first_seen_at, last_seen_at, raw_record_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(projectId, project.projectCode, project.title, project.description, project.agencyName, project.departmentName,
        normalized.locationMatch?.province ?? null, fiscalYear, project.announcementDateRaw, project.announcementDateIso,
        project.budgetSat, project.referencePriceSat, null, observedAt, observedAt, rawId),
    );

    const hasContract = contract.contractNumber || contract.contractDateRaw || contract.winningPriceSat !== null;
    const contractId = hasContract ? `contract:${fingerprint}` : null;
    if (contractId) statements.push(env.DB.prepare(
      `INSERT INTO contracts (id, project_id, contract_number, contract_date_raw, contract_date_iso, agreed_price_sat,
        contract_price_sat, winning_price_sat, winning_price_source, source_url, raw_record_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).bind(contractId, projectId, contract.contractNumber, contract.contractDateRaw, contract.contractDateIso,
      contract.agreedPriceSat, contract.contractPriceSat, contract.winningPriceSat, contract.winningPriceSource, rawId));

    if (normalized.supplier) {
      const supplierId = `supplier:${await sha256Hex(normalized.supplier.normalizedName)}`;
      statements.push(
        env.DB.prepare(
          `INSERT INTO suppliers (id, tax_id, name, normalized_name, province) VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name, tax_id = COALESCE(excluded.tax_id, suppliers.tax_id)`,
        ).bind(supplierId, normalized.supplier.taxId, normalized.supplier.name, normalized.supplier.normalizedName),
        env.DB.prepare(
          `INSERT INTO awards (id, project_id, contract_id, supplier_id, award_date_raw, award_date_iso, winning_price_sat, raw_record_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(`award:${fingerprint}`, projectId, contractId, supplierId, contract.contractDateRaw, contract.contractDateIso, contract.winningPriceSat, rawId),
      );
    }
    if (normalized.productMatch) statements.push(env.DB.prepare(
      `INSERT INTO product_matches (id, project_id, category, subcategory, confidence, match_reason, rules_version, decision_status)
       VALUES (?, ?, ?, NULL, ?, ?, 'v1', ?)`,
    ).bind(`product:${fingerprint}`, projectId, normalized.productMatch.category, normalized.productMatch.confidence,
      normalized.productMatch.reason, normalized.productMatch.confidence >= 0.8 ? "auto_approved" : "pending_review"));
    if (normalized.locationMatch) statements.push(env.DB.prepare(
      `INSERT INTO location_matches (id, project_id, province, confidence, match_reason, decision_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(`location:${fingerprint}`, projectId, normalized.locationMatch.province, normalized.locationMatch.confidence,
      normalized.locationMatch.reason, normalized.locationMatch.confidence >= 0.8 ? "auto_approved" : "pending_review"));
  }
  if (statements.length) await env.DB.batch(statements);
  await env.DB.prepare(
    `UPDATE sync_runs SET source_count = source_count + ?, accepted_count = accepted_count + ?,
       duplicate_count = duplicate_count + ?, quarantine_count = quarantine_count + ? WHERE id = ?`,
  ).bind(records.length, acceptedCount, duplicateCount, quarantineCount, runId).run();
  return { sourceCount: records.length, acceptedCount, duplicateCount, quarantineCount };
}

async function enqueueNextPage(message, recordCount, sourceTotal, env) {
  const nextOffset = message.offset + recordCount;
  if (message.stopAfterPage || recordCount === 0 || nextOffset >= sourceTotal) return false;
  await env.INGESTION_QUEUE.send({ ...message, offset: nextOffset });
  return true;
}

async function handleCapturePage(message, env) {
  assertInteger(message.offset, "offset");
  assertInteger(message.pageLimit, "pageLimit", { min: 1, max: 50 });
  const pageId = `${message.runId}:${message.offset}`;
  const processed = await env.DB.prepare(
    `SELECT record_count, source_total FROM ingestion_pages WHERE id = ?`,
  )
    .bind(pageId)
    .first();

  if (processed) {
    await enqueueNextPage(message, processed.record_count, processed.source_total, env);
    return;
  }

  const page = await fetchDatastorePage(message.resourceId, message.offset, message.pageLimit, {});
  const rawPage = await buildRawPage(
    message.resourceId,
    message.fiscalYear,
    message.sourceVersion,
    page,
  );

  if (!(await env.RAW_BUCKET.head(rawPage.key))) {
    await env.RAW_BUCKET.put(rawPage.key, rawPage.body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: rawPage.checksum, source: SOURCE_ID },
    });
  }

  const fingerprints = await Promise.all(
    page.records.map((record) => fingerprintRecord(message.resourceId, record)),
  );
  const rawIds = fingerprints.map((fingerprint) => `raw:${fingerprint}`);
  const existing = await existingRawRecordIds(env.DB, rawIds);
  const observedAt = new Date().toISOString();
  const acceptedCount = rawIds.filter((id) => !existing.has(id)).length;
  const duplicateCount = rawIds.length - acceptedCount;
  const pageComplete = page.records.length === 0 || message.offset + page.records.length >= page.total;
  const runStatus = pageComplete ? "succeeded" : message.stopAfterPage ? "partial" : "running";

  const statements = page.records.map((record, index) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO raw_records
         (id, resource_id, sync_run_id, source_record_id, fingerprint,
          r2_object_key, payload_checksum, observed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      rawIds[index],
      message.resourceDbId,
      message.runId,
      String(record._id ?? record["ลำดับ"] ?? ""),
      fingerprints[index],
      rawPage.key,
      fingerprints[index],
      observedAt,
    ),
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO ingestion_pages
         (id, sync_run_id, resource_id, page_offset, page_limit, source_total,
          record_count, accepted_count, duplicate_count, quarantine_count,
          payload_checksum, r2_object_key, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    ).bind(
      pageId,
      message.runId,
      message.resourceDbId,
      message.offset,
      message.pageLimit,
      page.total,
      page.records.length,
      acceptedCount,
      duplicateCount,
      rawPage.checksum,
      rawPage.key,
      observedAt,
    ),
    env.DB.prepare(
      `UPDATE sync_runs SET
         status = ?,
         finished_at = CASE WHEN ? IN ('succeeded', 'partial') THEN ? ELSE NULL END,
         source_count = source_count + ?,
         accepted_count = accepted_count + ?,
         duplicate_count = duplicate_count + ?,
         checkpoint = ?
       WHERE id = ?`,
    ).bind(
      runStatus,
      runStatus,
      observedAt,
      page.records.length,
      acceptedCount,
      duplicateCount,
      String(message.offset + page.records.length),
      message.runId,
    ),
    env.DB.prepare(
      `UPDATE source_resources SET schema_fingerprint = ?, last_seen_at = ? WHERE id = ?`,
    ).bind(await sha256Hex(page.fields), observedAt, message.resourceDbId),
  );

  await env.DB.batch(statements);
  await enqueueNextPage(message, page.records.length, page.total, env);
}

async function processMessage(message, env) {
  if (!message || message.schemaVersion !== 1) throw new Error("Unsupported queue message");
  if (message.type === "catalog_sync") return handleCatalogSync(message, env);
  if (message.type === "capture_csv_range") return handleCaptureCsvRange(message, env);
  if (message.type === "capture_page") return handleCapturePage(message, env);
  throw new Error(`Unsupported queue message type: ${message.type}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "bit-gov-ingestion",
        environment: env.APP_ENV,
        scheduleEnabled: false,
        bindings: {
          database: Boolean(env.DB),
          rawBucket: Boolean(env.RAW_BUCKET),
          queue: Boolean(env.INGESTION_QUEUE),
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/internal/smoke-capture") {
      const authorized = await secureTokenEqual(
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
        env.INGESTION_CONTROL_TOKEN,
      );
      if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });
      await env.INGESTION_QUEUE.send({
        type: "catalog_sync",
        years: [2568],
        resourceLimit: 1,
        chunkBytes: 1024 * 1024,
        stopAfterChunk: true,
        testMode: true,
        schemaVersion: 1,
      });
      return Response.json({ queued: true, mode: "smoke", rowsAtMost: 10 }, { status: 202 });
    }

    if (request.method === "POST" && url.pathname === "/internal/seed-catalog-resource") {
      const authorized = await secureTokenEqual(
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""), env.INGESTION_CONTROL_TOKEN,
      );
      if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });
      const body = await request.json();
      if (typeof body.runId === "string") {
        try {
          const resourceUrl = validatedResourceUrl(body.resource?.url);
          const capture = await handleCaptureCsvRange({
            type: "capture_csv_range", runId: body.runId, resourceDbId: `ckan:${body.resource.id}`,
            resourceId: body.resource.id, resourceUrl, fiscalYear: body.fiscalYear,
            sourceVersion: body.resource.last_modified || body.resource.hash || "unknown",
            rangeStart: body.rangeStart, chunkBytes: body.chunkBytes ?? DEFAULT_CSV_CHUNK_BYTES,
            stopAfterChunk: body.stopAfterChunk === true, direct: true, schemaVersion: 1,
          }, env);
          return Response.json({ queued: false, run_id: body.runId, capture }, { status: 200 });
        } catch (error) {
          await env.DB.prepare(
            "UPDATE sync_runs SET status = 'failed', finished_at = ?, error_summary = ? WHERE id = ?",
          ).bind(new Date().toISOString(), String(error).slice(0, 500), body.runId).run();
          return Response.json({ error: "capture_failed" }, { status: 503 });
        }
      }
      const result = await seedCatalogResource(body, env);
      return Response.json({ queued: !body.direct, run_id: result.runId, capture: result.capture ?? null }, { status: 202 });
    }

    if (request.method === "POST" && url.pathname === "/internal/upload-csv-chunk") {
      const authorized = await secureTokenEqual(
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""), env.INGESTION_CONTROL_TOKEN,
      );
      if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });
      try {
        return Response.json(await handleLocalCsvUpload(request, env), { status: 200 });
      } catch (error) {
        return Response.json({ error: "upload_failed", detail: String(error).slice(0, 180) }, { status: 400 });
      }
    }

    if (request.method === "POST" && url.pathname === "/internal/normalize-records") {
      const authorized = await secureTokenEqual(
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""), env.INGESTION_CONTROL_TOKEN,
      );
      if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });
      try {
        return Response.json(await ingestNormalizedRecords(await request.json(), env));
      } catch (error) {
        return Response.json({ error: "normalization_failed", detail: String(error).slice(0, 180) }, { status: 400 });
      }
    }

    if (request.method === "POST" && url.pathname === "/internal/public-source-probe") {
      const authorized = await secureTokenEqual(
        request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
        env.INGESTION_CONTROL_TOKEN,
      );
      if (!authorized) return Response.json({ error: "unauthorized" }, { status: 401 });
      const sourceUrl =
        "https://data.go.th/dataset/3beb7813-3607-4e5f-a094-b3b574a6e358/resource/e4eaa1b4-eb1a-4534-b227-988ee25b898d/download/2568-egp-contract-1.csv";
      const response = await fetch(sourceUrl, { headers: { range: "bytes=0-0" } });
      await response.body?.cancel();
      return Response.json({
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
      });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  },

  async scheduled(controller, env) {
    await env.INGESTION_QUEUE.send(
      scheduleMessage(controller.cron, new Date(controller.scheduledTime).toISOString()),
    );
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error("Ingestion message failed", {
          type: message.body?.type,
          message: String(error),
        });
        message.retry();
      }
    }
  },
};
