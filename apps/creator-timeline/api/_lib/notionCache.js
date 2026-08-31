import { Redis } from '@upstash/redis';

// Same env vars as tenantStore.js -- see that file's comment for why
// KV_REST_API_* rather than Redis.fromEnv()'s UPSTASH_REDIS_REST_* names.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// Every read/write here is wrapped in try/catch and treated as "just do a
// fresh fetch instead" on failure -- this cache is a volume-reduction
// optimization, never something a sync should actually depend on to
// succeed. Missing/misconfigured Redis env vars (e.g. local dev) degrade
// to "cache never hits," not a crash.

// A related page's title (used for a log's Projects/topic field) rarely
// changes -- caching it for a day trades a small, self-correcting display
// delay after a rename for skipping a whole extra Notion request per
// distinct related page on every sync after the first.
const RELATION_TITLE_TTL_SECONDS = 24 * 60 * 60;

// Block-derived data (the day's photo + preview text) is cached per page,
// keyed by that exact page's last_edited_time -- already present on every
// row from the database query, at no extra cost. Any edit at all (a new
// caption, a swapped photo) changes last_edited_time and invalidates the
// entry automatically, so there's no risk of ever serving stale content
// for a page that's actually changed. The TTL below is storage hygiene
// only (bounding how long an untouched tenant's cache lingers in Redis),
// not a staleness mechanism.
const BLOCK_CACHE_TTL_SECONDS = 90 * 24 * 60 * 60;

// Notion's own file URLs are signed and expire in roughly an hour (see
// image-thumb.js) -- reusing a cached one after that would hand the viewer
// a broken image. Bounding reuse to well under that window means a cached
// entry is only ever used while its image URL is provably still good,
// regardless of how long the page's content itself has stayed cached.
const IMAGE_URL_FRESH_MS = 45 * 60 * 1000;

function relationTitleKey(pageId) {
  return `notionRelTitle:${pageId}`;
}

function blockDataKey(pageId) {
  return `notionBlocks:${pageId}`;
}

export async function getCachedRelationTitle(pageId) {
  try {
    return await redis.get(relationTitleKey(pageId));
  } catch (err) {
    console.warn('[notionCache] relation title read failed, fetching fresh:', err.message);
    return null;
  }
}

export async function setCachedRelationTitle(pageId, title) {
  try {
    await redis.set(relationTitleKey(pageId), title, { ex: RELATION_TITLE_TTL_SECONDS });
  } catch (err) {
    console.warn('[notionCache] relation title write failed (non-fatal):', err.message);
  }
}

// Returns { rawImageUrl, pageContent } only if the page hasn't been edited
// since this was cached AND (there was no image to begin with, or the
// cached image's signed URL is still within its safety window) --
// otherwise null, meaning "fetch the blocks fresh."
export async function getCachedBlockData(pageId, lastEditedTime) {
  try {
    const cached = await redis.get(blockDataKey(pageId));
    if (!cached || cached.lastEditedTime !== lastEditedTime) return null;
    if (cached.rawImageUrl && (Date.now() - cached.imageCachedAt) >= IMAGE_URL_FRESH_MS) return null;
    return { rawImageUrl: cached.rawImageUrl, pageContent: cached.pageContent };
  } catch (err) {
    console.warn('[notionCache] block data read failed, fetching fresh:', err.message);
    return null;
  }
}

export async function setCachedBlockData(pageId, lastEditedTime, rawImageUrl, pageContent) {
  try {
    await redis.set(
      blockDataKey(pageId),
      { lastEditedTime, rawImageUrl, pageContent, imageCachedAt: Date.now() },
      { ex: BLOCK_CACHE_TTL_SECONDS }
    );
  } catch (err) {
    console.warn('[notionCache] block data write failed (non-fatal):', err.message);
  }
}
