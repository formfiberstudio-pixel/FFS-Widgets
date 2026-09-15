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
// changes -- caching it trades a small, self-correcting display delay
// after a rename for skipping a whole extra Notion request per distinct
// related page on every sync after the first. Originally a day; dropped
// to an hour after a renamed project stayed stale through several manual
// Sync clicks in the same sitting -- there's no way to validate this
// against the related page's own last_edited_time the way block data
// (getCachedBlockData below) does without an extra fetch that defeats
// the whole point of caching it, so this is a pure time-bound guess, and
// a day turned out to be a much longer guess than a "Sync" click reads
// as to someone who just renamed something in Notion.
const RELATION_TITLE_TTL_SECONDS = 60 * 60;

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

// v1 -> v2: forces every already-cached title to miss once (rather than
// serve out its old 24h TTL to the bitter end) the moment this shorter-TTL
// version ships, so a rename made before the fix still shows up on the
// very next sync instead of however much of a day happened to be left.
function relationTitleKey(pageId) {
  return `notionRelTitle:v2:${pageId}`;
}

// Bumped twice now: v1 -> v2 for the recursive/paginated block search
// (see get-notion-logs.js), v2 -> v3 because entries cached before the
// writable-note feature don't carry pageContentBlockId/Type at all --
// without them, editing a note back to Notion has no block to target
// until the page is edited some other way to naturally invalidate the
// old entry. Bumping forces one more full resync so every entry has them
// immediately. Orphaned older-version entries just age out on their
// existing TTL; no explicit cleanup needed.
function blockDataKey(pageId) {
  return `notionBlocks:v3:${pageId}`;
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

// Returns { rawImageUrl, pageContent, pageContentBlockId, pageContentBlockType}
// only if the page hasn't been edited since this was cached AND (there was
// no image to begin with, or the cached image's signed URL is still within
// its safety window) -- otherwise null, meaning "fetch the blocks fresh."
export async function getCachedBlockData(pageId, lastEditedTime) {
  try {
    const cached = await redis.get(blockDataKey(pageId));
    if (!cached || cached.lastEditedTime !== lastEditedTime) return null;
    if (cached.rawImageUrl && (Date.now() - cached.imageCachedAt) >= IMAGE_URL_FRESH_MS) return null;
    return {
      rawImageUrl: cached.rawImageUrl,
      pageContent: cached.pageContent,
      pageContentBlockId: cached.pageContentBlockId ?? null,
      pageContentBlockType: cached.pageContentBlockType ?? null,
    };
  } catch (err) {
    console.warn('[notionCache] block data read failed, fetching fresh:', err.message);
    return null;
  }
}

export async function setCachedBlockData(pageId, lastEditedTime, rawImageUrl, pageContent, pageContentBlockId, pageContentBlockType) {
  try {
    await redis.set(
      blockDataKey(pageId),
      { lastEditedTime, rawImageUrl, pageContent, pageContentBlockId, pageContentBlockType, imageCachedAt: Date.now() },
      { ex: BLOCK_CACHE_TTL_SECONDS }
    );
  } catch (err) {
    console.warn('[notionCache] block data write failed (non-fatal):', err.message);
  }
}
