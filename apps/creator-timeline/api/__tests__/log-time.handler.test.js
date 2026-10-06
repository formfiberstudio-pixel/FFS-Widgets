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
// What Upstash holds: key -> the raw string it was sent (the tenant record, the
// running timer, its photos, the saved-session claims).
let kv;
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      // Upstash REST client: POST /pipeline with an array of commands, and
      // a stored object comes back as a JSON string under each `result`.
      const commands = JSON.parse(options.body);
      const results = commands.map(([command, ...args]) => {
        const name = String(command).toUpperCase();
        if (name === 'GET') return { result: kv.has(args[0]) ? kv.get(args[0]) : null };
        if (name === 'SET') {
          const [key, value, ...flags] = args;
          if (flags.map((f) => String(f).toUpperCase()).includes('NX') && kv.has(key)) return { result: null };
          kv.set(key, String(value));
          return { result: 'OK' };
        }
        if (name === 'DEL') return { result: args.reduce((n, key) => n + (kv.delete(key) ? 1 : 0), 0) };
        return { result: 'OK' };
      });
      return new Response(JSON.stringify(results), { status: 200 });
    }
    let parsedBody = null;
    if (typeof options.body === 'string') { try { parsedBody = JSON.parse(options.body); } catch { /* not JSON */ } }
    notionCalls.push({ url: target, method: options.method, body: parsedBody, headers: options.headers, isUpload: options.body instanceof FormData });
    if (target.endsWith('/v1/file_uploads') && options.method === 'POST') {
      return new Response(JSON.stringify({ object: 'file_upload', id: `upload-${notionCalls.length}-id` }), { status: 200 });
    }
    if (target.includes('/v1/file_uploads/') && target.endsWith('/send') && options.method === 'POST') {
      return new Response(JSON.stringify({ object: 'file_upload', status: 'uploaded' }), { status: 200 });
    }
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
  kv = new Map([[`tenant:${TENANT_ID}`, JSON.stringify(tenantRecord)]]);
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

test('logTime attaches uploaded photos as the first blocks, ahead of the notes, and covers with the first', async () => {
  reset();
  const res = await call({ ...VALID, notes: [{ at: '14:12', text: 'outlined the intro' }], photoUploadIds: ['upload-aaaa-1', 'upload-bbbb-2'] });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const create = notionCalls.find((c) => c.url.endsWith('/v1/pages') && c.method === 'POST');
  assert.deepEqual(create.body.children.map((c) => c.type), ['image', 'image', 'paragraph']);
  assert.equal(create.body.children[0].image.file_upload.id, 'upload-aaaa-1');
  assert.equal(create.body.children[1].image.file_upload.id, 'upload-bbbb-2');
  assert.match(create.body.children[2].paragraph.rich_text[0].text.content, /^⏱ 80 min/);
  assert.deepEqual(create.body.cover, { type: 'file_upload', file_upload: { id: 'upload-aaaa-1' } });
});

test('logTime rejects photo ids that are not a list of upload ids', async () => {
  reset();
  for (const bad of ['upload-aaaa-1', [123], ['x'], Array.from({ length: 13 }, (_, i) => `upload-${String(i).padStart(4, '0')}`)]) {
    const res = await call({ ...VALID, photoUploadIds: bad });
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
    assert.match(res.body.error, /photos/i);
  }
  assert.equal(notionCalls.length, 0);
});

test('uploadTimerPhoto uploads one photo and hands back its file_upload id without making a page', async () => {
  reset();
  const res = await call({ action: 'uploadTimerPhoto', imageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.match(res.body.fileUploadId, /^upload-/);
  assert.equal(notionCalls.some((c) => c.url.endsWith('/v1/pages')), false);
  assert.equal(notionCalls.some((c) => c.isUpload), true);
});

test('uploadTimerPhoto needs a photo', async () => {
  reset();
  const res = await call({ action: 'uploadTimerPhoto' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /imageBase64/);
  assert.equal(notionCalls.length, 0);
});

// ---------------------------------------------------------------- the running timer, held on the server

const PROJECT = { key: 'Activity Log::Blog', title: 'Blog', source: 'Activity Log', referenceLogId: 'ref-log', projectType: 'Writing' };
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';
const timerCall = (op, fields = {}) => call({ action: 'timer', op, ...fields });
const storedTimer = () => (kv.has(`activeTimer:${TENANT_ID}`) ? JSON.parse(kv.get(`activeTimer:${TENANT_ID}`)) : null);

test('timer: start, note, pause and resume are held on the server, and a second device sees them', async () => {
  reset();
  const before = Date.now();
  const started = await timerCall('start', { project: PROJECT });
  assert.equal(started.statusCode, 200, JSON.stringify(started.body));
  assert.equal(started.body.success, true);
  assert.ok(started.body.timer.startedAt >= before && started.body.timer.startedAt <= Date.now());
  assert.ok(started.body.serverNow >= started.body.timer.startedAt);
  assert.equal(started.body.timer.project.title, 'Blog');

  // "the phone" looks, and adds a note
  const seen = await timerCall('get');
  assert.equal(seen.body.timer.startedAt, started.body.timer.startedAt);
  const noted = await timerCall('addNote', { text: 'added from the phone' });
  assert.deepEqual(noted.body.timer.notes.map((n) => n.text), ['added from the phone']);

  // "the computer" pauses, then resumes
  assert.ok((await timerCall('pause')).body.timer.pausedAt);
  const resumed = await timerCall('resume');
  assert.equal(resumed.body.timer.pausedAt, undefined);
  assert.ok(resumed.body.timer.pausedMs >= 0);
  assert.equal(storedTimer().version, 4); // start, note, pause, resume (looking changes nothing)
});

test('timer: starting while one runs hands back the running timer', async () => {
  reset();
  const first = await timerCall('start', { project: PROJECT });
  const second = await timerCall('start', { project: { ...PROJECT, key: 'x::Other', title: 'Other' } });
  assert.equal(second.body.existing, true);
  assert.equal(second.body.timer.project.title, 'Blog');
  assert.equal(second.body.timer.startedAt, first.body.timer.startedAt);
});

test('timer: asking for one that is not running answers no timer', async () => {
  reset();
  const res = await timerCall('get');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.timer, null);
  assert.equal((await timerCall('addNote', { text: 'hello' })).body.timer, null);
});

test('timer: a photo is stored, listed by id, handed to another device, and removed', async () => {
  reset();
  await timerCall('start', { project: PROJECT });
  const added = await timerCall('addPhoto', { id: 'photo-0001-aaaa', imageBase64: PHOTO });
  assert.equal(added.statusCode, 200, JSON.stringify(added.body));
  assert.deepEqual(added.body.timer.photos.map((p) => p.id), ['photo-0001-aaaa']);
  assert.equal(kv.get(`timerPhoto:${TENANT_ID}:photo-0001-aaaa`), PHOTO);
  // the timer record itself carries no picture data
  assert.equal(kv.get(`activeTimer:${TENANT_ID}`).includes('base64'), false);

  assert.equal((await timerCall('getPhoto', { id: 'photo-0001-aaaa' })).body.imageBase64, PHOTO);
  assert.equal((await timerCall('getPhoto', { id: 'photo-9999-zzzz' })).body.imageBase64, null);

  const removed = await timerCall('removePhoto', { id: 'photo-0001-aaaa' });
  assert.deepEqual(removed.body.timer.photos, []);
  assert.equal(kv.has(`timerPhoto:${TENANT_ID}:photo-0001-aaaa`), false);
});

test('timer: a photo that is too large or not an image is refused, and nothing is kept', async () => {
  reset();
  await timerCall('start', { project: PROJECT });
  for (const imageBase64 of ['not an image', 'data:text/html;base64,PGgxPg==', `data:image/jpeg;base64,${'A'.repeat(950000)}`, undefined]) {
    const res = await timerCall('addPhoto', { id: 'photo-0002-bbbb', imageBase64 });
    assert.equal(res.statusCode, 400);
  }
  assert.deepEqual(storedTimer().photos, []);
  assert.equal(kv.has(`timerPhoto:${TENANT_ID}:photo-0002-bbbb`), false);
});

test('timer: clear (discard) removes the timer and its pictures', async () => {
  reset();
  await timerCall('start', { project: PROJECT });
  await timerCall('addPhoto', { id: 'photo-0003-cccc', imageBase64: PHOTO });
  const res = await timerCall('clear');
  assert.equal(res.body.timer, null);
  assert.equal(kv.has(`activeTimer:${TENANT_ID}`), false);
  assert.equal(kv.has(`timerPhoto:${TENANT_ID}:photo-0003-cccc`), false);
});

test('timer: a bad request is a 400 with the reason, and an unknown operation is refused', async () => {
  reset();
  assert.equal((await timerCall('start', { project: { title: 'no key' } })).statusCode, 400);
  assert.match((await timerCall('explode')).body.error, /Unknown/);
  assert.equal((await call({ action: 'timer' })).statusCode, 400);
  await timerCall('start', { project: PROJECT });
  assert.equal((await timerCall('addNote', { text: '   ' })).statusCode, 400);
});

test('uploadTimerPhoto can upload a picture the timer holds, by its id', async () => {
  reset();
  await timerCall('start', { project: PROJECT });
  await timerCall('addPhoto', { id: 'photo-0004-dddd', imageBase64: PHOTO });
  notionCalls = [];
  const res = await call({ action: 'uploadTimerPhoto', timerPhotoId: 'photo-0004-dddd' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(res.body.fileUploadId, /^upload-/);
  assert.equal(notionCalls.some((c) => c.isUpload), true);

  const missing = await call({ action: 'uploadTimerPhoto', timerPhotoId: 'photo-0005-eeee' });
  assert.equal(missing.statusCode, 404);
  const invalid = await call({ action: 'uploadTimerPhoto', timerPhotoId: '../nope' });
  assert.equal(invalid.statusCode, 400);
});

test('logTime for the running session claims it, saves once, and clears the timer and its photos', async () => {
  reset();
  const { body: { timer } } = await timerCall('start', { project: PROJECT });
  await timerCall('addPhoto', { id: 'photo-0006-ffff', imageBase64: PHOTO });
  notionCalls = [];

  const res = await call({ ...VALID, sessionStartedAt: timer.startedAt });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.pageId, 'new-session-page');
  assert.equal(notionCalls.filter((c) => c.url.endsWith('/v1/pages') && c.method === 'POST').length, 1);
  assert.equal(kv.has(`activeTimer:${TENANT_ID}`), false);
  assert.equal(kv.has(`timerPhoto:${TENANT_ID}:photo-0006-ffff`), false);

  // the other device presses Stop a moment later: no second entry
  notionCalls = [];
  const again = await call({ ...VALID, sessionStartedAt: timer.startedAt });
  assert.equal(again.statusCode, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.pageId, 'new-session-page');
  assert.equal(notionCalls.length, 0);
});

test('logTime that fails lets the session be claimed again, so a retry goes through', async () => {
  reset();
  const { body: { timer } } = await timerCall('start', { project: PROJECT });
  const failed = await call({ ...VALID, referenceLogId: 'missing-page', sessionStartedAt: timer.startedAt });
  assert.equal(failed.statusCode, 400);
  assert.equal([...kv.keys()].some((k) => k.startsWith('timerSaved:')), false);
  assert.ok(storedTimer(), 'the running timer stays until a save succeeds');
  const retry = await call({ ...VALID, sessionStartedAt: timer.startedAt });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.body.pageId, 'new-session-page');
});

test('logTime for an older session leaves a newer running timer alone', async () => {
  reset();
  const { body: { timer } } = await timerCall('start', { project: PROJECT });
  const res = await call({ ...VALID, sessionStartedAt: timer.startedAt - 3600000 });
  assert.equal(res.statusCode, 200);
  assert.equal(storedTimer().startedAt, timer.startedAt);
});

test('logTime rejects a session time that is not a number', async () => {
  reset();
  const res = await call({ ...VALID, sessionStartedAt: 'yesterday' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /session/i);
});
