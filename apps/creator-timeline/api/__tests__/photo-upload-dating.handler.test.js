import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Adding a photo as a new entry (backlog-photo.js's create path) and what it says
// about the entry's date: the date the photo was taken is written to every date
// property of the database, and the answer reports whether there was one to write
// and what Notion kept -- so an import can say so when an entry could not be
// given its photo's date. Fake HTTP for Upstash and Notion; env is set BEFORE the
// handler is imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../backlog-photo.js');

const TENANT_ID = 'tenant-abc';
const REFERENCE_ID = '11111111-2222-3333-4444-555555555555';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const tenantRecord = {
  encryptedNotionToken: encryptSecret('secret_notion_token'),
  encryptedLicenseKey: encryptSecret('license-key'),
  lastVerifiedAt: Date.now(),
  sources: [{ label: 'Activity Log', databaseId: 'db-1' }],
};

let referenceProperties;
let created; // the page bodies Notion was asked to create
let keepDate; // what the fake Notion keeps of a date it is given (null: all of it as given)
const realFetch = globalThis.fetch;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      const commands = JSON.parse(options.body);
      return json(commands.map(([command]) => ({ result: String(command).toUpperCase() === 'GET' ? JSON.stringify(tenantRecord) : 'OK' })));
    }
    if (target.endsWith('/v1/file_uploads') && options.method === 'POST') return json({ object: 'file_upload', id: 'upload-1' });
    if (target.includes('/v1/file_uploads/') && target.endsWith('/send')) return json({ object: 'file_upload', status: 'uploaded' });
    if (target.includes(`/v1/pages/${REFERENCE_ID}`) && options.method === 'GET') return json({ object: 'page', parent: { database_id: 'db-1' }, properties: referenceProperties });
    if (target.endsWith('/v1/pages') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      created.push(body);
      // Notion answers with the properties as it kept them.
      const properties = Object.fromEntries(Object.entries(body.properties).map(([name, value]) => (
        value.date ? [name, { type: 'date', date: { start: keepDate ?? value.date.start } }] : [name, value]
      )));
      return json({ object: 'page', id: 'new-page', properties });
    }
    return json({ object: 'error', message: `unexpected ${options.method} ${target}` }, 404);
  };
});

after(() => { globalThis.fetch = realFetch; });

function reset() {
  created = [];
  keepDate = null;
  referenceProperties = {
    Name: { type: 'title', title: [{ plain_text: 'Existing' }] },
    'Post-Date': { type: 'date', date: { start: '2026-08-01' } },
    Projects: { type: 'relation', relation: [{ id: 'aaaaaaaa-1111-2222-3333-444444444444' }] },
  };
}

async function upload(extra = {}) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ method: 'POST', body: { tenantId: TENANT_ID, referenceLogId: REFERENCE_ID, title: 'Coin Wallet — Mar 29, 2026', dateTaken: '2026-03-29', imageBase64: PNG, ...extra } }, res);
  return res;
}

test('the photo\'s date is written to the date property, and the answer says what stuck', async () => {
  reset();
  const res = await upload();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(created[0].properties['Post-Date'], { date: { start: '2026-03-29' } });
  assert.equal(res.body.dated, true);
  assert.equal(res.body.storedDate, '2026-03-29');
});

test('every date property of the database gets the date', async () => {
  reset();
  referenceProperties['Reviewed'] = { type: 'date', date: null };
  const res = await upload({ dateTaken: '2026-01-05' });
  assert.deepEqual(created[0].properties['Post-Date'], { date: { start: '2026-01-05' } });
  assert.deepEqual(created[0].properties.Reviewed, { date: { start: '2026-01-05' } });
  assert.equal(res.body.dated, true);
});

test('a database with no date property is reported, rather than quietly dated today', async () => {
  reset();
  delete referenceProperties['Post-Date'];
  const res = await upload();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.dated, false);
  assert.equal(res.body.storedDate, null);
  assert.equal(Object.values(created[0].properties).some((value) => value.date), false);
});

test('a different date than the one asked for is visible in the answer', async () => {
  reset();
  keepDate = '2026-10-08';
  const res = await upload();
  assert.equal(res.body.dated, true);
  assert.equal(res.body.storedDate, '2026-10-08');
});

test('the project and title still come from the reference entry and the request', async () => {
  reset();
  await upload();
  assert.deepEqual(created[0].properties.Projects, { relation: [{ id: 'aaaaaaaa-1111-2222-3333-444444444444' }] });
  assert.deepEqual(created[0].properties.Name, { title: [{ text: { content: 'Coin Wallet — Mar 29, 2026' } }] });
});

test('a date that is not a date is refused before anything is made', async () => {
  reset();
  const res = await upload({ dateTaken: 'soon' });
  assert.equal(res.statusCode, 400);
  assert.equal(created.length, 0);
});
