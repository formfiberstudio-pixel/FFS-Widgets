import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import handler, { isGif } from '../image-thumb.js';

// The thumbnail proxy has to keep a GIF animated: everything else becomes a
// single-frame JPEG, which is what used to flatten every Notion-hosted GIF
// into a still in the calendar.
const SOURCE_URL = 'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/page/anim.gif?sig=abc';
const realFetch = globalThis.fetch;
let upstreamBody;
let upstreamType;

before(() => {
  globalThis.fetch = async () => new Response(upstreamBody, { status: 200, headers: { 'Content-Type': upstreamType } });
});
after(() => { globalThis.fetch = realFetch; });

async function animatedGif(frameCount, size = 64) {
  const colours = [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }];
  const frames = await Promise.all(
    Array.from({ length: frameCount }, (_, i) =>
      sharp({ create: { width: size, height: size, channels: 3, background: colours[i % colours.length] } }).png().toBuffer())
  );
  return sharp(frames, { join: { animated: true, across: 1 } })
    .gif({ delay: Array(frameCount).fill(100), loop: 0 })
    .toBuffer();
}

async function request(query) {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; },
    end() { return this; },
  };
  await handler({ query }, res);
  return res;
}

test('isGif recognises both GIF versions by their magic bytes', () => {
  assert.equal(isGif(Buffer.from('GIF89a......')), true);
  assert.equal(isGif(Buffer.from('GIF87a......')), true);
  assert.equal(isGif(Buffer.from('\xff\xd8\xff\xe0 jpeg bytes', 'latin1')), false);
  assert.equal(isGif(Buffer.from('GIF')), false);
});

test('an animated GIF comes back as an animated, smaller WebP', async () => {
  upstreamBody = await animatedGif(3, 200);
  upstreamType = 'image/gif';
  const res = await request({ url: SOURCE_URL, w: '100' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/webp');
  const meta = await sharp(res.body, { animated: true }).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.pages, 3); // the frames survived
  assert.equal(meta.width, 100); // and it was resized to the requested width
});

test('a still image is still turned into a JPEG thumbnail', async () => {
  upstreamBody = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#cc8844' } }).jpeg().toBuffer();
  upstreamType = 'image/jpeg';
  const res = await request({ url: 'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/page/photo.jpg', w: '100' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/jpeg');
  assert.equal((await sharp(res.body).metadata()).width, 100);
});

test('a GIF with too many frames is sent on to the original instead of re-encoded', async () => {
  upstreamBody = await animatedGif(151, 8);
  upstreamType = 'image/gif';
  const res = await request({ url: SOURCE_URL });
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, SOURCE_URL);
});

test('hosts outside the allowlist are still refused', async () => {
  const res = await request({ url: 'https://example.com/anim.gif' });
  assert.equal(res.statusCode, 400);
});
