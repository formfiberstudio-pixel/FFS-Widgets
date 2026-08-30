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

// Friends & family activations (see gumroad.js's FRIENDS_BYPASS_KEY) aren't
// tracked in any separate registry -- this just scans the existing tenant
// records and filters to the ones activated with that key specifically
// (bypassKind === 'friend'), for the admin panel's list/revoke view. The
// owner's own tenant (bypassKind === 'owner') is deliberately excluded --
// that page is for managing OTHER people's access, not your own. Fine at
// the scale this is meant for; not something you'd want against millions
// of real paying tenants.
export async function listBypassTenants() {
  const keys = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(cursor, { match: 'tenant:*', count: 100 });
    cursor = String(nextCursor);
    keys.push(...batch);
  } while (cursor !== '0');

  const records = await Promise.all(keys.map((key) => redis.get(key)));
  return keys
    .map((key, i) => ({ tenantId: key.slice('tenant:'.length), record: records[i] }))
    .filter((entry) => entry.record?.bypassKind === 'friend');
}
