import { Redis } from '@upstash/redis';

// Vercel's own "KV" product is deprecated in favor of installing a Redis
// integration (Upstash) from the Vercel Marketplace -- but the integration
// still names the provisioned env vars the old KV_REST_API_* way rather
// than UPSTASH_REDIS_REST_*, so Redis.fromEnv() (which looks for the latter)
// won't find them. Point the client at the actual names directly.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

// A day between re-checks with Gumroad balances two things: catching a
// refund/chargeback reasonably promptly, and not hammering Gumroad's API
// (or adding latency to every single calendar load) on every request.
export const LICENSE_REVERIFY_MS = 24 * 60 * 60 * 1000;

function keyFor(tenantId) {
  return `tenant:${tenantId}`;
}

export async function getTenant(tenantId) {
  return redis.get(keyFor(tenantId));
}

export async function saveTenant(tenantId, record) {
  await redis.set(keyFor(tenantId), record);
}

export async function deleteTenant(tenantId) {
  await redis.del(keyFor(tenantId));
}
