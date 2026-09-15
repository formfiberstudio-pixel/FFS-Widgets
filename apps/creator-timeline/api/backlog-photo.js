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
//
// Also handles action: 'updateNote' -- writing a log entry's text note
// back to Notion (see App.jsx's day-view note editor). Folded into this
// file rather than its own route purely to stay under Vercel Hobby's
// 12-serverless-function ceiling; it shares nothing with the photo path
// except the tenant/license/token boilerplate below.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tenantId, action, referenceLogId, pageId, blockId, blockType, title, newTitle, dateTaken, text, imageBase64, newProjectTitle, projectPageId } = req.body || {};

  if (!tenantId || typeof tenantId !== 'string') return res.status(400).json({ error: 'Missing tenantId' });

  if (action === 'updateNote') {
    if (!pageId) return res.status(400).json({ error: 'Missing pageId' });
    if (typeof text !== 'string') return res.status(400).json({ error: 'Missing text' });
  } else if (action === 'updateTitle') {
    if (!pageId) return res.status(400).json({ error: 'Missing pageId' });
    if (typeof newTitle !== 'string' || !newTitle.trim()) return res.status(400).json({ error: 'Title cannot be empty' });
  } else if (action === 'createProject') {
    if (!referenceLogId) return res.status(400).json({ error: 'Missing referenceLogId' });
    if (typeof newProjectTitle !== 'string' || !newProjectTitle.trim()) return res.status(400).json({ error: 'Project name cannot be empty' });
  } else {
    if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });
    if (!pageId) {
      if (!referenceLogId) return res.status(400).json({ error: 'Missing referenceLogId' });
      if (!dateTaken || isNaN(new Date(dateTaken).getTime())) return res.status(400).json({ error: 'Missing or invalid dateTaken' });
    }
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

  if (action === 'updateNote') {
    try {
      // blockId/blockType come from the sync (see get-notion-logs.js's
      // findImageAndTextInBlocks) -- they're only null when the entry had
      // no text block at all yet, in which case this appends a fresh
      // paragraph rather than trying to PATCH a block that doesn't exist.
      if (blockId && blockType) {
        const updateRes = await notionFetch(`https://api.notion.com/v1/blocks/${blockId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ [blockType]: { rich_text: text ? [{ text: { content: text } }] : [] } }),
        });
        const updateData = await updateRes.json();
        if (updateData.object === 'error') return res.status(400).json({ error: updateData.message });
        return res.status(200).json({ success: true, blockId, blockType });
      }

      if (!text) {
        // Nothing existed and nothing was typed -- no-op rather than
        // creating an empty paragraph block for no reason.
        return res.status(200).json({ success: true, blockId: null, blockType: null });
      }

      const appendRes = await notionFetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: text } }] } }] }),
      });
      const appendData = await appendRes.json();
      if (appendData.object === 'error') return res.status(400).json({ error: appendData.message });
      const newBlockId = appendData.results?.[0]?.id || null;
      return res.status(200).json({ success: true, blockId: newBlockId, blockType: newBlockId ? 'paragraph' : null });
    } catch (err) {
      console.error('[backlog-photo] updateNote failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'updateTitle') {
    try {
      // The title PROPERTY's name varies per database ("Name", "Title",
      // whatever the tenant's own database calls it) -- has to be read off
      // the page itself rather than assumed, the same way backlog-photo's
      // create path below copies property shape from a reference page
      // instead of hardcoding one.
      const pageRes = await notionFetch(`https://api.notion.com/v1/pages/${pageId}`, { method: 'GET', headers });
      if (!pageRes.ok) {
        const errData = await pageRes.json().catch(() => ({}));
        return res.status(400).json({ error: errData.message || 'Could not read this entry.' });
      }
      const page = await pageRes.json();
      const titlePropName = Object.entries(page.properties || {}).find(([, v]) => v.type === 'title')?.[0];
      if (!titlePropName) return res.status(400).json({ error: 'This entry has no title property.' });

      const updateRes = await notionFetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties: { [titlePropName]: { title: [{ text: { content: newTitle } }] } } }),
      });
      const updateData = await updateRes.json();
      if (updateData.object === 'error') return res.status(400).json({ error: updateData.message });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[backlog-photo] updateTitle failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Creates a brand-new page in whatever database a project's relation
  // property actually points to (the same "Projects"-shaped database the
  // create-a-log-entry path above copies a relation value FROM) -- this
  // is what lets Import Photos offer projects that don't have any log
  // entries yet instead of only ever listing ones that already do.
  //
  // referenceLogId only needs to be ANY existing log entry from the same
  // Notion database as the project list being added to -- it's read
  // purely to find which of ITS properties is the relation and where
  // that relation points, never for its own relation VALUE (unlike the
  // create-a-log-entry path, which copies that value verbatim). Mirrors
  // the "always exactly one relation" assumption get-notion-logs.js's own
  // progress-tracking detection already makes for this app's supported
  // database shapes.
  if (action === 'createProject') {
    try {
      const refRes = await notionFetch(`https://api.notion.com/v1/pages/${referenceLogId}`, { method: 'GET', headers });
      if (!refRes.ok) {
        const errData = await refRes.json().catch(() => ({}));
        return res.status(400).json({ error: errData.message || 'Could not read the reference log entry.' });
      }
      const refPage = await refRes.json();
      const relationEntry = Object.entries(refPage.properties || {}).find(([, v]) => v.type === 'relation' && v.relation?.length > 0);
      if (!relationEntry) return res.status(400).json({ error: 'Could not find a project relation on this database.' });
      const [, relationVal] = relationEntry;

      const linkedRes = await notionFetch(`https://api.notion.com/v1/pages/${relationVal.relation[0].id}`, { method: 'GET', headers });
      if (!linkedRes.ok) {
        const errData = await linkedRes.json().catch(() => ({}));
        return res.status(400).json({ error: errData.message || 'Could not read an existing project.' });
      }
      const linkedPage = await linkedRes.json();
      const targetDatabaseId = linkedPage.parent?.database_id;
      if (!targetDatabaseId) return res.status(400).json({ error: 'Projects are not stored in a database.' });

      // As of the 2025-09-03 API split, a database object no longer
      // carries its own property schema -- that moved to a separate
      // "data source" underneath it (a database can technically have
      // several, though every database this app deals with only ever has
      // the one). databases.retrieve now only returns a data_sources
      // list of {id, name} references; the actual properties (including
      // which one is the title) have to be read off data_sources.retrieve
      // instead.
      const dbRes = await notionFetch(`https://api.notion.com/v1/databases/${targetDatabaseId}`, { method: 'GET', headers });
      if (!dbRes.ok) {
        const errData = await dbRes.json().catch(() => ({}));
        return res.status(400).json({ error: errData.message || 'Could not read the projects database.' });
      }
      const targetDb = await dbRes.json();
      const dataSourceId = targetDb.data_sources?.[0]?.id;
      if (!dataSourceId) return res.status(400).json({ error: 'The projects database has no data source.' });

      const dataSourceRes = await notionFetch(`https://api.notion.com/v1/data_sources/${dataSourceId}`, { method: 'GET', headers });
      if (!dataSourceRes.ok) {
        const errData = await dataSourceRes.json().catch(() => ({}));
        return res.status(400).json({ error: errData.message || 'Could not read the projects database schema.' });
      }
      const dataSource = await dataSourceRes.json();
      const targetTitlePropName = Object.entries(dataSource.properties || {}).find(([, v]) => v.type === 'title')?.[0];
      if (!targetTitlePropName) return res.status(400).json({ error: 'The projects database has no title property.' });

      const createRes = await notionFetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { database_id: targetDatabaseId },
          properties: { [targetTitlePropName]: { title: [{ text: { content: newProjectTitle.trim() } }] } },
        }),
      });
      const createData = await createRes.json();
      if (createData.object === 'error') return res.status(400).json({ error: createData.message });

      return res.status(200).json({ success: true, projectPageId: createData.id });
    } catch (err) {
      console.error('[backlog-photo] createProject failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

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
        // dateTaken is already a bare YYYY-MM-DD (straight from the review
        // screen's <input type="date">) -- send it through as-is rather
        // than round-tripping it via new Date(...).toISOString(), which
        // turns it into a UTC-midnight timestamp. get-notion-logs.js reads
        // a plain date-only property with pure string splitting and zero
        // timezone conversion specifically to avoid this class of bug;
        // handing Notion a full timestamp instead of a bare date defeats
        // that and reintroduces exactly the day-shift it was written to
        // prevent.
        properties[propName] = { date: { start: dateTaken } };
      } else if (propVal.type === 'relation' && propVal.relation?.length > 0) {
        // projectPageId overrides the reference entry's OWN relation value
        // -- set only when the frontend created this project just now (see
        // action: 'createProject' above) via a referenceLogId that
        // necessarily belongs to a DIFFERENT, pre-existing project, purely
        // to learn this database's shape. Without the override, every
        // photo would end up linked to that unrelated reference project
        // instead of the new one.
        properties[propName] = projectPageId
          ? { relation: [{ id: projectPageId }] }
          : { relation: propVal.relation.map((r) => ({ id: r.id })) };
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
