import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Import Photos creating new topics (projects) and types, end to end through
// backlog-photo.js with fake HTTP: Upstash serves the tenant record, Notion
// serves the pages / databases / data sources the handler reads and the pages
// it creates. Env has to be set BEFORE the handler is imported.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const { encryptSecret } = await import('../_lib/tokenCrypto.js');
const { default: handler } = await import('../backlog-photo.js');

const TENANT_ID = 'tenant-abc';
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';

let tenantRecord;
let notion; // what the fake Notion holds: pages, databases, data sources
let notionCalls;
const realFetch = globalThis.fetch;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status });
const notFound = (target) => json({ object: 'error', message: `unexpected ${target}` }, 404);

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith('http://fake-redis.test')) {
      const commands = JSON.parse(options.body);
      return json(commands.map(([command]) => ({ result: String(command).toUpperCase() === 'GET' ? JSON.stringify(tenantRecord) : 'OK' })));
    }
    let body = null;
    if (typeof options.body === 'string') { try { body = JSON.parse(options.body); } catch { /* not JSON */ } }
    notionCalls.push({ url: target, method: options.method, body });

    const pageMatch = target.match(/\/v1\/pages\/([^/?]+)$/);
    if (pageMatch && options.method === 'GET') return notion.pages[pageMatch[1]] ? json(notion.pages[pageMatch[1]]) : notFound(target);
    const dbMatch = target.match(/\/v1\/databases\/([^/?]+)$/);
    if (dbMatch && options.method === 'GET') return notion.databases[dbMatch[1]] ? json(notion.databases[dbMatch[1]]) : notFound(target);
    const queryMatch = target.match(/\/v1\/data_sources\/([^/?]+)\/query$/);
    if (queryMatch && options.method === 'POST') {
      const title = body?.filter?.title?.equals;
      const found = (notion.related?.[queryMatch[1]] || []).filter((p) => p.title === title);
      return json({ results: found.map((p) => ({ id: p.id })) });
    }
    const dsMatch = target.match(/\/v1\/data_sources\/([^/?]+)$/);
    if (dsMatch && options.method === 'GET') return notion.dataSources[dsMatch[1]] ? json(notion.dataSources[dsMatch[1]]) : notFound(target);
    if (target.endsWith('/v1/pages') && options.method === 'POST') return json({ object: 'page', id: `new-page-${notionCalls.filter((c) => c.url.endsWith('/v1/pages') && c.method === 'POST').length}` });
    if (target.endsWith('/v1/file_uploads') && options.method === 'POST') return json({ object: 'file_upload', id: 'upload-0001-aaaa' });
    if (target.includes('/v1/file_uploads/') && target.endsWith('/send')) return json({ object: 'file_upload', status: 'uploaded' });
    return notFound(target);
  };
});

after(() => { globalThis.fetch = realFetch; });

// A projects database whose pages have a Name and a type property of the given kind,
// logs database 'logs-db' relating to it and rolling that type up.
function relationWorld({ typeProp = { type: 'select' }, logsSchemaReadable = true } = {}) {
  notionCalls = [];
  tenantRecord = {
    encryptedNotionToken: encryptSecret('secret_notion_token'),
    encryptedLicenseKey: encryptSecret('license-key'),
    lastVerifiedAt: Date.now(),
    sources: [{ label: 'PROJECTS', databaseId: 'logs-db', topicFacetKey: '', typeFacetKey: '' }],
  };
  notion = {
    pages: {
      'ref-log': {
        parent: { database_id: 'logs-db' },
        properties: {
          Name: { type: 'title', title: [] },
          'Post-Date': { type: 'date', date: { start: '2026-08-01' } },
          'Project Name': { type: 'relation', relation: [{ id: 'proj-a' }] },
          'Project Type': { type: 'rollup', rollup: { array: [] } },
        },
      },
      'proj-a': { parent: { database_id: 'projects-db' }, properties: {} },
    },
    databases: {
      'projects-db': { data_sources: [{ id: 'ds-projects' }] },
      'logs-db': { data_sources: [{ id: 'ds-logs' }] },
      'types-db': { data_sources: [{ id: 'ds-types' }] },
    },
    dataSources: {
      'ds-projects': { properties: { Name: { type: 'title' }, Category: typeProp } },
      'ds-types': { properties: { Name: { type: 'title' } } },
    },
    related: { 'ds-types': [{ id: 'type-page-writing', title: 'Writing' }] },
  };
  if (logsSchemaReadable) {
    notion.dataSources['ds-logs'] = {
      properties: {
        Name: { type: 'title' },
        'Project Name': { type: 'relation' },
        'Project Type': { type: 'rollup', rollup: { relation_property_name: 'Project Name', rollup_property_name: 'Category' } },
      },
    };
  }
}

// A select-style source: topic and medium are selects on the entry, chosen in Settings.
function selectWorld() {
  notionCalls = [];
  tenantRecord = {
    encryptedNotionToken: encryptSecret('secret_notion_token'),
    encryptedLicenseKey: encryptSecret('license-key'),
    lastVerifiedAt: Date.now(),
    sources: [{ label: 'Daily Doodles', databaseId: 'doodles-db', topicFacetKey: 'topic', typeFacetKey: 'medium' }],
  };
  notion = {
    pages: {
      'doodle-ref': {
        parent: { database_id: 'doodles-db' },
        properties: {
          Name: { type: 'title', title: [] },
          Date: { type: 'date', date: { start: '2026-08-01' } },
          topic: { type: 'select', select: { name: 'Birds', color: 'blue' } },
          medium: { type: 'select', select: { name: 'Ink', color: 'gray' } },
        },
      },
    },
    databases: {},
    dataSources: {},
  };
}

async function call(body) {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  await handler({ method: 'POST', body: { tenantId: TENANT_ID, ...body } }, res);
  return res;
}

const createdProject = () => notionCalls.find((c) => c.url.endsWith('/v1/pages') && c.method === 'POST' && c.body.parent.database_id === 'projects-db');

// ---------------------------------------------------------------- relation + rollup sources

test('a new project with a type sets it on the project page (a select property)', async () => {
  relationWorld();
  const res = await call({ action: 'createProject', referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', newProjectTitle: 'Zine', projectType: 'Print' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.success, res.body.typeSet, res.body.warning], [true, true, null]);
  const page = createdProject();
  assert.deepEqual(page.body.properties.Name, { title: [{ text: { content: 'Zine' } }] });
  assert.deepEqual(page.body.properties.Category, { select: { name: 'Print' } });
});

test('the type can be a multi-select or text property too', async () => {
  relationWorld({ typeProp: { type: 'multi_select' } });
  await call({ action: 'createProject', referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', newProjectTitle: 'Zine', projectType: 'Print' });
  assert.deepEqual(createdProject().body.properties.Category, { multi_select: [{ name: 'Print' }] });
  relationWorld({ typeProp: { type: 'rich_text' } });
  await call({ action: 'createProject', referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', newProjectTitle: 'Zine', projectType: 'Print' });
  assert.deepEqual(createdProject().body.properties.Category, { rich_text: [{ text: { content: 'Print' } }] });
});

test('a type kept as pages in a Types database links the existing page, or makes one', async () => {
  relationWorld({ typeProp: { type: 'relation', relation: { data_source_id: 'ds-types' } } });
  await call({ action: 'createProject', referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', newProjectTitle: 'Essay', projectType: 'Writing' });
  assert.deepEqual(createdProject().body.properties.Category, { relation: [{ id: 'type-page-writing' }] });
  assert.equal(notionCalls.some((c) => c.url.endsWith('/v1/pages') && c.body?.parent?.data_source_id === 'ds-types'), false, 'an existing type page is reused, not duplicated');

  relationWorld({ typeProp: { type: 'relation', relation: { data_source_id: 'ds-types' } } });
  await call({ action: 'createProject', referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', newProjectTitle: 'Zine', projectType: 'Print' });
  const typePage = notionCalls.find((c) => c.url.endsWith('/v1/pages') && c.body?.parent?.data_source_id === 'ds-types');
  assert.deepEqual(typePage.body.properties.Name, { title: [{ text: { content: 'Print' } }] });
  assert.deepEqual(createdProject().body.properties.Category, { relation: [{ id: 'new-page-1' }] });
});

test('a type that can not be set still makes the project, and says so', async () => {
  // a status property can't gain an option through the API
  relationWorld({ typeProp: { type: 'status', status: { options: [{ name: 'Active' }] } } });
  let res = await call({ action: 'createProject', referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', newProjectTitle: 'Zine', projectType: 'Print' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual([res.body.success, res.body.typeSet], [true, false]);
  assert.match(res.body.warning, /Print/);
  assert.equal('Category' in createdProject().body.properties, false);
  // ...but an existing status option is fine
  relationWorld({ typeProp: { type: 'status', status: { options: [{ name: 'Print' }] } } });
  res = await call({ action: 'createProject', referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', newProjectTitle: 'Zine', projectType: 'Print' });
  assert.equal(res.body.typeSet, true);

  // a logs database whose schema can't be read: no way to find the type property
  relationWorld({ logsSchemaReadable: false });
  res = await call({ action: 'createProject', referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', newProjectTitle: 'Zine', projectType: 'Print' });
  assert.deepEqual([res.body.success, res.body.typeSet], [true, false]);
  assert.ok(createdProject());
});

test('a new project with no type is created as before', async () => {
  relationWorld();
  const res = await call({ action: 'createProject', referenceLogId: 'ref-log', newProjectTitle: 'Zine' });
  assert.deepEqual(res.body, { success: true, projectPageId: 'new-page-1' });
  assert.deepEqual(Object.keys(createdProject().body.properties), ['Name']);
});

// ---------------------------------------------------------------- select-style sources

test('a new topic in a select-style source needs no page: it is virtual', async () => {
  selectWorld();
  const res = await call({ action: 'createProject', referenceLogId: 'doodle-ref', sourceLabel: 'Daily Doodles', newProjectTitle: 'Cats', projectType: 'Watercolour' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { success: true, virtual: true });
  assert.equal(notionCalls.some((c) => c.method === 'POST'), false);
});

test('a photo for a select-style source is made with its topic and type written on it', async () => {
  selectWorld();
  const res = await call({ referenceLogId: 'doodle-ref', sourceLabel: 'Daily Doodles', title: 'Cats — Oct 7', dateTaken: '2026-10-07', imageBase64: PHOTO, topicName: 'Cats', typeName: 'Watercolour' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const page = notionCalls.find((c) => c.url.endsWith('/v1/pages') && c.method === 'POST');
  assert.deepEqual(page.body.properties.Name, { title: [{ text: { content: 'Cats — Oct 7' } }] });
  assert.deepEqual(page.body.properties.Date, { date: { start: '2026-10-07' } });
  assert.deepEqual(page.body.properties.topic, { select: { name: 'Cats' } });
  assert.deepEqual(page.body.properties.medium, { select: { name: 'Watercolour' } });
});

test('a topic or type with a comma is stored without it (Notion refuses commas in select names)', async () => {
  selectWorld();
  await call({ referenceLogId: 'doodle-ref', sourceLabel: 'Daily Doodles', title: 'x', dateTaken: '2026-10-07', imageBase64: PHOTO, topicName: 'Cats, kittens', typeName: ' Ink,  wash ' });
  const page = notionCalls.find((c) => c.url.endsWith('/v1/pages') && c.method === 'POST');
  assert.deepEqual(page.body.properties.topic, { select: { name: 'Cats kittens' } });
  assert.deepEqual(page.body.properties.medium, { select: { name: 'Ink wash' } });
});

test('a photo for a relation source is not given select values it does not have', async () => {
  relationWorld();
  await call({ referenceLogId: 'ref-log', sourceLabel: 'PROJECTS', title: 'x', dateTaken: '2026-10-07', imageBase64: PHOTO, topicName: 'Blog', typeName: 'Writing' });
  const page = notionCalls.find((c) => c.url.endsWith('/v1/pages') && c.method === 'POST');
  assert.deepEqual(Object.keys(page.body.properties).sort(), ['Name', 'Post-Date', 'Project Name']);
});

test('the topic, type and source must be text', async () => {
  selectWorld();
  for (const bad of [{ topicName: 5 }, { typeName: {} }, { sourceLabel: [] }]) {
    const res = await call({ referenceLogId: 'doodle-ref', title: 'x', dateTaken: '2026-10-07', imageBase64: PHOTO, ...bad });
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  for (const bad of [{ projectType: 5 }, { sourceLabel: {} }]) {
    const res = await call({ action: 'createProject', referenceLogId: 'doodle-ref', newProjectTitle: 'x', ...bad });
    assert.equal(res.statusCode, 400, JSON.stringify(bad));
  }
  assert.equal(notionCalls.length, 0);
});
