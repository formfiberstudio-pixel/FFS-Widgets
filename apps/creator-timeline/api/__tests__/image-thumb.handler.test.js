import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// The thumbnail proxy, asked for a page's photo by page + edit (the address the
// sync hands out) or -- the older form -- by a Notion link. Fake HTTP for
// Upstash, Notion and the image host; the resizing is real sharp. Env has to be
// set BEFORE the handler is imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const sharp = (await import('sharp')).default;
const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../image-thumb.js');

const TENANT_ID = 'tenant-abc';
const PAGE = '11111111-2222-3333-4444-555555555555';
const EDITED = '2026-10-01T10:00:00.000Z';
const EDIT_MS = Date.parse(EDITED);
const PHOTO = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/photo.png';
const COVER = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/cover.png';
const ELSEWHERE = 'https://example.com/photo.png';

const tenantRecord = {
  encryptedNotionToken: encryptSecret('secret_notion_token'),
  encryptedLicenseKey: encryptSecret('license-key'),
  lastVerifiedAt: Date.now(),
  sources: [],
};

const realFetch = globalThis.fetch;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

let redis;       // key -> JSON string, as Upstash holds it
let blocks;      // page id -> the image URL its body holds (or null)
let pageBody;    // page id -> the page object `GET /v1/pages/{id}` returns
let blockCalls;
let pageCalls;
let imageCalls;
let bigPhoto;

before(async () => {
  bigPhoto = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#c33' } }).png().toBuffer();

  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      const body = JSON.parse(options.body);
      const run = ([command, key, value]) => {
        if (String(command).toUpperCase() === 'GET') return { result: redis[key] ?? null };
        redis[key] = value;
        return { result: 'OK' };
      };
      return json(Array.isArray(body[0]) ? body.map(run) : run(body));
    }
    const blockPage = target.match(/\/v1\/blocks\/([^/]+)\/children/)?.[1];
    if (blockPage) {
      blockCalls.push(blockPage);
      const imageUrl = blocks[blockPage];
      return json({ results: imageUrl ? [{ type: 'image', id: 'b1', image: { type: 'file', file: { url: imageUrl } } }] : [], has_more: false });
    }
    const pageId = target.match(/\/v1\/pages\/([^/?]+)$/)?.[1];
    if (pageId) {
      pageCalls.push(pageId);
      return pageBody[pageId] ? json(pageBody[pageId]) : json({ object: 'error' }, 404);
    }
    if (target.startsWith('https://prod-files-secure.s3.us-west-2.amazonaws.com/') || target.startsWith('https://example.com/')) {
      imageCalls.push(target);
      return new Response(bigPhoto, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return json({ object: 'error', message: `unexpected ${options.method || 'GET'} ${target}` }, 404);
  };
});

after(() => { globalThis.fetch = realFetch; });

beforeEach(() => {
  redis = { [`tenant:${TENANT_ID}`]: JSON.stringify(tenantRecord) };
  blocks = { [PAGE]: PHOTO };
  pageBody = {};
  blockCalls = [];
  pageCalls = [];
  imageCalls = [];
});

const cachedBlocks = (overrides = {}) => JSON.stringify({
  lastEditedTime: EDITED,
  rawImageUrl: PHOTO,
  pageContent: '',
  pageContentBlockId: null,
  pageContentBlockType: null,
  imageCachedAt: Date.now(),
  ...overrides,
});

function makeRes() {
  return {
    statusCode: null, headers: {}, body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
  };
}
const ask = async (query) => {
  const res = makeRes();
  await handler({ method: 'GET', query }, res);
  return res;
};
const byPage = (extra = {}) => ({ t: TENANT_ID, p: PAGE, s: 'b', v: String(EDIT_MS), w: '640', ...extra });

test('a thumbnail asked for by page + edit is made, and can be kept for good', async () => {
  redis[`notionBlocks:v3:${PAGE}`] = cachedBlocks();
  const res = await ask(byPage());
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.match(res.headers['cache-control'], /max-age=31536000/);
  assert.match(res.headers['cache-control'], /immutable/);
  const meta = await sharp(res.body).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 640);
});

test('a photo link the sync cached for this edit is used as it is -- no Notion request', async () => {
  redis[`notionBlocks:v3:${PAGE}`] = cachedBlocks();
  const res = await ask(byPage());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(blockCalls, []);
  assert.deepEqual(imageCalls, [PHOTO]);
});

test('a cached link that has lapsed (over 45 minutes) is not trusted: the page is read for a fresh one', async () => {
  redis[`notionBlocks:v3:${PAGE}`] = cachedBlocks({ imageCachedAt: Date.now() - 2 * 60 * 60 * 1000, rawImageUrl: ELSEWHERE.replace('example.com', 'old.amazonaws.com') });
  const res = await ask(byPage());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(blockCalls, [PAGE]);
  assert.deepEqual(imageCalls, [PHOTO]); // the new link, not the lapsed one
});

test('a cached link for a different edit of the page is not trusted either', async () => {
  redis[`notionBlocks:v3:${PAGE}`] = cachedBlocks({ lastEditedTime: '2026-09-01T10:00:00.000Z' });
  const res = await ask(byPage());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(blockCalls, [PAGE]);
});

test('a page with nothing cached is read for its photo', async () => {
  const res = await ask(byPage());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(blockCalls, [PAGE]);
});

test('a photo kept as a Files & media property or the cover is read from the page itself', async () => {
  pageBody[PAGE] = { id: PAGE, cover: { type: 'file', file: { url: COVER } }, properties: { Name: { type: 'title', title: [] } } };
  const cover = await ask(byPage({ s: 'pg' }));
  assert.equal(cover.statusCode, 200);
  assert.deepEqual(pageCalls, [PAGE]);
  assert.deepEqual(imageCalls, [COVER]);
  assert.deepEqual(blockCalls, []);

  imageCalls = [];
  pageBody[PAGE].properties.Photo = { type: 'files', files: [{ file: { url: PHOTO } }] };
  const property = await ask(byPage({ s: 'pg' }));
  assert.equal(property.statusCode, 200);
  assert.deepEqual(imageCalls, [PHOTO]); // the property wins over the cover, as in the sync
});

test('a page that no longer has a photo is a 404 that is not kept', async () => {
  blocks[PAGE] = null;
  const res = await ask(byPage());
  assert.equal(res.statusCode, 404);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('a failure is never kept for good', async () => {
  pageBody = {};
  const missing = await ask(byPage({ s: 'pg' }));
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.headers['cache-control'], 'no-store');
});

test('bad requests are refused and not kept', async () => {
  for (const bad of [
    byPage({ p: 'not-a-page-id' }),
    byPage({ s: 'x' }),
    byPage({ v: 'soon' }),
    byPage({ t: '../tenant' }),
    byPage({ t: undefined }),
  ]) {
    const res = await ask(bad);
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(blockCalls, []);
  assert.deepEqual(imageCalls, []);
});

test('a widget that does not exist gets nothing', async () => {
  const res = await ask(byPage({ t: 'someone-else' }));
  assert.equal(res.statusCode, 404);
  assert.deepEqual(blockCalls, []);
});

test('a photo link that points outside Notion is not fetched', async () => {
  blocks[PAGE] = ELSEWHERE;
  const res = await ask(byPage());
  assert.equal(res.statusCode, 400);
  assert.deepEqual(imageCalls, []);
});

test('the older form, addressed by a Notion link, still works -- and still only lasts as long as the link', async () => {
  const res = await ask({ url: PHOTO, w: '320' });
  assert.equal(res.statusCode, 200);
  assert.doesNotMatch(res.headers['cache-control'], /immutable/);
  assert.match(res.headers['cache-control'], /max-age=3600/);
  assert.equal((await sharp(res.body).metadata()).width, 320);
  assert.deepEqual(blockCalls, []); // no tenant, no Notion
});

test('the older form refuses other hosts and missing links', async () => {
  assert.equal((await ask({ url: ELSEWHERE })).statusCode, 400);
  assert.equal((await ask({})).statusCode, 400);
  assert.deepEqual(imageCalls, []);
});
