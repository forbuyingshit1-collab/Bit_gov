import test from 'node:test';
import assert from 'node:assert/strict';
import { readFilters, pageParams, apiParams } from './filters.mjs';
test('pagination retains Thai multi-province selections, baht inputs and view', () => {
  const f = readFilters({ view: 'company', submitted: '1', province: ['ขอนแก่น','อุดรธานี'], minPrice: '12.50', company: 'iqoa' });
  const p = pageParams(f);
  assert.deepEqual(p.getAll('province'), f.provinces);
  assert.equal(p.get('minPrice'), '12.50');
  assert.equal(p.get('view'), 'company');
  assert.equal(apiParams(f).get('minPriceSat'), '1250');
});
test('clearing all provinces stays cleared and company starts with all provinces', () => {
  assert.deepEqual(readFilters({ submitted: '1' }).provinces, []);
  assert.deepEqual(readFilters({ view: 'company' }).provinces, []);
});
