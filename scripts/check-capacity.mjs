import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

function wrangler(args) {
  const r = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args,
    '--config', 'apps/ingestion-worker/wrangler.toml', '--json'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Capacity check failed: Wrangler query unavailable');
  return JSON.parse(r.stdout);
}
const info = wrangler(['d1', 'info', 'bit-gov-v2-staging']);
const result = wrangler(['d1', 'execute', 'bit-gov-v2-staging', '--remote', '--command',
  `SELECT COUNT(*) AS registered_resources FROM source_resources;
   SELECT id,total_bytes,normalized_at FROM sync_runs WHERE run_type='local_raw_capture' AND status='succeeded';
   SELECT COUNT(*) AS projects FROM projects;`]);
let checkpoints = {};
try { checkpoints = JSON.parse(await readFile('.bit-gov-normalization-state.json', 'utf8')); }
catch(error) { if (error.code !== 'ENOENT') throw error; }
const resources = result[0].results[0].registered_resources;
const completed = result[1].results;
const observedBytes = completed.reduce((sum, run) => sum + (run.normalized_at ? run.total_bytes : (checkpoints[run.id]?.nextByte ?? 0)), 0);
const averageFileBytes = completed.length ? completed.reduce((n, run) => n + run.total_bytes, 0) / completed.length : null;
const ratio = observedBytes > 0 ? info.database_size / observedBytes : null;
const estimate = ratio && averageFileBytes ? Math.round(ratio * averageFileBytes * resources) : null;
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), databaseBytes: info.database_size,
  projects: result[2].results[0].projects, observedNormalizedRawBytes: observedBytes,
  sampledFiles: completed.length, registeredResources: resources,
  roughProjectedDatabaseBytes: estimate,
  warning: estimate > 10_000_000_000 ? 'Projection exceeds a single D1 database; validate partitioning before full cutover.' : 'Projection is not a capacity guarantee.',
  method: 'Early sample only: database/raw checkpoint ratio multiplied by mean completed capture size and registered resource count. File sizes, schema and deduplication vary; replay checkpoints can understate progress.' }, null, 2));
