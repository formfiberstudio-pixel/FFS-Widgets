import { verifyGumroadLicense } from './_lib/gumroad.js';
import { tenantIdFromLicenseKey } from './_lib/tokenCrypto.js';
import { getTenant } from './_lib/tenantStore.js';

// Lets a returning buyer see their current setup (which databases, which
// saved links) without re-entering everything blind. The Notion token
// itself is never returned here -- only whether one is already on file --
// so looking up an existing activation can't leak it back to the client.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { licenseKey } = req.body || {};
  if (!licenseKey || typeof licenseKey !== 'string' || !licenseKey.trim()) {
    return res.status(400).json({ error: 'License key is required' });
  }

  let verification;
  try {
    verification = await verifyGumroadLicense(licenseKey);
  } catch (err) {
    console.error('[tenant-lookup] License verification failed to run:', err.message);
    return res.status(500).json({ error: 'Could not verify license right now -- try again shortly.' });
  }
  if (!verification.valid) {
    return res.status(403).json({ error: `License not valid: ${verification.reason}` });
  }

  const tenantId = tenantIdFromLicenseKey(licenseKey);

  let tenant;
  try {
    tenant = await getTenant(tenantId);
  } catch (err) {
    console.error('[tenant-lookup] Failed to read tenant record:', err.message);
    return res.status(500).json({ error: 'Could not load your setup right now -- try again shortly.' });
  }

  if (!tenant) {
    return res.status(404).json({ error: 'No existing setup found for this license yet -- fill in the form below to activate.' });
  }

  return res.status(200).json({
    success: true,
    tenantId,
    sources: tenant.sources || [],
    specialDaysDatabaseId: tenant.specialDaysDatabaseId || '',
    savedViews: tenant.savedViews || [],
    hasToken: Boolean(tenant.encryptedNotionToken),
  });
}
