import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import sharp from 'sharp';

// Android's Share sheet used to flatten every GIF into a still JPEG on its
// way to Notion. These cover the server half of keeping them animated: a GIF
// relayed by the service worker keeps its own type, and if the store refuses
// the (larger) GIF record the share still goes through, flattened.
process.env.KV_REST_API_URL = 'http://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const { default: handler } = await import('../share-target.js');

const realFetch = globalThis.fetch;
let stored; // every record the handler tried to save: [{ ok, photos }]
let refuseGifRecords;

before(() => {
  globalThis.fetch = async (url, options = {}) => {
    const commands = JSON.parse(options.body);
    const photos = commands.flatMap((command) => command.filter((part) => typeof part === 'string' && part.startsWith('[')))
      .flatMap((json) => JSON.parse(json));
    const hasGif = photos.some((p) => p.mimeType === 'image/gif');
    const refused = refuseGifRecords && hasGif;
    stored.push({ ok: !refused, photos });
    if (refused) return new Response(JSON.stringify({ error: 'ERR max request size exceeded' }), { status: 400 });
    return new Response(JSON.stringify(commands.map(() => ({ result: 'OK' }))), { status: 200 });
  };
});
after(() => { globalThis.fetch = realFetch; });

async function animatedGif() {
  const frames = await Promise.all(
    [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }].map((background) =>
      sharp({ create: { width: 32, height: 32, channels: 3, background } }).png().toBuffer())
  );
  return sharp(frames, { join: { animated: true, across: 1 } }).gif({ delay: [100, 100], loop: 0 }).toBuffer();
}

async function relay(parts) {
  const form = new FormData();
  parts.forEach(({ name, blob, filename }) => form.append(name, blob, filename));
  const serialised = new Response(form);
  const body = Buffer.from(await serialised.arrayBuffer());
  const req = Readable.from([body]);
  req.method = 'POST';
  req.query = { tenant: 'tenant-1' };
  req.headers = { 'content-type': serialised.headers.get('content-type'), 'x-sw-relay': '1' };
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; }, writeHead() {}, end() {} };
  await handler(req, res);
  return res;
}

test('a GIF relayed by the service worker keeps its GIF type and bytes', async () => {
  stored = [];
  refuseGifRecords = false;
  const gif = await animatedGif();
  const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#cc8844' } }).jpeg().toBuffer();
  const res = await relay([
    { name: 'photo_0', blob: new Blob([gif], { type: 'image/gif' }), filename: 'loop.gif' },
    { name: 'photo_1', blob: new Blob([jpeg], { type: 'image/jpeg' }), filename: 'still.jpg' },
  ]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(stored.length, 1);
  const [savedGif, savedJpeg] = stored[0].photos;
  assert.equal(savedGif.mimeType, 'image/gif');
  assert.deepEqual(Buffer.from(savedGif.base64, 'base64'), gif); // untouched, so still animated
  assert.equal(savedJpeg.mimeType, 'image/jpeg');
});

test('if the store refuses the GIF record, the share is saved again with the GIF flattened', async () => {
  stored = [];
  refuseGifRecords = true;
  const gif = await animatedGif();
  const res = await relay([{ name: 'photo_0', blob: new Blob([gif], { type: 'image/gif' }), filename: 'loop.gif' }]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(stored.length, 2);
  assert.equal(stored[0].ok, false);
  const [retried] = stored[1].photos;
  assert.equal(retried.mimeType, 'image/jpeg');
  assert.equal((await sharp(Buffer.from(retried.base64, 'base64')).metadata()).format, 'jpeg');
});
