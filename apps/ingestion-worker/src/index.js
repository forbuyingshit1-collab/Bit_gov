import {
  buildRawPage,
  fetchDatastorePage,
  fingerprintRecord,
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

async function seedCatalogResource({ fiscalYear, resource, testMode = false, chunkBytes, stopAfterChunk }, env) {
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
    ).bind(runId, resourceDbId, testMode ? "smoke_capture" : "raw_capture", now),
  ]);
  await env.INGESTION_QUEUE.send({
    type: "capture_csv_range", runId, resourceDbId, resourceId: resource.id, resourceUrl,
    fiscalYear, sourceVersion, rangeStart: 0,
    chunkBytes: chunkBytes ?? DEFAULT_CSV_CHUNK_BYTES,
    stopAfterChunk: stopAfterChunk === true, schemaVersion: 1,
  });
  return runId;
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
  const status = finished ? "succeeded" : message.stopAfterChunk ? "partial" : "running";
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE sync_runs SET status = ?, finished_at = CASE WHEN ? IN ('succeeded', 'partial') THEN ? ELSE NULL END,
       checkpoint = ? WHERE id = ?`,
  ).bind(status, status, now, String(range.end + 1), message.runId).run();

  if (!finished && !message.stopAfterChunk) {
    await env.INGESTION_QUEUE.send({ ...message, rangeStart: range.end + 1 });
  }
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
      const runId = await seedCatalogResource(body, env);
      return Response.json({ queued: true, run_id: runId }, { status: 202 });
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
