import { getTenant, saveTenant } from './_lib/tenantStore.js';

// A saved view is just a label + a filter over already-public config (which
// databases an embed shows) -- not a secret. Deleting one only prunes a
// bookmark-like entry, it can't grant or reveal any access, so this
// intentionally doesn't require the license key: it only needs the
// tenantId, matching the same trust tier as viewing/copying a saved link
// (both already live on the unfiltered embed's own Settings panel).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tenantId, viewId } = req.body || {};
  if (!tenantId || typeof tenantId !== 'string') {
    return res.status(400).json({ error: 'Missing tenantId' });
  }
  if (!viewId || typeof viewId !== 'string') {
    return res.status(400).json({ error: 'Missing viewId' });
  }

  let tenant;
  try {
    tenant = await getTenant(tenantId);
  } catch (err) {
    console.error('[delete-saved-view] Failed to load tenant record:', err.message);
    return res.status(500).json({ error: 'Could not load your setup right now.' });
  }

  if (!tenant) {
    return res.status(404).json({ error: 'This widget has not been set up yet.' });
  }

  tenant.savedViews = (tenant.savedViews || []).filter(v => v.id !== viewId);

  try {
    await saveTenant(tenantId, tenant);
  } catch (err) {
    console.error('[delete-saved-view] Failed to save tenant record:', err.message);
    return res.status(500).json({ error: 'Could not save your changes right now.' });
  }

  return res.status(200).json({ success: true, savedViews: tenant.savedViews });
}
