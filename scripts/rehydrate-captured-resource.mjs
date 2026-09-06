import { readFile, writeFile } from "node:fs/promises";

const controlToken = process.env.INGESTION_CONTROL_TOKEN;
const workerUrl = process.env.INGESTION_WORKER_URL;
const statePath = process.env.COMPLETED_CAPTURE_STATE_PATH ?? ".bit-gov-completed-captures.json";
const databaseTag = process.env.REHYDRATE_DATABASE_TAG ?? "bit-gov-v2-staging";

if (!controlToken || !workerUrl) throw new Error("Set INGESTION_CONTROL_TOKEN and INGESTION_WORKER_URL");

const state = JSON.parse(await readFile(statePath, "utf8"));
let rehydrated = 0;
for (const [key, entry] of Object.entries(state)) {
  if (entry.rehydratedDatabase === databaseTag) continue;
  const response = await fetch(`${workerUrl.replace(/\/$/, "")}/internal/rehydrate-raw-capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${controlToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      fiscalYear: entry.fiscalYear,
      resource: { id: entry.resourceId, url: entry.sourceUrl, last_modified: entry.sourceVersion },
    }),
  });
  if (!response.ok) throw new Error(`rehydration returned HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
  const result = await response.json();
  state[key] = { ...entry, runId: result.runId, rehydratedDatabase: databaseTag, rehydratedAt: new Date().toISOString() };
  rehydrated += 1;
}
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ statePath, databaseTag, rehydrated }));
