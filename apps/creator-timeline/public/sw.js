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
  // of Android still resolving the shared file's content:// URI. Reading
  // a body (even a failed read) permanently "disturbs" that Request, so
  // every attempt reads from a FRESH clone of the still-untouched
  // original rather than retrying the same one, which would just throw
  // "already used" on attempt 2 and mask the real error.
  const contentLength = request.headers.get('content-length') || 'unknown';
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
  if (lastErr) return fallback(`form-parse(len=${contentLength}): ${lastErr.message}`);

  const files = formData.getAll('photos').filter((f) => f && typeof f === 'object' && f.type && f.type.startsWith('image/'));
  if (files.length === 0) return fallback('no-image-files-in-share');

  // Indexed field names (photo_0/capturedAt_0, photo_1/capturedAt_1, ...)
  // so the backend can pair each photo with its own date without
  // depending on multipart field arrival order.
  const outForm = new FormData();
  const skipReasons = [];
  let idx = 0;
  for (const file of files) {
    try {
      const [resized, capturedAt] = await Promise.all([resizeImage(file), extractCapturedAt(file)]);
      outForm.append(`photo_${idx}`, resized, file.name || 'photo.jpg');
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
