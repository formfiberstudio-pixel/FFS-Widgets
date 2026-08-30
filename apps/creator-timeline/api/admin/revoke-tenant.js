import { isExactOwnerKey } from '../_lib/gumroad.js';
import { getTenant, deleteTenant } from '../_lib/tenantStore.js';

// Deletes one bypass tenant's record outright, immediately breaking their
// embed (it'll show the "hasn't been set up yet" screen next load) without
// touching anyone else's. Only ever deletes records already flagged
// isBypassTenant -- never a real paying customer's, even if their tenantId
// were somehow guessed or pasted in here.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { adminKey, tenantId } = req.body || {};
  if (!isExactOwnerKey(adminKey)) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }
  if (!tenantId || typeof tenantId !== 'string') {
    return res.status(400).json({ error: 'Missing tenantId' });
  }

  let tenant;
  try {
    tenant = await getTenant(tenantId);
  } catch (err) {
    console.error('[admin/revoke-tenant] Failed to load tenant record:', err.message);
    return res.status(500).json({ error: 'Could not load that tenant right now.' });
  }

  if (!tenant || !tenant.isBypassTenant) {
    return res.status(404).json({ error: 'No matching bypass tenant found.' });
  }

  try {
    await deleteTenant(tenantId);
  } catch (err) {
    console.error('[admin/revoke-tenant] Failed to delete tenant record:', err.message);
    return res.status(500).json({ error: 'Could not revoke that tenant right now.' });
  }

  return res.status(200).json({ success: true });
}
