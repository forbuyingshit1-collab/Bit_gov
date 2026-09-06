import test from 'node:test';
import assert from 'node:assert/strict';
import { shardBinding, shardIndex } from '../src/sharding.js';

test('resource routing is deterministic and always resolves to a declared shard', () => {
  const id = 'e4eaa1b4-eb1a-4534-b227-988ee25b898d';
  assert.equal(shardBinding(id), shardBinding(id));
  assert.match(shardBinding(id), /^DATA_SHARD_\d{2}$/);
  assert.equal(shardIndex(id, 1), 0);
  assert.throws(() => shardIndex(''), /resourceId/);
});
