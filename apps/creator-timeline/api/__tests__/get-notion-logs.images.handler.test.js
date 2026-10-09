import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// What the sync hands out as each entry's picture, and what it costs: fake HTTP
// for Upstash and Notion, through the real get-notion-logs.js handler. Env has
// to be set BEFORE the handler is imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../get-notion-logs.js');

const TENANT_ID = 'tenant-abc';
const DB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EDITED = '2026-10-01T10:00:00.000Z';
const EDIT_MS = Date.parse(EDITED);
const HOUR = 60 * 60 * 1000;
const SIGNED = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/photo.png?X-Amz-Signature=abc';
const EXTERNAL = 'https://example.com/pic.jpg';

const id = (n) => `11111111-2222-3333-4444-${String(n).padStart(12, '0')}`;
const WITH_PHOTO_OLD_CACHE = id(1);
const NEVER_SEEN = id(2);
const COVER_ONLY = id(3);
const NOTHING = id(4);
const EXTERNAL_PHOTO = id(5);
const PROPERTY_PHOTO = id(6);

const tenantRecord = {
  encryptedNotionToken: encryptSecret('secret_notion_token'),
  encryptedLicenseKey: encryptSecret('license-key'),
  lastVerifiedAt: Date.now(),
  sources: [{ label: 'Activity Log', databaseId: DB }],
};

const realFetch = globalThis.fetch;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

let redis;
let blockCalls;
let blocks;   // page id -> image URL in the body (or null)

const row = (pageId, extra = {}) => ({
  object: 'page',
  id: pageId,
  created_time: '2026-09-30T08:00:00.000Z',
  last_edited_time: EDITED,
  cover: null,
  properties: {
    Name: { type: 'title', title: [{ plain_text: `entry ${pageId.slice(-1)}` }] },
    'Post-Date': { type: 'date', date: { start: '2026-09-30' } },
    ...(extra.properties || {}),
  },
  ...(extra.cover ? { cover: extra.cover } : {}),
});

let rows;

before(() => {
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
    if (/\/v1\/databases\/[^/]+\/query$/.test(target)) {
      return json({ results: rows, has_more: false, next_cursor: null });
    }
    const blockPage = target.match(/\/v1\/blocks\/([^/]+)\/children/)?.[1];
    if (blockPage) {
      blockCalls.push(blockPage);
      const imageUrl = blocks[blockPage];
      return json({ results: imageUrl ? [{ type: 'image', id: 'b1', image: { type: 'file', file: { url: imageUrl } } }] : [], has_more: false });
    }
    return json({ object: 'error', message: `unexpected ${options.method || 'GET'} ${target}` }, 404);
  };
});

after(() => { globalThis.fetch = realFetch; });

const blockEntry = ({ rawImageUrl, ageMs = 0 }) => JSON.stringify({
  lastEditedTime: EDITED,
  rawImageUrl,
  pageContent: '',
  pageContentBlockId: null,
  pageContentBlockType: null,
  imageCachedAt: Date.now() - ageMs,
});

beforeEach(() => {
  blockCalls = [];
  blocks = { [NEVER_SEEN]: SIGNED };
  redis = {
    [`tenant:${TENANT_ID}`]: JSON.stringify(tenantRecord),
    // synced hours ago: its photo link has long since lapsed
    [`notionBlocks:v3:${WITH_PHOTO_OLD_CACHE}`]: blockEntry({ rawImageUrl: SIGNED, ageMs: 5 * HOUR }),
    [`notionBlocks:v3:${COVER_ONLY}`]: blockEntry({ rawImageUrl: null, ageMs: 5 * HOUR }),
    [`notionBlocks:v3:${NOTHING}`]: blockEntry({ rawImageUrl: null, ageMs: 5 * HOUR }),
    [`notionBlocks:v3:${EXTERNAL_PHOTO}`]: blockEntry({ rawImageUrl: EXTERNAL, ageMs: 5 * HOUR }),
    [`notionBlocks:v3:${PROPERTY_PHOTO}`]: blockEntry({ rawImageUrl: null, ageMs: 5 * HOUR }),
  };
  rows = [
    row(WITH_PHOTO_OLD_CACHE),
    row(NEVER_SEEN),
    row(COVER_ONLY, { cover: { type: 'file', file: { url: SIGNED } } }),
    row(NOTHING),
    row(EXTERNAL_PHOTO),
    row(PROPERTY_PHOTO, { properties: { Photo: { type: 'files', files: [{ file: { url: SIGNED } }] } } }),
  ];
});

async function sync() {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ method: 'POST', body: { tenantId: TENANT_ID, timeZone: 'UTC' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return Object.fromEntries(res.body.data.map((log) => [log.id, log]));
}

const stable = (pageId, source) => `/api/image-thumb?t=${TENANT_ID}&p=${pageId}&s=${source}&v=${EDIT_MS}&w=640`;

test('a sync hours after the last does not read the pages of photos it already knows', async () => {
  await sync();
  // only the page it has never seen is read; the entries cached hours ago are not
  assert.deepEqual(blockCalls, [NEVER_SEEN]);
});

test('a photo is addressed by its page and edit, not by the Notion link that lapses', async () => {
  const logs = await sync();
  assert.equal(logs[WITH_PHOTO_OLD_CACHE].imageUrl, stable(WITH_PHOTO_OLD_CACHE, 'b'));
  assert.equal(logs[NEVER_SEEN].imageUrl, stable(NEVER_SEEN, 'b'));
  for (const log of Object.values(logs)) {
    assert.doesNotMatch(log.imageUrl || '', /X-Amz|amazonaws/, 'the signed link is never handed out');
  }
});

test('the picture does not change from one sync to the next, so devices can keep it', async () => {
  const first = await sync();
  const second = await sync();
  for (const pageId of [WITH_PHOTO_OLD_CACHE, NEVER_SEEN, COVER_ONLY, PROPERTY_PHOTO, EXTERNAL_PHOTO]) {
    assert.equal(second[pageId].imageUrl, first[pageId].imageUrl, pageId);
  }
});

test('editing the page gives its picture a new address', async () => {
  const before = await sync();
  const edited = '2026-10-02T09:15:00.000Z';
  rows[1] = { ...rows[1], last_edited_time: edited };
  const after = await sync();
  assert.notEqual(after[NEVER_SEEN].imageUrl, before[NEVER_SEEN].imageUrl);
  assert.match(after[NEVER_SEEN].imageUrl, new RegExp(`v=${Date.parse(edited)}`));
  assert.equal(after[WITH_PHOTO_OLD_CACHE].imageUrl, before[WITH_PHOTO_OLD_CACHE].imageUrl); // others untouched
});

test('a cover or Files & media property photo is addressed as the page itself', async () => {
  const logs = await sync();
  assert.equal(logs[COVER_ONLY].imageUrl, stable(COVER_ONLY, 'pg'));
  assert.equal(logs[PROPERTY_PHOTO].imageUrl, stable(PROPERTY_PHOTO, 'pg'));
});

test('an entry with no photo has no picture', async () => {
  const logs = await sync();
  assert.equal(logs[NOTHING].imageUrl, null);
});

test('an image hosted outside Notion is passed through as it is', async () => {
  const logs = await sync();
  assert.equal(logs[EXTERNAL_PHOTO].imageUrl, EXTERNAL);
});

test('a page it has just read is remembered, so the next sync does not read it again', async () => {
  await sync();
  assert.deepEqual(blockCalls, [NEVER_SEEN]);
  blockCalls = [];
  await sync();
  assert.deepEqual(blockCalls, []);
});
