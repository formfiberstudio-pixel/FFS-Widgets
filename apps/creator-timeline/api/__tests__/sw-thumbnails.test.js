import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// public/sw.js keeping thumbnails on the device. The real worker script is run
// in a sandbox with a stand-in for the worker scope: a Cache Storage that
// remembers what it is given (in the order it was given, as a real one lists
// it), a network that counts what it is asked, and fetch events fed to the
// handler the script registers.
const SOURCE = fs.readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

const THUMB = (page, extra = '') => `https://widget.test/api/image-thumb?t=tenant-abc&p=${page}&s=b&v=1700000000000&w=640${extra}`;
const jpeg = () => new Response('pixels', { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });

let network;       // urls asked of the network, in order
let respond;       // what the network answers with
let stored;        // cache name -> Map(url -> Response), insertion ordered
let storageBroken;
let fetchHandler;

function load({ cap } = {}) {
  const handlers = {};
  const source = cap ? SOURCE.replace('const MAX_KEPT_THUMBNAILS = 3000;', `const MAX_KEPT_THUMBNAILS = ${cap};`) : SOURCE;
  assert.ok(!cap || source !== SOURCE, 'the cap constant was found');
  const makeCache = (name) => {
    if (!stored[name]) stored[name] = new Map();
    const entries = stored[name];
    return {
      async match(req) { const hit = entries.get(req.url); return hit ? hit.clone() : undefined; },
      async put(req, res) { entries.set(req.url, res); },
      async keys() { return [...entries.keys()].map((url) => ({ url })); },
      async delete(key) { return entries.delete(key.url); },
    };
  };
  const scope = {
    URL, Request, Response, Promise, console,
    importScripts() {},
    fetch: async (req) => { network.push(req.url); return respond(req); },
    caches: { async open(name) { if (storageBroken) throw new Error('storage blocked'); return makeCache(name); } },
  };
  scope.self = { ...scope, addEventListener(type, fn) { handlers[type] = fn; }, skipWaiting() {}, clients: { claim() {} } };
  vm.createContext(scope);
  vm.runInContext(source, scope);
  fetchHandler = handlers.fetch;
  assert.equal(typeof fetchHandler, 'function');
}

beforeEach(() => {
  network = [];
  respond = () => jpeg();
  stored = {};
  storageBroken = false;
  load();
});

// One fetch event: what the worker answered (undefined if it left the request alone) and
// whatever it had running after answering.
async function fetchEvent(url, method = 'GET') {
  const request = new Request(url, { method });
  const waiting = [];
  let answer;
  fetchHandler({
    request,
    respondWith(promise) { answer = promise; },
    waitUntil(promise) { waiting.push(promise); },
  });
  const response = answer ? await answer : undefined;
  await Promise.all(waiting);
  return response;
}

test('a thumbnail is fetched once and kept: the next time it comes from the device', async () => {
  const first = await fetchEvent(THUMB('page-1'));
  assert.equal(await first.text(), 'pixels');
  assert.equal(network.length, 1);

  const again = await fetchEvent(THUMB('page-1'));
  assert.equal(await again.text(), 'pixels');
  assert.equal(network.length, 1, 'no second request');
});

test('a thumbnail is still there with no connection', async () => {
  await fetchEvent(THUMB('page-1'));
  respond = () => { throw new TypeError('Failed to fetch'); };
  const offline = await fetchEvent(THUMB('page-1'));
  assert.equal(await offline.text(), 'pixels');
});

test('each page and edit is its own picture', async () => {
  await fetchEvent(THUMB('page-1'));
  await fetchEvent(THUMB('page-2'));
  await fetchEvent(THUMB('page-1').replace('v=1700000000000', 'v=1700000060000'));
  assert.equal(network.length, 3);
});

test('a failure is not kept', async () => {
  respond = () => new Response('down', { status: 503 });
  const failed = await fetchEvent(THUMB('page-1'));
  assert.equal(failed.status, 503);
  respond = () => jpeg();
  const retried = await fetchEvent(THUMB('page-1'));
  assert.equal(retried.status, 200);
  assert.equal(network.length, 2);
  assert.equal([...stored['thumbnails-v1'].keys()].length, 1);
});

test('the older, link-addressed thumbnails and everything else are left alone', async () => {
  assert.equal(await fetchEvent('https://widget.test/api/image-thumb?url=https%3A%2F%2Fx.amazonaws.com%2Fa.png&w=640'), undefined);
  assert.equal(await fetchEvent('https://widget.test/api/get-notion-logs'), undefined);
  assert.equal(await fetchEvent('https://widget.test/assets/main.js'), undefined);
  assert.equal(await fetchEvent(THUMB('page-1'), 'POST'), undefined);
  assert.equal(network.length, 0);
});

test('the share target is still intercepted', async () => {
  const request = new Request('https://widget.test/api/share-target', { method: 'POST' });
  let answered = false;
  fetchHandler({ request, respondWith(promise) { answered = true; promise.catch(() => {}); }, waitUntil() {} });
  assert.equal(answered, true);
});

test('when the device will not store anything, it behaves as if there were no worker', async () => {
  storageBroken = true;
  const res = await fetchEvent(THUMB('page-1'));
  assert.equal(await res.text(), 'pixels');
  assert.equal(network.length, 1);
});

test('past the cap the oldest are let go, the newest kept', async () => {
  load({ cap: 30 });
  for (let i = 1; i <= 50; i++) await fetchEvent(THUMB(`page-${i}`));
  const kept = [...stored['thumbnails-v1'].keys()];
  assert.equal(kept.length, 30);
  assert.ok(kept.includes(THUMB('page-50')));
  assert.ok(!kept.includes(THUMB('page-1')));
});
