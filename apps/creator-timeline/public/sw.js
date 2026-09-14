// Registering as installable + a Share Target is what lets Android's
// Share sheet hand photos to this app instead of just bookmarking it --
// see api/manifest.js. The one thing that alone doesn't solve: Vercel's
// serverless functions reject any request body over ~4.5MB outright,
// before application code even runs -- and a modern phone photo
// routinely exceeds that on its own, let alone a multi-photo share.
// There's no way to shrink a file after Vercel has already rejected the
// request, so it has to happen HERE, before the shared photo(s) ever
// leave the device: this fetch handler intercepts the share_target POST
// navigation itself (which would otherwise send the original file
// straight over the network), downsamples each photo with
// OffscreenCanvas, reads its EXIF date before that re-encode strips it,
// and only then relays the much smaller result to the real endpoint.
importScripts('/vendor/exifr.js');

const SHARE_TARGET_PATH = '/api/share-target';
const MAX_DIMENSION = 1800;
const JPEG_QUALITY = 0.82;

// Take control as soon as possible so a share attempted soon after
// install/update is actually intercepted -- an uncontrolled first load
// would otherwise send the original, oversized photo straight through
// and hit the 4.5MB wall (share-target.js still has a best-effort
// fallback for exactly that gap, see its comments).
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'POST' || req.headers.has('X-SW-Relay')) return;
  let pathname;
  try {
    pathname = new URL(req.url).pathname;
  } catch (err) {
    return;
  }
  if (pathname === SHARE_TARGET_PATH) {
    event.respondWith(handleShareTarget(req));
  }
});

async function resizeImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let { width, height } = bitmap;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}

async function extractCapturedAt(file) {
  try {
    const exif = await self.exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'] });
    const d = exif?.DateTimeOriginal || exif?.CreateDate;
    if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString();
  } catch (err) {
    // No EXIF, or a format exifr can't read -- the review screen already
    // has a manual-date fallback for exactly this case.
  }
  return '';
}

function indexOfBytes(haystack, needle, from) {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

// A from-scratch multipart/form-data reader, used only as a fallback when
// request.formData() itself fails on this request (see handleShareTarget)
// -- reads the raw bytes directly rather than going through Chrome's own
// multipart parser, to route around whatever that parser specifically
// trips on for this request instead of just re-hitting the same failure.
async function parseMultipartManually(request) {
  const contentType = request.headers.get('content-type') || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('no boundary in content-type');
  const boundary = (boundaryMatch[1] || boundaryMatch[2]).trim();

  const bytes = new Uint8Array(await request.arrayBuffer());
  const enc = new TextEncoder();
  const boundaryMarker = enc.encode(`--${boundary}`);
  const headerEndMarker = enc.encode('\r\n\r\n');
  const decoder = new TextDecoder();

  const rawParts = [];
  let pos = indexOfBytes(bytes, boundaryMarker, 0);
  while (pos !== -1) {
    let segStart = pos + boundaryMarker.length;
    const nextPos = indexOfBytes(bytes, boundaryMarker, segStart);
    if (nextPos === -1) break;
    if (bytes[segStart] === 13 && bytes[segStart + 1] === 10) segStart += 2; // skip the part's leading \r\n
    const headerEnd = indexOfBytes(bytes, headerEndMarker, segStart);
    if (headerEnd !== -1 && headerEnd < nextPos) {
      let bodyEnd = nextPos;
      if (bytes[bodyEnd - 2] === 13 && bytes[bodyEnd - 1] === 10) bodyEnd -= 2; // trailing \r\n before next boundary
      rawParts.push({ headerText: decoder.decode(bytes.slice(segStart, headerEnd)), bodyBytes: bytes.slice(headerEnd + 4, bodyEnd) });
    }
    pos = nextPos;
  }

  return rawParts
    .map(({ headerText, bodyBytes }) => {
      const name = headerText.match(/name="([^"]*)"/i)?.[1];
      const filename = headerText.match(/filename="([^"]*)"/i)?.[1];
      if (!name || filename === undefined) return null; // only file parts have a filename
      const type = headerText.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || 'application/octet-stream';
      return { name, filename: filename || 'photo.jpg', type, blob: new Blob([bodyBytes], { type }) };
    })
    .filter(Boolean);
}

// This whole pipeline runs once, unattended, on a device this can't be
// tested against directly -- rather than swallowing every failure into
// the same silent "land on the bare calendar" outcome, each exit carries
// a specific reason back through the redirect (see App.jsx's shareError
// handling) so a real failure is diagnosable from what the user sees
// instead of from guesswork.
async function handleShareTarget(request) {
  const url = new URL(request.url);
  const tenant = url.searchParams.get('tenant') || '';
  const fallback = (reason) => {
    const target = new URL('/', url.origin);
    target.searchParams.set('tenant', tenant);
    if (reason) target.searchParams.set('shareError', String(reason).slice(0, 200));
    return Response.redirect(target.toString(), 303);
  };

  // "Failed to fetch" reading the body here (rather than anywhere else in
  // this function) points at the underlying request stream itself, not
  // at anything this code does with it -- most likely Chrome racing ahead
  // of Android still resolving the shared file's content:// URI, or a
  // limitation in Chrome's own multipart parser for this particular
  // request. Reading a body (even a failed read) permanently "disturbs"
  // that Request, so every attempt reads from a FRESH clone of the still-
  // untouched original rather than retrying the same one, which would
  // just throw "already used" on attempt 2 and mask the real error.
  const contentLength = request.headers.get('content-length') || 'unknown';
  const parseNotes = [];
  let files = null;

  let formData;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    try {
      formData = await request.clone().formData();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }

  if (!lastErr) {
    files = formData.getAll('photos')
      .filter((f) => f && typeof f === 'object' && f.type && f.type.startsWith('image/'))
      .map((f) => ({ blob: f, filename: f.name || 'photo.jpg' }));
  } else {
    parseNotes.push(`formData:${lastErr.message}`);
    // Route around Chrome's own multipart parser entirely -- reads the
    // same request's raw bytes and parses them by hand instead.
    try {
      files = (await parseMultipartManually(request.clone()))
        .filter((p) => p.name === 'photos' && p.type.startsWith('image/'))
        .map((p) => ({ blob: p.blob, filename: p.filename }));
    } catch (err) {
      parseNotes.push(`manual:${err.message}`);
    }
  }

  if (!files || files.length === 0) {
    return fallback(`form-parse(len=${contentLength}): ${parseNotes.join(' | ').slice(0, 180)}`);
  }

  // Indexed field names (photo_0/capturedAt_0, photo_1/capturedAt_1, ...)
  // so the backend can pair each photo with its own date without
  // depending on multipart field arrival order.
  const outForm = new FormData();
  const skipReasons = [];
  let idx = 0;
  for (const file of files) {
    try {
      const [resized, capturedAt] = await Promise.all([resizeImage(file.blob), extractCapturedAt(file.blob)]);
      outForm.append(`photo_${idx}`, resized, file.filename);
      outForm.append(`capturedAt_${idx}`, capturedAt);
      idx++;
    } catch (err) {
      // One unreadable/corrupt photo shouldn't sink the rest of the share.
      skipReasons.push(err.message);
    }
  }
  if (idx === 0) return fallback(`resize-failed: ${skipReasons.join('; ').slice(0, 150)}`);

  let relayRes;
  try {
    relayRes = await fetch(url.toString(), {
      method: 'POST',
      body: outForm,
      headers: { 'X-SW-Relay': '1' },
    });
  } catch (err) {
    return fallback(`relay-fetch: ${err.message}`);
  }
  if (!relayRes.ok) return fallback(`relay-status-${relayRes.status}`);

  let data;
  try {
    data = await relayRes.json();
  } catch (err) {
    return fallback(`relay-json: ${err.message}`);
  }
  if (!data?.shareToken) return fallback(`relay-no-token: ${JSON.stringify(data).slice(0, 100)}`);

  const success = new URL('/', url.origin);
  success.searchParams.set('tenant', tenant);
  success.searchParams.set('shareToken', data.shareToken);
  return Response.redirect(success.toString(), 303);
}
