import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Exercises backlog-photo.js's logTime action end to end with fake HTTP:
// Upstash Redis (the tenant record) and Notion (the reference page read and
// the page create) are both served by a stub fetch, so nothing real is hit.
// Env has to be set BEFORE the handler is imported, since tenantStore.js
// builds its Redis client at import time.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../backlog-photo.js');

const TENANT_ID = 'tenant-abc';
const tenantRecord = {
  encryptedNotionToken: encryptSecret('secret_notion_token'),
  encryptedLicenseKey: encryptSecret('license-key'),
  lastVerifiedAt: Date.now(), // fresh, so no Gumroad re-check is attempted
};

let referencePage;
let notionCalls;
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      // Upstash REST client: POST /pipeline with an array of commands, and
      // a stored object comes back as a JSON string under each `result`.
      const commands = JSON.parse(options.body);
      const results = commands.map(([command]) => ({
        result: String(command).toUpperCase() === 'GET' ? JSON.stringify(tenantRecord) : 'OK',
      }));
      return new Response(JSON.stringify(results), { status: 200 });
    }
    notionCalls.push({ url: target, method: options.method, body: options.body ? JSON.parse(options.body) : null, headers: options.headers });
    if (target.includes('/v1/pages/ref-log') && options.method === 'GET') {
      return new Response(JSON.stringify(referencePage), { status: 200 });
    }
    if (target.endsWith('/v1/pages') && options.method === 'POST') {
      return new Response(JSON.stringify({ object: 'page', id: 'new-session-page' }), { status: 200 });
    }
    return new Response(JSON.stringify({ object: 'error', message: `unexpected ${options.method} ${target}` }), { status: 404 });
  };
});

after(() => { globalThis.fetch = realFetch; });

function reset() {
  notionCalls = [];
  referencePage = {
    parent: { database_id: 'db-1' },
    properties: {
      Name: { type: 'title', title: [{ plain_text: 'Existing' }] },
      'Post-Date': { type: 'date', date: { start: '2026-08-01' } },
      Projects: { type: 'relation', relation: [{ id: 'proj-a' }] },
      Minutes: { type: 'number', number: null },
    },
  };
}

async function call(body) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ method: 'POST', body: { tenantId: TENANT_ID, ...body } }, res);
  return res;
}

const VALID = { action: 'logTime', referenceLogId: 'ref-log', minutes: 80, dateTaken: '2026-10-05', startLabel: '14:05', endLabel: '15:25' };

test('logTime creates a text-only page shaped from the reference entry', async () => {
  reset();
  const res = await call(VALID);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { success: true, pageId: 'new-session-page', title: '⏱ 1h 20m' });

  const create = notionCalls.find((c) => c.method === 'POST');
  assert.equal(create.body.parent.database_id, 'db-1');
  assert.deepEqual(create.body.properties.Name, { title: [{ text: { content: '⏱ 1h 20m' } }] });
  assert.deepEqual(create.body.properties['Post-Date'], { date: { start: '2026-10-05' } });
  assert.deepEqual(create.body.properties.Projects, { relation: [{ id: 'proj-a' }] });
  assert.deepEqual(create.body.properties.Minutes, { number: 80 });
  // Text-only: a paragraph body, and no cover or image block.
  assert.equal(create.body.cover, undefined);
  assert.equal(create.body.children.length, 1);
  assert.equal(create.body.children[0].type, 'paragraph');
  assert.equal(create.body.children[0].paragraph.rich_text[0].text.content, '⏱ 80 min · 14:05–15:25');
  // The Notion token was decrypted and sent.
  assert.equal(create.headers.Authorization, 'Bearer secret_notion_token');
});

test('logTime works on a database with no Minutes property', async () => {
  reset();
  delete referencePage.properties.Minutes;
  const res = await call(VALID);
  assert.equal(res.statusCode, 200);
  const create = notionCalls.find((c) => c.method === 'POST');
  assert.equal('Minutes' in create.body.properties, false);
});

test('logTime links to projectPageId when one is given', async () => {
  reset();
  await call({ ...VALID, projectPageId: 'proj-new' });
  const create = notionCalls.find((c) => c.method === 'POST');
  assert.deepEqual(create.body.properties.Projects, { relation: [{ id: 'proj-new' }] });
});

test('logTime refuses an entry that would belong to no project', async () => {
  reset();
  referencePage.properties.Projects = { type: 'relation', relation: [] };
  const res = await call(VALID);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /project link/i);
  assert.equal(notionCalls.some((c) => c.method === 'POST'), false);
});

test('logTime validates its inputs before touching Notion', async () => {
  reset();
  for (const bad of [
    { minutes: 0 },
    { minutes: 1441 },
    { minutes: '30' },
    { dateTaken: '10/05/2026' },
    { dateTaken: undefined },
    { referenceLogId: undefined },
  ]) {
    const res = await call({ ...VALID, ...bad });
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  assert.equal(notionCalls.length, 0);
});

test('logTime surfaces a Notion read failure as a 400 with the message', async () => {
  reset();
  const res = await call({ ...VALID, referenceLogId: 'missing-page' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /unexpected GET/);
});

test('logTime writes notes into the same first paragraph, under the minutes line', async () => {
  reset();
  const res = await call({ ...VALID, notes: [{ at: '14:12', text: 'outlined the intro' }, { at: '14:40', text: 'fixed the thumbnail' }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const create = notionCalls.find((c) => c.method === 'POST');
  assert.equal(create.body.children.length, 1);
  const content = create.body.children[0].paragraph.rich_text.map((t) => t.text.content).join('');
  assert.equal(content, '⏱ 80 min · 14:05–15:25\n14:12 · outlined the intro\n14:40 · fixed the thumbnail');
});

test('logTime sanitizes notes and splits a very long list across rich_text objects', async () => {
  reset();
  const notes = Array.from({ length: 50 }, (_, i) => ({ at: '10:00', text: `${i} ${'w'.repeat(900)}` }));
  const res = await call({ ...VALID, notes: [...notes, { at: '10:01', text: '   ' }] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const create = notionCalls.find((c) => c.method === 'POST');
  const richText = create.body.children[0].paragraph.rich_text;
  assert.ok(richText.length > 1);
  for (const part of richText) assert.ok(part.text.content.length <= 2000);
  const content = richText.map((t) => t.text.content).join('');
  assert.equal(content.split('\n').length, 51); // marker + 50 notes; the blank one was dropped
  assert.equal(content.split('\n')[1].length, '10:00 · '.length + 500); // each note capped at 500
});

test('logTime rejects notes that are not a list', async () => {
  reset();
  const res = await call({ ...VALID, notes: 'remember to call' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /notes/i);
  assert.equal(notionCalls.length, 0);
});

test('logTime titles the entry date_project_length when the project name is sent', async () => {
  reset();
  const res = await call({ ...VALID, projectTitle: 'Personal Blog' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.title, '2026.10.05_Personal Blog_1h 20m');
  const create = notionCalls.find((c) => c.method === 'POST');
  assert.deepEqual(create.body.properties.Name, { title: [{ text: { content: '2026.10.05_Personal Blog_1h 20m' } }] });
});

test('logTime rejects a project name that is not text', async () => {
  reset();
  const res = await call({ ...VALID, projectTitle: { name: 'x' } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /project name/i);
  assert.equal(notionCalls.length, 0);
});
