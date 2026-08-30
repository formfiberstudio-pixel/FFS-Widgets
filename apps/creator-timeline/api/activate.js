import crypto from 'node:crypto';
import { verifyGumroadLicense } from './_lib/gumroad.js';
import { encryptSecret, tenantIdFromLicenseKey } from './_lib/tokenCrypto.js';
import { getTenant, saveTenant } from './_lib/tenantStore.js';

// Identifies which Notion integration a token belongs to, so a license can
// be bound to one Notion workspace and resist being handed to someone
// else who'd just paste their own token in. This is the integration's bot
// user id, not the workspace name (which can be renamed) or the token
// itself (which regenerating a secret for the SAME integration changes) --
// it stays stable across a legitimate secret rotation.
async function fetchNotionBotId(token) {
  const res = await fetch('https://api.notion.com/v1/users/me', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.message || 'Could not verify the Notion integration token');
  }
  const data = await res.json();
  return data.id;
}

// Called by a buyer on the setup page: proves they hold a valid license,
// then stores THEIR OWN Notion token and database list server-side under a
// tenant id derived from their license key. Re-running this with the same
// license key updates that same tenant -- it's not a one-shot registration.
// notionToken is optional on a repeat call: leaving it blank keeps whatever
// token is already on file, so reconfiguring databases or saving a new
// filtered link doesn't force re-pasting a Notion secret every time.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { licenseKey, notionToken, sources, specialDaysDatabaseId, savedViews } = req.body || {};

  if (!licenseKey || typeof licenseKey !== 'string' || !licenseKey.trim()) {
    return res.status(400).json({ error: 'License key is required' });
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

  let existingTenant = null;
  try {
    existingTenant = await getTenant(tenantId);
  } catch (err) {
    console.error('[activate] Failed to read existing tenant record (continuing as a fresh activation):', err.message);
  }

  const hasNewToken = Boolean(notionToken && typeof notionToken === 'string' && notionToken.trim());
  if (!hasNewToken && !existingTenant?.encryptedNotionToken) {
    return res.status(400).json({ error: 'Notion integration token is required' });
  }

  // One license, one Notion workspace -- keeps a license key from being
  // shared around while still letting its real owner rotate their own
  // integration secret freely. Both bypass kinds are exempt: the owner's
  // own testing, and friends/family who aren't paying customers being
  // protected against license sharing in the first place.
  const isBypassActivation = verification.purchase?.owner === true;
  let boundNotionBotId = existingTenant?.boundNotionBotId || null;
  if (hasNewToken && !isBypassActivation) {
    let newBotId;
    try {
      newBotId = await fetchNotionBotId(notionToken.trim());
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Could not verify the Notion integration token' });
    }
    if (boundNotionBotId && newBotId !== boundNotionBotId) {
      return res.status(403).json({ error: 'This license is already linked to a different Notion account. Each license can only be used with one Notion workspace -- contact support if you need to transfer it.' });
    }
    boundNotionBotId = newBotId;
  }

  const cleanSavedViews = Array.isArray(savedViews)
    ? savedViews
        .filter(v => v && typeof v.label === 'string' && v.label.trim())
        .map(v => ({
          id: v.id || crypto.randomUUID(),
          label: v.label.trim(),
          sources: Array.isArray(v.sources) && v.sources.length > 0 ? v.sources : null,
        }))
    : (existingTenant?.savedViews || []);

  try {
    await saveTenant(tenantId, {
      encryptedLicenseKey: encryptSecret(licenseKey.trim()),
      encryptedNotionToken: hasNewToken ? encryptSecret(notionToken.trim()) : existingTenant.encryptedNotionToken,
      boundNotionBotId,
      isBypassTenant: isBypassActivation,
      bypassKind: isBypassActivation ? verification.purchase.bypassKind : null,
      bypassLabel: isBypassActivation ? verification.purchase.bypassLabel : null,
      sources: cleanSources,
      specialDaysDatabaseId: specialDaysDatabaseId
        ? specialDaysDatabaseId.trim()
        : (existingTenant?.specialDaysDatabaseId || ''),
      savedViews: cleanSavedViews,
      lastVerifiedAt: Date.now(),
    });
  } catch (err) {
    console.error('[activate] Failed to save tenant record:', err.message);
    return res.status(500).json({ error: 'Could not save your setup right now -- try again shortly.' });
  }

  return res.status(200).json({ success: true, tenantId, savedViews: cleanSavedViews });
}
