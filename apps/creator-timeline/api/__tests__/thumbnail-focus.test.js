import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Which part of each photo shows when it is cropped: what is fit to store, and
// saving it on the tenant record through backlog-photo.js with fake HTTP for
// Upstash. Env has to be set BEFORE the handler is imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../backlog-photo.js');
const { sanitizeThumbnailFocus } = await import('../_lib/thumbnailFocus.js');

const A = '11111111-2222-3333-4444-555555555555';
const B = '11111111-2222-3333-4444-666666666666';
const TENANT_ID = 'tenant-abc';

test('a position is kept as percentages inside 0-100, to a tenth', () => {
  assert.deepEqual(sanitizeThumbnailFocus({ [A]: { x: 12.34, y: 80 } }), { [A]: { x: 12.3, y: 80 } });
  assert.deepEqual(sanitizeThumbnailFocus({ [A]: { x: -20, y: 400 } }), { [A]: { x: 0, y: 100 } });
  assert.deepEqual(sanitizeThumbnailFocus({ [A]: { x: '30', y: '70' } }), { [A]: { x: 30, y: 70 } });
});

test('the middle is the default, so it is never stored', () => {
  assert.deepEqual(sanitizeThumbnailFocus({ [A]: { x: 50, y: 50 }, [B]: { x: 50, y: 20 } }), { [B]: { x: 50, y: 20 } });
  assert.deepEqual(sanitizeThumbnailFocus({ [A]: { x: 50.04, y: 49.96 } }), {});
});

test('only real entry ids with real numbers are kept', () => {
  assert.deepEqual(sanitizeThumbnailFocus({ nope: { x: 1, y: 1 }, [A]: { x: 'left', y: 1 }, [B]: { x: 10 }, '': { x: 1, y: 1 } }), {});
  assert.deepEqual(sanitizeThumbnailFocus({ [A]: null }), {});
  assert.deepEqual(sanitizeThumbnailFocus(undefined), {});
  assert.deepEqual(sanitizeThumbnailFocus([1, 2]), {});
  assert.deepEqual(sanitizeThumbnailFocus('x'), {});
});

test('a very large map is cut, not refused', () => {
  const many = {};
  for (let i = 0; i < 6000; i++) many[`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`] = { x: 10, y: 10 };
  assert.equal(Object.keys(sanitizeThumbnailFocus(many)).length, 5000);
});

// ---------------------------------------------------------------- saving it

let stored;
const realFetch = globalThis.fetch;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      const body = JSON.parse(options.body);
      const commands = Array.isArray(body[0]) ? body : [body];
      return json(commands.map(([name, , value]) => {
        if (String(name).toUpperCase() === 'GET') return { result: stored === null ? null : JSON.stringify(stored) };
        if (String(name).toUpperCase() === 'SET') stored = JSON.parse(value);
        return { result: 'OK' };
      }));
    }
    return json({ object: 'error', message: `unexpected ${options.method} ${target}` }, 404);
  };
});

after(() => { globalThis.fetch = realFetch; });

function reset() {
  stored = {
    encryptedNotionToken: encryptSecret('secret_notion_token'),
    encryptedLicenseKey: encryptSecret('license-key'),
    lastVerifiedAt: Date.now(),
    sources: [{ label: 'Activity Log', databaseId: 'db-1' }],
    projectOrder: { sources: ['A', 'B'] },
  };
}

async function call(body) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ method: 'POST', body: { tenantId: TENANT_ID, ...body } }, res);
  return res;
}

test('the positions are saved on the tenant record and the rest of it is left alone', async () => {
  reset();
  const res = await call({ action: 'setThumbnailFocus', focus: { [A]: { x: 20, y: 75 }, junk: { x: 1, y: 1 } } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.focus, { [A]: { x: 20, y: 75 } });
  assert.deepEqual(stored.thumbnailFocus, { [A]: { x: 20, y: 75 } });
  assert.deepEqual(stored.projectOrder, { sources: ['A', 'B'] });
  assert.ok(stored.encryptedNotionToken && stored.sources.length === 1);
});

test('saving again replaces the map, and an empty one clears it', async () => {
  reset();
  await call({ action: 'setThumbnailFocus', focus: { [A]: { x: 20, y: 75 } } });
  await call({ action: 'setThumbnailFocus', focus: { [B]: { x: 60, y: 10 } } });
  assert.deepEqual(stored.thumbnailFocus, { [B]: { x: 60, y: 10 } });
  await call({ action: 'setThumbnailFocus', focus: {} });
  assert.deepEqual(stored.thumbnailFocus, {});
});

test('a request with no map is refused', async () => {
  reset();
  for (const focus of [undefined, null, 'text', [1], 3]) {
    assert.equal((await call({ action: 'setThumbnailFocus', focus })).statusCode, 400, JSON.stringify(focus));
  }
});
