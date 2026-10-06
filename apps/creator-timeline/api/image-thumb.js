import sharp from 'sharp';
import { isAllowedImageHost } from './_lib/notionImageHosts.js';

const DEFAULT_WIDTH = 640;
const MAX_WIDTH = 800;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
// Vercel caps a serverless function's response body at 4.5MB; stay under it.
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
// An animated GIF is decoded frame by frame and re-encoded, which costs time
// in proportion to its length -- past this, hand the original over instead.
const MAX_ANIMATED_FRAMES = 150;

// GIF87a / GIF89a both start with "GIF8".
export const isGif = (buffer) => buffer.length > 6 && buffer.toString('latin1', 0, 4) === 'GIF8';

// A GIF's thumbnail has to stay animated, so it is resized frame by frame
// into an animated WebP (far smaller than the GIF, and every current browser
// and Android WebView plays it) instead of the single-frame JPEG everything
// else becomes. Returns null when that isn't practical (too many frames, a
// result over the response cap, or an encode failure) so the caller can send
// the browser to the original GIF instead.
export async function animatedThumbnail(source, width) {
  try {
    const options = { animated: true, limitInputPixels: false };
    const { pages = 1 } = await sharp(source, options).metadata();
    if (pages > MAX_ANIMATED_FRAMES) return null;
    const out = await sharp(source, options)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 70, effort: 3 })
      .toBuffer();
    return out.byteLength <= MAX_RESPONSE_BYTES ? out : null;
  } catch (err) {
    console.error('[image-thumb] Could not make an animated thumbnail:', err.message);
    return null;
  }
}

export default async function handler(req, res) {
  const { url, w } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid url parameter' });
  }

  if (parsed.protocol !== 'https:' || !isAllowedImageHost(parsed.hostname)) {
    return res.status(400).json({ error: 'URL host not allowed' });
  }

  const requestedWidth = parseInt(w, 10);
  const width = Number.isFinite(requestedWidth) && requestedWidth > 0
    ? Math.min(requestedWidth, MAX_WIDTH)
    : DEFAULT_WIDTH;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(parsed.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      return res.status(502).json({ error: 'Failed to fetch source image' });
    }

    const contentLength = upstream.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_SOURCE_BYTES) {
      return res.status(413).json({ error: 'Source image too large' });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_SOURCE_BYTES) {
      return res.status(413).json({ error: 'Source image too large' });
    }

    // sharp's default ~268-megapixel decompression-bomb guard was rejecting
    // real photos (large phone panoramas/high-res shots easily clear that).
    // Safe to lift here: the host allowlist above restricts sources to
    // Notion's own file hosting, i.e. the widget owner's own uploaded
    // photos, not arbitrary internet input. MAX_SOURCE_BYTES above remains
    // the actual resource-exhaustion guard.
    const source = Buffer.from(arrayBuffer);

    if (isGif(source)) {
      const animated = await animatedThumbnail(source, width);
      if (animated) {
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
        return res.status(200).send(animated);
      }
      // Too long or too heavy to re-encode in a request: let the browser
      // load the original (still animated) from Notion itself. The URL is
      // signed and expires, so the redirect is only cached briefly.
      res.setHeader('Location', parsed.toString());
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(302).end();
    }

    const thumbnail = await sharp(source, { limitInputPixels: false })
      .rotate() // reads the source's EXIF orientation and physically rotates pixels upright, since we strip metadata below and a portrait phone photo is otherwise stored as landscape pixels + an orientation tag
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();

    // Notion's file URLs are signed and expire (~1hr), so we can't rely on
    // the source staying fetchable forever -- cache the resized result at
    // the CDN edge (s-maxage) so we don't need to re-fetch/re-resize it on
    // every request within that window. Re-syncing the widget naturally
    // hands out fresh URLs before the cache goes stale.
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).send(thumbnail);
  } catch (err) {
    console.error('[image-thumb] Failed to produce thumbnail:', err.message);
    return res.status(502).json({ error: 'Failed to process image' });
  }
}
