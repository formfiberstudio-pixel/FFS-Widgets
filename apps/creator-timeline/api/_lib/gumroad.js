import crypto from 'node:crypto';

function isOwnerBypassKey(licenseKey) {
  const bypass = process.env.OWNER_BYPASS_KEY;
  if (!bypass) return false;
  // Prefix match, not exact match: the owner can hand out "<bypass
  // secret>-alice", "<bypass secret>-bob", etc. to friends/family. Each
  // distinct string still passes this check but hashes to its own
  // separate tenant (tokenCrypto.js hashes the whole license string), so
  // sharing the bypass doesn't mean everyone collides onto one tenant and
  // overwrites each other's Notion connection -- everyone just needs a
  // key that starts with the same secret.
  if (licenseKey.length < bypass.length) return false;
  const a = Buffer.from(licenseKey.slice(0, bypass.length));
  const b = Buffer.from(bypass);
  // Different-length buffers would throw in timingSafeEqual before it gets
  // a chance to be constant-time anyway, so the length check itself leaking
  // timing info here isn't a meaningful weakening.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Verifies a buyer's license key against Gumroad's own API rather than
// trusting anything the client claims -- this is the actual gate that
// decides whether a tenant's stored Notion token gets used to fetch data.
// The one exception is OWNER_BYPASS_KEY: a secret only the template's
// creator (and whoever they've shared it with) knows, so they can
// activate pages without buying a license from themselves.
export async function verifyGumroadLicense(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return { valid: false, reason: 'Missing license key' };
  }
  if (isOwnerBypassKey(licenseKey.trim())) {
    return { valid: true, purchase: { owner: true } };
  }

  const productPermalink = process.env.GUMROAD_PRODUCT_PERMALINK;
  if (!productPermalink) {
    throw new Error('GUMROAD_PRODUCT_PERMALINK is not configured');
  }

  const params = new URLSearchParams({
    product_permalink: productPermalink,
    license_key: licenseKey.trim(),
  });

  const res = await fetch('https://api.gumroad.com/v2/licenses/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data || data.success !== true) {
    return { valid: false, reason: data?.message || 'License not found' };
  }
  if (data.purchase?.refunded || data.purchase?.chargebacked) {
    return { valid: false, reason: 'License was refunded or charged back' };
  }
  if (data.purchase?.subscription_cancelled_at || data.purchase?.subscription_failed_at) {
    return { valid: false, reason: 'Subscription is no longer active' };
  }

  return { valid: true, purchase: data.purchase };
}
