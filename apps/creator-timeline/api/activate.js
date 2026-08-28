import { verifyGumroadLicense } from './_lib/gumroad.js';
import { encryptSecret, tenantIdFromLicenseKey } from './_lib/tokenCrypto.js';
import { saveTenant } from './_lib/tenantStore.js';

// Called once by a buyer on the setup page: proves they hold a valid
// license, then stores THEIR OWN Notion token and database list server-side
// under a tenant id derived from their license key. Re-running this with
// the same license key just updates that same tenant (e.g. to add a
// database or rotate their token) -- it's not a one-shot registration.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { licenseKey, notionToken, sources, specialDaysDatabaseId } = req.body || {};

  if (!licenseKey || typeof licenseKey !== 'string' || !licenseKey.trim()) {
    return res.status(400).json({ error: 'License key is required' });
  }
  if (!notionToken || typeof notionToken !== 'string' || !notionToken.trim()) {
    return res.status(400).json({ error: 'Notion integration token is required' });
  }
  const cleanSources = Array.isArray(sources)
    ? sources
        .filter(s => s && s.databaseId && s.databaseId.trim())
        .map(s => ({ label: (s.label || '').trim() || 'Activity Log', databaseId: s.databaseId.trim() }))
    : [];
  if (cleanSources.length === 0) {
    return res.status(400).json({ error: 'At least one database is required' });
  }

  let verification;
  try {
    verification = await verifyGumroadLicense(licenseKey);
  } catch (err) {
    console.error('[activate] License verification failed to run:', err.message);
    return res.status(500).json({ error: 'Could not verify license right now -- try again shortly.' });
  }

  if (!verification.valid) {
    return res.status(403).json({ error: `License not valid: ${verification.reason}` });
  }

  const tenantId = tenantIdFromLicenseKey(licenseKey);

  try {
    await saveTenant(tenantId, {
      encryptedLicenseKey: encryptSecret(licenseKey.trim()),
      encryptedNotionToken: encryptSecret(notionToken.trim()),
      sources: cleanSources,
      specialDaysDatabaseId: specialDaysDatabaseId ? specialDaysDatabaseId.trim() : '',
      lastVerifiedAt: Date.now(),
    });
  } catch (err) {
    console.error('[activate] Failed to save tenant record:', err.message);
    return res.status(500).json({ error: 'Could not save your setup right now -- try again shortly.' });
  }

  return res.status(200).json({ success: true, tenantId });
}
