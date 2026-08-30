import { isExactOwnerKey } from '../_lib/gumroad.js';
import { listBypassTenants } from '../_lib/tenantStore.js';

// Only ever returns friends & family (bypass) tenants -- never real paying
// customers' records -- and only non-sensitive fields (no tokens, no
// license keys). Gated on the bare OWNER_BYPASS_KEY, not a prefix match,
// so a friend's own suffixed key can't open this.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { adminKey } = req.body || {};
  if (!isExactOwnerKey(adminKey)) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  let entries;
  try {
    entries = await listBypassTenants();
  } catch (err) {
    console.error('[admin/list-bypass-tenants] Failed to list tenants:', err.message);
    return res.status(500).json({ error: 'Could not load tenants right now.' });
  }

  const tenants = entries
    .map(({ tenantId, record }) => ({
      tenantId,
      label: record.bypassLabel || 'Friend',
      databaseCount: Array.isArray(record.sources) ? record.sources.length : 0,
      lastVerifiedAt: record.lastVerifiedAt || null,
    }))
    .sort((a, b) => (b.lastVerifiedAt || 0) - (a.lastVerifiedAt || 0));

  return res.status(200).json({ success: true, tenants });
}
