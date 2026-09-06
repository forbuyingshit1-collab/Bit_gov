const SHARD_COUNT = 16;

// Stable FNV-1a routing keeps all versions of one CKAN resource in one shard.
// It is deliberately independent of the current catalog ordering.
export function shardIndex(resourceId, shardCount = SHARD_COUNT) {
  if (typeof resourceId !== 'string' || resourceId.length === 0) throw new Error('resourceId is required');
  if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error('shardCount must be a positive integer');
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(resourceId)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shardCount;
}

export function shardBinding(resourceId, shardCount = SHARD_COUNT) {
  return `DATA_SHARD_${String(shardIndex(resourceId, shardCount)).padStart(2, '0')}`;
}

export { SHARD_COUNT };
