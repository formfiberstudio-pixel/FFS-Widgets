import { decryptSecret } from './_lib/tokenCrypto.js';
import { getTenant, saveTenant, LICENSE_REVERIFY_MS } from './_lib/tenantStore.js';
import { verifyGumroadLicense } from './_lib/gumroad.js';
import { notionFetch } from './_lib/notionFetch.js';
import { uploadImageToNotion } from './_lib/notionUpload.js';

// Needs the newer version for file_uploads (see notionUpload.js) -- used
// for every call in this file, including the plain pages.retrieve/pages.create
// ones, so the whole request is consistent about which Notion API shape
// it's talking to.
const NOTION_VERSION = '2026-03-11';

// Creates a log entry from one or more backlogged photos, in whatever
// database/property-shape the caller's existing entries already use --
// rather than requiring the frontend (or this endpoint) to know a
// tenant's database id or which property holds the project relation, it
// reads all of that off one EXISTING log page the new entry should sit
// alongside (referenceLogId): same database, same title/date property
// names, and -- critically -- the exact same relation value(s), copied
// verbatim, so the new page links to the same project without this
// endpoint ever having to resolve a project name to a page id itself.
// Any rollup that displays that project's type/category is computed by
// Notion from the relation automatically, so it never needs setting here.
//
// Photos backlogged for the same project+date belong on one page, not
// one page each -- the caller uploads the first photo of a date without
// `pageId` (create mode) and every subsequent photo for that same date
// WITH the pageId that call returned (append mode), which skips straight
// to adding another image block rather than re-deriving the database/
// properties all over again.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tenantId, referenceLogId, pageId, title, dateTaken, imageBase64 } = req.body || {};

  if (!tenantId || typeof tenantId !== 'string') return res.status(400).json({ error: 'Missing tenantId' });
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });
  if (!pageId) {
    if (!referenceLogId) return res.status(400).json({ error: 'Missing referenceLogId' });
    if (!dateTaken || isNaN(new Date(dateTaken).getTime())) return res.status(400).json({ error: 'Missing or invalid dateTaken' });
  }

  let tenant;
  try {
    tenant = await getTenant(tenantId);
  } catch (err) {
    console.error('[backlog-photo] Failed to load tenant record:', err.message);
    return res.status(500).json({ error: 'Could not load your setup right now.' });
  }
  if (!tenant) {
    return res.status(404).json({ error: 'This widget has not been set up yet.' });
  }

  // Same reasoning as get-notion-logs.js: re-check Gumroad only once the
  // cached result has gone stale, not on every single upload.
  if (Date.now() - (tenant.lastVerifiedAt || 0) > LICENSE_REVERIFY_MS) {
    try {
      const licenseKey = decryptSecret(tenant.encryptedLicenseKey);
      const verification = await verifyGumroadLicense(licenseKey);
      if (!verification.valid) {
        return res.status(403).json({ error: `Access no longer valid: ${verification.reason}` });
      }
      tenant.lastVerifiedAt = Date.now();
      await saveTenant(tenantId, tenant);
    } catch (err) {
      console.error('[backlog-photo] Re-verification failed, proceeding on last-known-good:', err.message);
    }
  }

  let notionToken;
  try {
    notionToken = decryptSecret(tenant.encryptedNotionToken);
  } catch (err) {
    console.error('[backlog-photo] Failed to decrypt stored token:', err.message);
    return res.status(500).json({ error: 'Could not load your Notion connection.' });
  }

  const headers = {
    'Authorization': `Bearer ${notionToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  try {
    const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, '').replace(/[\r\n\s]/g, '');
    const isPng = cleanBase64.startsWith('iVBORw');
    const contentType = isPng ? 'image/png' : 'image/jpeg';
    const filename = `backlog_${Date.now()}.${isPng ? 'png' : 'jpg'}`;
    const buffer = Buffer.from(cleanBase64, 'base64');

    const fileUploadId = await uploadImageToNotion(buffer, contentType, filename, notionToken, NOTION_VERSION);
    const imageBlock = { object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: fileUploadId } } };

    if (pageId) {
      const appendRes = await notionFetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ children: [imageBlock] }),
      });
      const appendData = await appendRes.json();
      if (appendData.object === 'error') return res.status(400).json({ error: appendData.message });
      return res.status(200).json({ success: true, pageId });
    }

    const refRes = await notionFetch(`https://api.notion.com/v1/pages/${referenceLogId}`, { method: 'GET', headers });
    if (!refRes.ok) {
      const errData = await refRes.json().catch(() => ({}));
      return res.status(400).json({ error: errData.message || 'Could not read the reference log entry.' });
    }
    const refPage = await refRes.json();
    const databaseId = refPage.parent?.database_id;
    if (!databaseId) {
      return res.status(400).json({ error: 'Reference log entry is not part of a database.' });
    }

    const properties = {};
    for (const [propName, propVal] of Object.entries(refPage.properties || {})) {
      if (propVal.type === 'title') {
        properties[propName] = { title: [{ text: { content: String(title || 'Backlogged Photo') } }] };
      } else if (propVal.type === 'date') {
        properties[propName] = { date: { start: new Date(dateTaken).toISOString() } };
      } else if (propVal.type === 'relation' && propVal.relation?.length > 0) {
        properties[propName] = { relation: propVal.relation.map((r) => ({ id: r.id })) };
      }
    }

    const createRes = await notionFetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        parent: { database_id: databaseId },
        properties,
        children: [imageBlock],
        cover: { type: 'file_upload', file_upload: { id: fileUploadId } },
      }),
    });
    const createData = await createRes.json();
    if (createData.object === 'error') return res.status(400).json({ error: createData.message });

    return res.status(200).json({ success: true, pageId: createData.id });
  } catch (err) {
    console.error('[backlog-photo] Failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
