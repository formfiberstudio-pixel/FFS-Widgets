import crypto from 'node:crypto';

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Different-length buffers would throw in timingSafeEqual before it gets
  // a chance to be constant-time anyway, so the length check itself leaking
  // timing info here isn't a meaningful weakening.
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Prefix match, not exact match: whoever holds FAMILY_BYPASS_KEY can hand
// out "<secret>-alice", "<secret>-bob", etc. Each distinct string still
// passes this check but hashes to its own separate tenant (tokenCrypto.js
// hashes the whole license string), so sharing it doesn't mean everyone
// collides onto one tenant and overwrites each other's Notion connection.
function matchesFamilyBypass(licenseKey) {
  const secret = process.env.FAMILY_BYPASS_KEY;
  if (!secret || licenseKey.length < secret.length) return false;
  return constantTimeEquals(licenseKey.slice(0, secret.length), secret);
}

// Exact match only -- the owner's own key is for their own single tenant,
// not something meant to be shared out with per-person suffixes (that's
// what FAMILY_BYPASS_KEY is for). Also used to gate the admin panel, so a
// family member's own key must NOT satisfy this.
export function isExactOwnerKey(key) {
  const bypass = process.env.OWNER_BYPASS_KEY;
  if (!bypass || !key || typeof key !== 'string') return false;
  return constantTimeEquals(key, bypass);
}

// Verifies a buyer's license key against Gumroad's own API rather than
// trusting anything the client claims -- this is the actual gate that
// decides whether a tenant's stored Notion token gets used to fetch data.
// Two exceptions, both secrets only the template's creator knows:
//   - OWNER_BYPASS_KEY: the creator's own personal/freelance pages,
//     without buying a license from themselves.
//   - FAMILY_BYPASS_KEY: handed out (with a per-person suffix) to family
//     so they can use the template for free, each getting their own
//     independent tenant.
export async function verifyGumroadLicense(licenseKey) {
  if (!licenseKey || typeof licenseKey !== 'string') {
    return { valid: false, reason: 'Missing license key' };
  }
  const trimmedKey = licenseKey.trim();

  if (isExactOwnerKey(trimmedKey)) {
    return { valid: true, purchase: { owner: true, bypassKind: 'owner', bypassLabel: 'Owner' } };
  }

  if (matchesFamilyBypass(trimmedKey)) {
    const secret = process.env.FAMILY_BYPASS_KEY;
    const suffix = trimmedKey.slice(secret.length).replace(/^[-_]+/, '').trim();
    return { valid: true, purchase: { owner: true, bypassKind: 'family', bypassLabel: suffix || 'Family' } };
  }

  const productPermalink = process.env.GUMROAD_PRODUCT_PERMALINK;
  if (!productPermalink) {
    throw new Error('GUMROAD_PRODUCT_PERMALINK is not configured');
  }

  const params = new URLSearchParams({
    product_permalink: productPermalink,
    license_key: trimmedKey,
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
