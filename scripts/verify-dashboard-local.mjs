import assert from 'node:assert/strict';
const base = 'http://localhost:3017';
const pin = process.env.LOCAL_QA_PIN;
if (!pin) throw new Error('Set LOCAL_QA_PIN for the local test server');
const login = await (await fetch(`${base}/login`)).text();
const action = /name="(\$ACTION_ID_[^"]+)"/.exec(login)?.[1];
assert.ok(action, 'login Server Action is rendered');
const form = new FormData(); form.set(action, ''); form.set('pin', pin); form.set('next', '/');
const response = await fetch(`${base}/login`, { method: 'POST', body: form, redirect: 'manual' });
assert.equal(response.status, 303);
assert.equal(response.headers.get('location'), '/');
const cookie = response.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie, 'signed login session is issued');
for (const [view, active] of [['search','results'],['company','company-work'],['market',null],['recommended','recommended'],['forecast','forecast'],['review',null]]) {
  const page = await fetch(`${base}/?view=${view}&submitted=1`, { headers: { cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  if (active) {
    const section = new RegExp(`<section id="${active}"[^>]*>`).exec(html)?.[0];
    assert.ok(section && !section.includes('hidden'), `${view} content visible`);
  }
  if (view !== 'search') assert.match(html, /<section id="results"[^>]*hidden/);
  assert.match(html, new RegExp(`name="view" value="${view}"`));
  console.log(`${view}: authenticated render and independent filter passed`);
}
const csv = await fetch(`${base}/api/export/projects?dataset=company`, { headers: { cookie } });
assert.equal(csv.status, 200);
const bytes = new Uint8Array(await csv.arrayBuffer());
assert.deepEqual([...bytes.slice(0,3)], [239,187,191], 'Excel UTF8 BOM');
console.log('company CSV: authenticated export and BOM passed');
