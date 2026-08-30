import { isExactOwnerKey } from '../_lib/gumroad.js';
import { listFamilyTenants } from '../_lib/tenantStore.js';

// Only ever returns family (bypass) tenants -- never real paying
// customers' records, never the owner's own -- and only non-sensitive
// fields (no tokens, no license keys). Gated on the bare OWNER_BYPASS_KEY,
// not a prefix match, so a family member's own suffixed key can't open
// this.
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
    entries = await listFamilyTenants();
  } catch (err) {
    console.error('[admin/list-family-tenants] Failed to list tenants:', err.message);
    return res.status(500).json({ error: 'Could not load tenants right now.' });
  }

  const tenants = entries
    .map(({ tenantId, record }) => ({
      tenantId,
      label: record.bypassLabel || 'Family',
      databaseCount: Array.isArray(record.sources) ? record.sources.length : 0,
      lastVerifiedAt: record.lastVerifiedAt || null,
    }))
    .sort((a, b) => (b.lastVerifiedAt || 0) - (a.lastVerifiedAt || 0));

  return res.status(200).json({ success: true, tenants });
}
