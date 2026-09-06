import test from 'node:test';
import assert from 'node:assert/strict';
import { csvRecords } from '../src/csv-stream.js';

test('UTF8, escaped quotes, quoted newline and EOF resume at every byte boundary', async () => {
  const bytes = new TextEncoder().encode('ชื่อ,ราคา\r\n"จอ\n""LED""",100\r\n"ไทย",200');
  const expected = [['ชื่อ', 'ราคา'], ['จอ\n"LED"', '100'], ['ไทย', '200']];
  for (let split = 1; split < bytes.length; split++) {
    const results = [];
    for await (const record of csvRecords([bytes.slice(0, split), bytes.slice(split)])) results.push(record);
    assert.deepEqual(results.map(r => r.row), expected);
    const resume = [];
    for await (const record of csvRecords([bytes.slice(results[1].nextByte)], results[1].nextByte)) resume.push(record);
    assert.deepEqual(resume.map(r => r.row), [expected[2]]);
    assert.equal(resume[0].nextByte, bytes.length);
  }
});

test('unfinished quoted record fails instead of declaring EOF complete', async () => {
  await assert.rejects(async () => {
    for await (const row of csvRecords([new TextEncoder().encode('"broken')])) void row;
  }, /inside a quoted/);
});
