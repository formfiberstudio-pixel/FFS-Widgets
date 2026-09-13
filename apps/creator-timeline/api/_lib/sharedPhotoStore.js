import { Redis } from '@upstash/redis';

// Same env vars as tenantStore.js/notionCache.js -- see notionCache.js's
// comment for why KV_REST_API_* rather than Redis.fromEnv()'s names.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// A phone's Share sheet hands photos to share-target.js, which has to
// finish the request with a redirect (there's no way to keep the browser
// tab that's about to open around as live JS state) -- so the actual
// image bytes are stashed here under a short-lived random token, and the
// page that redirect lands on (see get-shared-photos.js) fetches them by
// that token once, on load. Ten minutes is far more than the gap between
// "share completes" and "the redirected tab requests them."
const TTL_SECONDS = 10 * 60;

function keyFor(token) {
  return `sharedPhotos:${token}`;
}

export async function saveSharedPhotos(token, photos) {
  await redis.set(keyFor(token), photos, { ex: TTL_SECONDS });
}

export async function getSharedPhotos(token) {
  return redis.get(keyFor(token));
}

export async function deleteSharedPhotos(token) {
  await redis.del(keyFor(token));
}
