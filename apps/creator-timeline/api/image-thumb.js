import sharp from 'sharp';
import { isAllowedImageHost } from './_lib/notionImageHosts.js';

const DEFAULT_WIDTH = 640;
const MAX_WIDTH = 800;
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

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

    const thumbnail = await sharp(Buffer.from(arrayBuffer))
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
