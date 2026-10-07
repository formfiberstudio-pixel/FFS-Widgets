import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Removing an entry (moving its Notion page to the trash) and putting it back,
// through backlog-photo.js with fake HTTP for Upstash (the tenant record) and
// Notion. Env has to be set BEFORE the handler is imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../backlog-photo.js');

const TENANT_ID = 'tenant-abc';
const ENTRY_ID = '11111111-2222-3333-4444-555555555555';
const PROJECT_PAGE_ID = '99999999-8888-7777-6666-555555555555';
const tenantRecord = {
  encryptedNotionToken: encryptSecret('secret_notion_token'),
  encryptedLicenseKey: encryptSecret('license-key'),
  lastVerifiedAt: Date.now(),
  // stored with dashes in one place, without in another: both must match
  sources: [{ label: 'Activity Log', databaseId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee' }],
};

let pages; // id -> page as Notion would return it
let patches;
let rejectInTrash; // simulate an API shape that only knows `archived`
const realFetch = globalThis.fetch;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      const commands = JSON.parse(options.body);
      return json(commands.map(([command]) => ({ result: String(command).toUpperCase() === 'GET' ? JSON.stringify(tenantRecord) : 'OK' })));
    }
    const id = target.match(/\/v1\/pages\/([^/?]+)$/)?.[1];
    if (id && options.method === 'GET') return pages[id] ? json(pages[id]) : json({ object: 'error', code: 'object_not_found', message: 'Could not find page' }, 404);
    if (id && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      patches.push({ id, body });
      if ('in_trash' in body && rejectInTrash) return json({ object: 'error', code: 'validation_error', message: 'body failed validation' }, 400);
      const trashed = body.in_trash ?? body.archived;
      pages[id] = { ...pages[id], in_trash: trashed, archived: trashed };
      return json(pages[id]);
    }
    return json({ object: 'error', message: `unexpected ${options.method} ${target}` }, 404);
  };
});

after(() => { globalThis.fetch = realFetch; });

function reset() {
  patches = [];
  rejectInTrash = false;
  pages = {
    [ENTRY_ID]: { object: 'page', id: ENTRY_ID, in_trash: false, parent: { type: 'database_id', database_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } },
    [PROJECT_PAGE_ID]: { object: 'page', id: PROJECT_PAGE_ID, in_trash: false, parent: { type: 'database_id', database_id: '12345678-1234-1234-1234-123456789012' } },
  };
}

async function call(body) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ method: 'POST', body: { tenantId: TENANT_ID, ...body } }, res);
  return res;
}

test('archiveEntry moves an entry of the tenant\'s own database to the trash', async () => {
  reset();
  const res = await call({ action: 'archiveEntry', pageId: ENTRY_ID });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { success: true });
  assert.deepEqual(patches, [{ id: ENTRY_ID, body: { in_trash: true } }]);
});

test('restoreEntry puts it back', async () => {
  reset();
  await call({ action: 'archiveEntry', pageId: ENTRY_ID });
  const res = await call({ action: 'restoreEntry', pageId: ENTRY_ID });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(patches.at(-1), { id: ENTRY_ID, body: { in_trash: false } });
});

test('a page outside the tenant\'s databases can not be removed, however it is asked for', async () => {
  reset();
  const res = await call({ action: 'archiveEntry', pageId: PROJECT_PAGE_ID });
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /not an entry/i);
  assert.equal(patches.length, 0);
  // nor can a page that has no database parent (a workspace page)
  pages[ENTRY_ID] = { object: 'page', id: ENTRY_ID, parent: { type: 'workspace', workspace: true } };
  assert.equal((await call({ action: 'archiveEntry', pageId: ENTRY_ID })).statusCode, 403);
  assert.equal(patches.length, 0);
});

test('a page Notion can not find is reported, not removed', async () => {
  reset();
  const res = await call({ action: 'archiveEntry', pageId: '00000000-0000-0000-0000-000000000000' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Could not find/);
  assert.equal(patches.length, 0);
});

test('removing what is already in the trash (or restoring what is not) changes nothing', async () => {
  reset();
  pages[ENTRY_ID].in_trash = true;
  assert.equal((await call({ action: 'archiveEntry', pageId: ENTRY_ID })).statusCode, 200);
  pages[ENTRY_ID].in_trash = false;
  assert.equal((await call({ action: 'restoreEntry', pageId: ENTRY_ID })).statusCode, 200);
  assert.equal(patches.length, 0);
});

test('an API that only knows `archived` is tried that way', async () => {
  reset();
  rejectInTrash = true;
  const res = await call({ action: 'archiveEntry', pageId: ENTRY_ID });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(patches.map((p) => p.body), [{ in_trash: true }, { archived: true }]);
});

test('the page id must look like a Notion page id', async () => {
  reset();
  for (const bad of [undefined, '', 'abc', 12345, '../../v1/users', `${ENTRY_ID}/children`]) {
    const res = await call({ action: 'archiveEntry', pageId: bad });
    assert.equal(res.statusCode, 400, String(bad));
  }
  assert.equal(patches.length, 0);
});
