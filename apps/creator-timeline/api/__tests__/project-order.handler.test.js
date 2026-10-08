import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Saving the person's own project order, through backlog-photo.js with fake HTTP
// for Upstash (the tenant record). Env has to be set BEFORE the handler is imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../backlog-photo.js');

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
});

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      const command = JSON.parse(options.body);
      const commands = Array.isArray(command[0]) ? command : [command];
      return json(commands.map(([name, key, value]) => {
        if (String(name).toUpperCase() === 'GET') return { result: stored === null ? null : JSON.stringify(stored) };
        if (String(name).toUpperCase() === 'SET') { stored = JSON.parse(value); writes += 1; }
        return { result: 'OK' };
      }));
    }
    return json({ object: 'error', message: `unexpected ${options.method} ${target}` }, 404);
  };
});

after(() => { globalThis.fetch = realFetch; });

function reset() {
  stored = freshRecord();
  writes = 0;
}

async function call(body) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ method: 'POST', body: { tenantId: TENANT_ID, ...body } }, res);
  return res;
}

test('the order is saved on the tenant record, and the rest of the record is left alone', async () => {
  reset();
  const before = freshRecord();
  stored.sources = before.sources;
  const res = await call({ action: 'setProjectOrder', order: { sources: ['PLANTS', 'KNITS'], 'projects:KNITS::Log': ['General', 'Cardigan'] } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.order, { sources: ['PLANTS', 'KNITS'], 'projects:KNITS::Log': ['General', 'Cardigan'] });
  assert.deepEqual(stored.projectOrder, res.body.order);
  assert.deepEqual(stored.savedViews, before.savedViews);
  assert.deepEqual(stored.sources, before.sources);
  assert.ok(stored.encryptedNotionToken && stored.encryptedLicenseKey);
});

test('saving again replaces the order, and an empty one clears it', async () => {
  reset();
  await call({ action: 'setProjectOrder', order: { sources: ['A', 'B'] } });
  await call({ action: 'setProjectOrder', order: { sources: ['B', 'A'] } });
  assert.deepEqual(stored.projectOrder, { sources: ['B', 'A'] });
  await call({ action: 'setProjectOrder', order: {} });
  assert.deepEqual(stored.projectOrder, {});
});

test('only what is fit to keep is kept', async () => {
  reset();
  const res = await call({ action: 'setProjectOrder', order: { sources: ['A', 'A', '', 5], bogus: ['x'], 'types:A': 'nope' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(stored.projectOrder, { sources: ['A'] });
});

test('a request with no order is refused and writes nothing', async () => {
  reset();
  for (const order of [undefined, null, 'text', ['a'], 7]) {
    const res = await call({ action: 'setProjectOrder', order });
    assert.equal(res.statusCode, 400, JSON.stringify(order));
  }
  assert.equal(writes, 0);
});

test('a tenant that has not been set up cannot save one', async () => {
  reset();
  stored = null;
  const res = await call({ action: 'setProjectOrder', order: { sources: ['A'] } });
  assert.equal(res.statusCode, 404);
});
