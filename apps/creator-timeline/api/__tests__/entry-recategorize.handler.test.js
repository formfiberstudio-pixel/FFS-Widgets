import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Moving an entry to another project, through backlog-photo.js with fake HTTP
// for Upstash (the tenant record) and Notion. Env has to be set BEFORE the
// handler is imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../backlog-photo.js');

const TENANT_ID = 'tenant-abc';
const ENTRY = '11111111-2222-3333-4444-555555555555';
const SAME_PROJECT_ENTRY = '11111111-2222-3333-4444-666666666666';
const OTHER_PROJECT_ENTRY = '11111111-2222-3333-4444-777777777777';
const OTHER_DB_ENTRY = '11111111-2222-3333-4444-888888888888';
const PROJECT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const PROJECT_B = 'bbbbbbbb-1111-2222-3333-444444444444';
const LOGS_DB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DOODLES_DB = 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee';
const ELSEWHERE_DB = '12345678-1234-1234-1234-123456789012';

const tenantRecord = {
  encryptedNotionToken: encryptSecret('secret_notion_token'),
  encryptedLicenseKey: encryptSecret('license-key'),
  lastVerifiedAt: Date.now(),
  sources: [
    { label: 'Activity Log', databaseId: LOGS_DB.replace(/-/g, '') },
    { label: 'Daily Doodles', databaseId: DOODLES_DB, topicFacetKey: 'topic', typeFacetKey: 'medium' },
  ],
};

let pages;
let patches;
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
      return json({ object: 'page', id });
    }
    return json({ object: 'error', message: `unexpected ${options.method} ${target}` }, 404);
  };
});

after(() => { globalThis.fetch = realFetch; });

const logEntry = (database, projectId) => ({
  object: 'page',
  parent: { type: 'database_id', database_id: database },
  properties: {
    Name: { type: 'title', title: [{ plain_text: 'an entry' }] },
    'Post-Date': { type: 'date', date: { start: '2026-08-01' } },
    Projects: { type: 'relation', relation: projectId ? [{ id: projectId }] : [] },
    'Project Type': { type: 'rollup', rollup: { array: [] } },
  },
});
const doodle = (topic, medium) => ({
  object: 'page',
  parent: { type: 'database_id', database_id: DOODLES_DB },
  properties: {
    Name: { type: 'title', title: [] },
    topic: { type: 'select', select: topic ? { name: topic, color: 'blue' } : null },
    medium: { type: 'select', select: medium ? { name: medium, color: 'gray' } : null },
  },
});

function reset() {
  patches = [];
  pages = {
    [ENTRY]: logEntry(LOGS_DB, PROJECT_A),
    [SAME_PROJECT_ENTRY]: logEntry(LOGS_DB, PROJECT_A),
    [OTHER_PROJECT_ENTRY]: logEntry(LOGS_DB, PROJECT_B),
    [OTHER_DB_ENTRY]: logEntry(ELSEWHERE_DB, PROJECT_B),
  };
}

async function call(body) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ method: 'POST', body: { tenantId: TENANT_ID, ...body } }, res);
  return res;
}

test('an entry moves to another project: its relation is copied from an entry of that project', async () => {
  reset();
  const res = await call({ action: 'recategorizeEntry', pageId: ENTRY, referenceLogId: OTHER_PROJECT_ENTRY });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.equal(res.body.changed, true);
  assert.deepEqual(patches, [{ id: ENTRY, body: { properties: { Projects: { relation: [{ id: PROJECT_B }] } } } }]);
  // what it replaced is handed back, to undo with
  assert.deepEqual(res.body.previous, { Projects: { type: 'relation', ids: [PROJECT_A] } });
});

test('undoing a move writes the earlier project back', async () => {
  reset();
  const moved = await call({ action: 'recategorizeEntry', pageId: ENTRY, referenceLogId: OTHER_PROJECT_ENTRY });
  patches = [];
  // the entry now belongs to project B, as Notion would show it
  pages[ENTRY] = logEntry(LOGS_DB, PROJECT_B);
  const undone = await call({ action: 'recategorizeEntry', pageId: ENTRY, restore: moved.body.previous });
  assert.equal(undone.statusCode, 200, JSON.stringify(undone.body));
  assert.deepEqual(patches, [{ id: ENTRY, body: { properties: { Projects: { relation: [{ id: PROJECT_A }] } } } }]);
});

test('an entry with no project can be given one, and one can be moved to none', async () => {
  reset();
  pages[ENTRY] = logEntry(LOGS_DB, null);
  const given = await call({ action: 'recategorizeEntry', pageId: ENTRY, referenceLogId: OTHER_PROJECT_ENTRY });
  assert.deepEqual(given.body.previous, { Projects: { type: 'relation', ids: [] } });
  assert.deepEqual(patches.at(-1).body.properties, { Projects: { relation: [{ id: PROJECT_B }] } });

  // moving to the "General" entries (no project at all) clears the relation
  pages[OTHER_PROJECT_ENTRY] = logEntry(LOGS_DB, null);
  pages[ENTRY] = logEntry(LOGS_DB, PROJECT_A);
  await call({ action: 'recategorizeEntry', pageId: ENTRY, referenceLogId: OTHER_PROJECT_ENTRY });
  assert.deepEqual(patches.at(-1).body.properties, { Projects: { relation: [] } });
});

test('moving to the project it is already in changes nothing in Notion', async () => {
  reset();
  const res = await call({ action: 'recategorizeEntry', pageId: ENTRY, referenceLogId: SAME_PROJECT_ENTRY });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.changed, false);
  assert.equal(patches.length, 0);
});

test('a database that keeps topic and type on the entry gets both copied', async () => {
  reset();
  const BIRDS = '22222222-2222-3333-4444-555555555555';
  const FISH = '22222222-2222-3333-4444-666666666666';
  pages[BIRDS] = doodle('Birds', 'Ink');
  pages[FISH] = doodle('Fish', null); // a project without a type
  const res = await call({ action: 'recategorizeEntry', pageId: BIRDS, referenceLogId: FISH });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(patches, [{ id: BIRDS, body: { properties: { topic: { select: { name: 'Fish' } }, medium: { select: null } } } }]);
  assert.deepEqual(res.body.previous, { topic: { type: 'select', name: 'Birds' }, medium: { type: 'select', name: 'Ink' } });
});

test('the project has to be in the same database as the entry', async () => {
  reset();
  pages[OTHER_PROJECT_ENTRY] = { ...logEntry(DOODLES_DB, PROJECT_B) };
  const res = await call({ action: 'recategorizeEntry', pageId: ENTRY, referenceLogId: OTHER_PROJECT_ENTRY });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /different database/);
  assert.equal(patches.length, 0);
});

test('a page outside the tenant\'s databases can not be re-categorized', async () => {
  reset();
  const res = await call({ action: 'recategorizeEntry', pageId: OTHER_DB_ENTRY, referenceLogId: OTHER_PROJECT_ENTRY });
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /not an entry/i);
  assert.equal(patches.length, 0);
});

test('bad requests are refused before Notion is touched', async () => {
  reset();
  assert.equal((await call({ action: 'recategorizeEntry', referenceLogId: OTHER_PROJECT_ENTRY })).statusCode, 400);
  assert.equal((await call({ action: 'recategorizeEntry', pageId: 'nope', referenceLogId: OTHER_PROJECT_ENTRY })).statusCode, 400);
  assert.equal((await call({ action: 'recategorizeEntry', pageId: ENTRY })).statusCode, 400);
  assert.equal((await call({ action: 'recategorizeEntry', pageId: ENTRY, referenceLogId: 'nope' })).statusCode, 400);
  assert.equal((await call({ action: 'recategorizeEntry', pageId: ENTRY, restore: 'text' })).statusCode, 400);
  assert.equal(patches.length, 0);
});

test('a restore that does not fit the entry is refused, and writes nothing', async () => {
  reset();
  const wrongProperty = await call({ action: 'recategorizeEntry', pageId: ENTRY, restore: { Elsewhere: { type: 'relation', ids: [PROJECT_A] } } });
  assert.equal(wrongProperty.statusCode, 400);
  const wrongKind = await call({ action: 'recategorizeEntry', pageId: ENTRY, restore: { Projects: { type: 'select', name: 'x' } } });
  assert.equal(wrongKind.statusCode, 400);
  const badIds = await call({ action: 'recategorizeEntry', pageId: ENTRY, restore: { Projects: { type: 'relation', ids: ['../../etc'] } } });
  assert.equal(badIds.statusCode, 400);
  assert.equal(patches.length, 0);
});

test('an entry or project Notion can not read is a clear error', async () => {
  reset();
  const missingProject = await call({ action: 'recategorizeEntry', pageId: ENTRY, referenceLogId: '99999999-9999-9999-9999-999999999999' });
  assert.equal(missingProject.statusCode, 400);
  assert.match(missingProject.body.error, /Could not find page/);
  const missingEntry = await call({ action: 'recategorizeEntry', pageId: '99999999-9999-9999-9999-999999999999', referenceLogId: OTHER_PROJECT_ENTRY });
  assert.equal(missingEntry.statusCode, 400);
});
