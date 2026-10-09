import sharp from 'sharp';
import { isAllowedImageHost } from './_lib/notionImageHosts.js';
import { getTenant } from './_lib/tenantStore.js';
import { decryptSecret } from './_lib/tokenCrypto.js';
import { resolveNotionImageUrl, IMAGE_SOURCE_BODY, IMAGE_SOURCE_PAGE } from './_lib/notionImages.js';

const DEFAULT_WIDTH = 640;
const MAX_WIDTH = 800;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

const PAGE_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const TENANT_ID = /^[A-Za-z0-9_-]{1,128}$/;

// A thumbnail asked for by page + edit (see _lib/notionImages.js's
// stableThumbnailUrl) never changes: the same address is the same picture
// until the page is edited, which gives it a new address. So it can be kept for
// good -- by the browser, the phone's web view (and the service worker's copy,
// public/sw.js) and the CDN -- and it is only ever made once.
const KEEP_FOR_GOOD = 'public, max-age=31536000, s-maxage=31536000, immutable';

class ThumbError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function fetchSource(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(sourceUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) throw new ThumbError(502, 'Failed to fetch source image');

  const contentLength = upstream.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_SOURCE_BYTES) throw new ThumbError(413, 'Source image too large');

  const arrayBuffer = await upstream.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_SOURCE_BYTES) throw new ThumbError(413, 'Source image too large');
  return Buffer.from(arrayBuffer);
}

async function makeThumbnail(sourceUrl, width) {
  const source = await fetchSource(sourceUrl);
  // sharp's default ~268-megapixel decompression-bomb guard was rejecting
  // real photos (large phone panoramas/high-res shots easily clear that).
  // Safe to lift here: the host allowlist restricts sources to
  // Notion's own file hosting, i.e. the widget owner's own uploaded
  // photos, not arbitrary internet input. MAX_SOURCE_BYTES above remains
  // the actual resource-exhaustion guard.
  return sharp(source, { limitInputPixels: false })
    .rotate() // reads the source's EXIF orientation and physically rotates pixels upright, since we strip metadata below and a portrait phone photo is otherwise stored as landscape pixels + an orientation tag
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer();
}

// The Notion link for a page's photo, from the tenant's own connection.
async function resolveForTenant({ t, p, s, v }) {
  const tenant = await getTenant(t);
  if (!tenant?.encryptedNotionToken) throw new ThumbError(404, 'Unknown widget');
  const headers = {
    Authorization: `Bearer ${decryptSecret(tenant.encryptedNotionToken)}`,
    'Notion-Version': '2022-06-28',
  };
  const rawUrl = await resolveNotionImageUrl({ pageId: p, source: s, editMs: Number(v) }, headers);
  if (!rawUrl) throw new ThumbError(404, 'No image on this page');
  return rawUrl;
}

export default async function handler(req, res) {
  const { url, w, t, p, s, v } = req.query;

  const requestedWidth = parseInt(w, 10);
  const width = Number.isFinite(requestedWidth) && requestedWidth > 0
    ? Math.min(requestedWidth, MAX_WIDTH)
    : DEFAULT_WIDTH;

  // By page + edit (what the sync hands out now), or -- how it used to be, and
  // what a calendar cached on a device before the change still holds -- by a
  // Notion link itself, which only lasts as long as the link does.
  const byPage = typeof p === 'string' && p !== '';
  const fail = (status, message) => {
    if (byPage) res.setHeader('Cache-Control', 'no-store'); // never keep a failure for good
    return res.status(status).json({ error: message });
  };

  let sourceUrl;
  if (byPage) {
    if (typeof t !== 'string' || !TENANT_ID.test(t) || !PAGE_ID.test(p)
      || (s !== IMAGE_SOURCE_BODY && s !== IMAGE_SOURCE_PAGE) || !/^\d{1,16}$/.test(String(v))) {
      return fail(400, 'Invalid thumbnail request');
    }
    try {
      sourceUrl = await resolveForTenant({ t, p, s, v });
    } catch (err) {
      if (err instanceof ThumbError) return fail(err.status, err.message);
      console.error('[image-thumb] Could not find the image for page:', err.message);
      return fail(502, 'Failed to look up the image');
    }
  } else {
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url parameter' });
    }
    sourceUrl = url;
  }

  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return fail(400, 'Invalid url parameter');
  }

  if (parsed.protocol !== 'https:' || !isAllowedImageHost(parsed.hostname)) {
    return fail(400, 'URL host not allowed');
  }

  try {
    const thumbnail = await makeThumbnail(parsed.toString(), width);

    res.setHeader('Content-Type', 'image/jpeg');
    // The older link-addressed form can't be kept for good: Notion's file URLs
    // are signed and expire (~1hr), so the source stops being fetchable. Cache
    // the resized result at the CDN edge (s-maxage) so it isn't re-fetched/
    // re-resized on every request within that window; a re-sync hands out
    // fresh URLs before the cache goes stale.
    res.setHeader('Cache-Control', byPage ? KEEP_FOR_GOOD : 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(thumbnail);
  } catch (err) {
    if (err instanceof ThumbError) return fail(err.status, err.message);
    console.error('[image-thumb] Failed to produce thumbnail:', err.message);
    return fail(502, 'Failed to process image');
  }
}
