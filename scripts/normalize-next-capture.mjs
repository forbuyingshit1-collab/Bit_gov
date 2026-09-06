import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const completedPath = process.env.COMPLETED_CAPTURE_STATE_PATH ?? ".bit-gov-completed-captures.json";
const normalizationPath = process.env.NORMALIZE_STATE_PATH ?? ".bit-gov-normalization-state.json";

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

const completed = await readJson(completedPath, {});
const next = Object.entries(completed).find(([, entry]) => !entry.normalizedAt);
if (!next) {
  console.log(JSON.stringify({ completedPath, normalized: true }));
  process.exit(0);
}

const [key, entry] = next;
const result = spawnSync(process.execPath, ["scripts/normalize-csv.mjs"], {
  stdio: "inherit",
  env: {
    ...process.env,
    CAPTURE_RUN_ID: entry.runId,
    RESOURCE_ID: entry.resourceId,
    FISCAL_YEAR: String(entry.fiscalYear),
    SOURCE_VERSION: entry.sourceVersion,
    SOURCE_CSV_URL: entry.sourceUrl,
    NORMALIZE_INPUT: process.env.NORMALIZE_INPUT ?? "r2",
  },
});
if (result.status !== 0) process.exit(result.status ?? 1);

const normalization = await readJson(normalizationPath, {});
if (!normalization[entry.runId]) {
  completed[key] = { ...entry, normalizedAt: new Date().toISOString() };
  await writeFile(completedPath, `${JSON.stringify(completed, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ runId: entry.runId, complete: !normalization[entry.runId] }));
