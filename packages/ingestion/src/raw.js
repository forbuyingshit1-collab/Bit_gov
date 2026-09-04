function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeSegment(value) {
  return String(value ?? "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function buildRawPage(resourceId, fiscalYear, sourceVersion, page) {
  const payload = {
    schemaVersion: 1,
    source: "data.go.th-ckan",
    resourceId,
    fiscalYear,
    sourceVersion,
    offset: page.offset,
    limit: page.limit,
    total: page.total,
    fields: page.fields,
    records: page.records,
  };
  const body = canonicalJson(payload);
  const checksum = await sha256Hex(body);
  const key = [
    "raw/ckan",
    `fy=${safeSegment(fiscalYear)}`,
    `resource=${safeSegment(resourceId)}`,
    `version=${safeSegment(sourceVersion)}`,
    `offset=${String(page.offset).padStart(9, "0")}-${checksum}.json`,
  ].join("/");
  return { body, checksum, key };
}

export async function fingerprintRecord(resourceId, record) {
  return sha256Hex({ resourceId, record });
}
