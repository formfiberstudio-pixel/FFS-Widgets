import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Saving the person's colours for their projects and types, through
// backlog-photo.js, and getting them back with a sync (get-notion-logs.js), with
// fake HTTP for Upstash (the tenant record) and Notion. Env has to be set BEFORE
// the handlers are imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: saveHandler } = await import('../backlog-photo.js');
const { default: syncHandler } = await import('../get-notion-logs.js');

const TENANT_ID = 'tenant-abc';
let stored; // the tenant record as Redis holds it
let writes;
const realFetch = globalThis.fetch;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

const freshRecord = () => ({
  encryptedNotionToken: encryptSecret('secret_notion_token'),
  encryptedLicenseKey: encryptSecret('license-key'),
  lastVerifiedAt: Date.now(),
  sources: [{ label: 'Activity Log', databaseId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee' }],
  savedViews: [{ id: 'v1', label: 'Knits only', sources: ['Knits'] }],
  projectOrder: { sources: ['A'] },
});

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      const command = JSON.parse(options.body);
      const commands = Array.isArray(command[0]) ? command : [command];
      return json(commands.map(([name, key, value]) => {
        if (String(name).toUpperCase() === 'GET') {
          if (String(key).startsWith('tenant:')) return { result: stored === null ? null : JSON.stringify(stored) };
          return { result: null }; // the Notion caches
        }
        if (String(name).toUpperCase() === 'SET' && String(key).startsWith('tenant:')) { stored = JSON.parse(value); writes += 1; }
        return { result: 'OK' };
      }));
    }
    if (/\/v1\/databases\/[^/]+\/query$/.test(target)) return json({ results: [], has_more: false, next_cursor: null });
    return json({ object: 'error', message: `unexpected ${options.method} ${target}` }, 404);
  };
});

after(() => { globalThis.fetch = realFetch; });

function reset() {
  stored = freshRecord();
  writes = 0;
}

async function save(body) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await saveHandler({ method: 'POST', body: { tenantId: TENANT_ID, ...body } }, res);
  return res;
}

async function sync() {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await syncHandler({ method: 'POST', body: { tenantId: TENANT_ID, timeZone: 'UTC' } }, res);
  return res;
}

const COLOURS = { project: { 'Garden Notes': '#e11d48' }, category: { Writing: '#2563eb' } };

test('the colours are saved on the tenant record, and the rest of the record is left alone', async () => {
  reset();
  const before = freshRecord();
  const res = await save({ action: 'setCustomColors', colors: COLOURS });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.colors, COLOURS);
  assert.deepEqual(stored.customColors, COLOURS);
  assert.deepEqual(stored.savedViews, before.savedViews);
  assert.deepEqual(stored.projectOrder, before.projectOrder);
  assert.ok(stored.encryptedNotionToken && stored.encryptedLicenseKey);
});

test('saving again replaces the set, so a colour that was reset is gone from every device', async () => {
  reset();
  await save({ action: 'setCustomColors', colors: COLOURS });
  await save({ action: 'setCustomColors', colors: { project: {}, category: { Writing: '#2563eb' } } });
  assert.deepEqual(stored.customColors, { project: {}, category: { Writing: '#2563eb' } });
  await save({ action: 'setCustomColors', colors: { project: {}, category: {} } });
  assert.deepEqual(stored.customColors, { project: {}, category: {} });
});

test('only real colours are kept', async () => {
  reset();
  const res = await save({ action: 'setCustomColors', colors: { project: { Good: '#ABCDEF', Bad: 'red', Sneaky: 'url(x)' }, category: 'nope' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(stored.customColors, { project: { Good: '#abcdef' }, category: {} });
});

test('a request with no colours is refused and writes nothing', async () => {
  reset();
  for (const colors of [undefined, null, 'text', ['a'], 7]) {
    const res = await save({ action: 'setCustomColors', colors });
    assert.equal(res.statusCode, 400, JSON.stringify(colors));
  }
  assert.equal(writes, 0);
});

test('a tenant that has not been set up cannot save any', async () => {
  reset();
  stored = null;
  assert.equal((await save({ action: 'setCustomColors', colors: COLOURS })).statusCode, 404);
});

test('a sync brings the colours back; a tenant that never saved any gets null, so a device can send its own', async () => {
  reset();
  const never = await sync();
  assert.equal(never.statusCode, 200, JSON.stringify(never.body));
  assert.equal(never.body.customColors, null);

  await save({ action: 'setCustomColors', colors: COLOURS });
  const after = await sync();
  assert.deepEqual(after.body.customColors, COLOURS);
});
