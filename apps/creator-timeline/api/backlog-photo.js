import { decryptSecret } from './_lib/tokenCrypto.js';
import { getTenant, saveTenant, LICENSE_REVERIFY_MS } from './_lib/tenantStore.js';
import { verifyGumroadLicense } from './_lib/gumroad.js';
import { notionFetch } from './_lib/notionFetch.js';
import { uploadImageToNotion } from './_lib/notionUpload.js';
import { applyTimerOp, TimerOpError, validTimerPhotoDataUrl, validTimerPhotoId } from './_lib/timerState.js';
import {
  claimSavedSession,
  deleteActiveTimer,
  deleteTimerPhotoData,
  getActiveTimer,
  getSavedSessionPageId,
  getTimerPhotoData,
  markSavedSession,
  putTimerPhotoData,
  releaseSavedSession,
  saveActiveTimer,
} from './_lib/timerStore.js';
import { findProjectTypePropName, projectTypeValue, resolveSourceTaxonomy, taxonomyProperties, valueForProperty } from './_lib/entryTaxonomy.js';
import { assignmentFrom, currentValues, patchFromAssignment, ProjectChangeError, sameValues } from './_lib/entryProject.js';
import { sanitizeProjectOrder } from './_lib/projectOrder.js';
import { sanitizeThumbnailFocus } from './_lib/thumbnailFocus.js';
import { buildSessionChildren, buildSessionNote, buildSessionProperties, buildSessionTitle, sanitizeSessionNotes, validPhotoUploadIds } from './_lib/timeTracking.js';

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
//
// And action: 'logTime' -- saving a stopped project-timer session as a
// log page (title "2026.10.05_Project_1h 20m", a "⏱ 80 min" body line, and a
// minutes Number property when the database has one), shaped from the
// same kind of reference page the photo path uses. Photos taken during the
// session are first uploaded one request each (action: 'uploadTimerPhoto',
// which returns a file_upload id), then attached by logTime as the page's
// first blocks and its cover, ahead of the notes. See _lib/timeTracking.js.
//
// And action: 'archiveEntry' / 'restoreEntry' -- removing an entry from the
// calendar by moving its Notion page to the trash (where Notion keeps it for
// about 30 days, so it can be put back), and putting it back. Only a page that
// lives in one of the tenant's own configured databases can be touched.
//
// And action: 'setProjectOrder' -- the person's own order for the project list
// (`order`: name lists, see src/projectOrder.js), saved on the tenant record so
// every device shows the same one; get-notion-logs.js returns it with each sync.
//
// And action: 'setThumbnailFocus' -- which part of each photo shows when it is
// cropped (`focus`: { entry id: { x, y } } in percent), saved on the tenant
// record so every device crops the same way; returned with each sync.
//
// And action: 'recategorizeEntry' -- moving an entry to another project (of the
// same database): `pageId` is the entry, `referenceLogId` any entry of the
// project it goes to (its project, and type where the entry carries one, are
// copied -- see _lib/entryProject.js). The answer includes `previous`, what was
// replaced; sending that back as `restore` (instead of a referenceLogId) undoes it.
//
// And action: 'timer' -- the RUNNING timer, held here (in Redis) rather than
// in one browser so every device sees it and can add notes and photos to it:
// get / start / adopt / pause / resume / addNote / editNote / removeNote / addPhoto /
// getPhoto / removePhoto / clear (see _lib/timerState.js). Stopping saves it
// with logTime, which also claims the session so two devices stopping at the
// same moment make one entry, and clears the timer.
// Decodes a base64 photo (a data URL or bare base64), works out its type from
// its own bytes, and uploads it to Notion; resolves to the file_upload id.
async function uploadBase64Photo(imageBase64, notionToken) {
  const cleanBase64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, '').replace(/[\r\n\s]/g, '');
  const isPng = cleanBase64.startsWith('iVBORw');
  // GIF87a/GIF89a's shared "GIF8" magic bytes base64-encode to this
  // exact prefix -- resizeImageForUpload (imageResize.js) passes a GIF
  // through untouched rather than flattening it to a static JPEG, so
  // this is what lets that original file keep its own content type
  // (and therefore its animation) all the way to Notion instead of
  // silently falling into the jpeg default below.
  const isGif = cleanBase64.startsWith('R0lGOD');
  const contentType = isGif ? 'image/gif' : isPng ? 'image/png' : 'image/jpeg';
  const filename = `backlog_${Date.now()}.${isGif ? 'gif' : isPng ? 'png' : 'jpg'}`;
  const buffer = Buffer.from(cleanBase64, 'base64');
  return uploadImageToNotion(buffer, contentType, filename, notionToken, NOTION_VERSION);
}

// The tenant's configured source (database) with this label -- its topic /
// type overrides say how its entries carry them (see _lib/entryTaxonomy.js).
const findSource = (tenant, label) =>
  (tenant.sources || []).find((source) => (source.label || 'Activity Log') === (label || 'Activity Log')) || null;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tenantId, action, referenceLogId, pageId, blockId, blockType, title, newTitle, dateTaken, text, imageBase64, newProjectTitle, projectPageId, minutes, startLabel, endLabel, notes, projectTitle, photoUploadIds, op, timerPhotoId, sessionStartedAt, sourceLabel, topicName, typeName, projectType, restore, order, focus } = req.body || {};

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
    if (projectType !== undefined && typeof projectType !== 'string') return res.status(400).json({ error: 'Invalid type' });
    if (sourceLabel !== undefined && typeof sourceLabel !== 'string') return res.status(400).json({ error: 'Invalid source' });
  } else if (action === 'logTime') {
    if (!referenceLogId) return res.status(400).json({ error: 'Missing referenceLogId' });
    // 24h cap: a timer left running overnight shouldn't silently log days.
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return res.status(400).json({ error: 'Time must be between 1 minute and 24 hours' });
    if (typeof dateTaken !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateTaken)) return res.status(400).json({ error: 'Missing or invalid date' });
    if (notes !== undefined && !Array.isArray(notes)) return res.status(400).json({ error: 'Invalid notes' });
    if (projectTitle !== undefined && typeof projectTitle !== 'string') return res.status(400).json({ error: 'Invalid project name' });
    if (photoUploadIds !== undefined && !validPhotoUploadIds(photoUploadIds)) return res.status(400).json({ error: 'Invalid photos' });
    if (sessionStartedAt !== undefined && !Number.isFinite(sessionStartedAt)) return res.status(400).json({ error: 'Invalid session' });
  } else if (action === 'uploadTimerPhoto') {
    // The picture comes either in the request, or -- for a photo the running
    // timer already holds -- by its id, which spares sending it twice.
    if (timerPhotoId !== undefined && !validTimerPhotoId(timerPhotoId)) return res.status(400).json({ error: 'Invalid photo' });
    if (timerPhotoId === undefined && (typeof imageBase64 !== 'string' || !imageBase64)) return res.status(400).json({ error: 'Missing imageBase64' });
  } else if (action === 'timer') {
    if (typeof op !== 'string') return res.status(400).json({ error: 'Missing operation' });
  } else if (action === 'archiveEntry' || action === 'restoreEntry') {
    // A Notion page id: 32 hex digits, with or without dashes.
    if (typeof pageId !== 'string' || !/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(pageId)) {
      return res.status(400).json({ error: 'Missing or invalid pageId' });
    }
  } else if (action === 'setThumbnailFocus') {
    if (!focus || typeof focus !== 'object' || Array.isArray(focus)) return res.status(400).json({ error: 'Invalid focus' });
  } else if (action === 'setProjectOrder') {
    if (!order || typeof order !== 'object' || Array.isArray(order)) return res.status(400).json({ error: 'Invalid order' });
  } else if (action === 'recategorizeEntry') {
    const notionId = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
    if (typeof pageId !== 'string' || !notionId.test(pageId)) return res.status(400).json({ error: 'Missing or invalid pageId' });
    // Either an entry of the project to move to (its project is copied), or the
    // values a move replaced (to put them back).
    if (restore !== undefined) {
      if (!restore || typeof restore !== 'object' || Array.isArray(restore)) return res.status(400).json({ error: 'Invalid restore' });
    } else if (typeof referenceLogId !== 'string' || !notionId.test(referenceLogId)) {
      return res.status(400).json({ error: 'Missing or invalid referenceLogId' });
    }
  } else {
    if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });
    if (!pageId) {
      if (!referenceLogId) return res.status(400).json({ error: 'Missing referenceLogId' });
      if (!dateTaken || isNaN(new Date(dateTaken).getTime())) return res.status(400).json({ error: 'Missing or invalid dateTaken' });
    }
    for (const [name, value] of [['source', sourceLabel], ['topic', topicName], ['type', typeName]]) {
      if (value !== undefined && typeof value !== 'string') return res.status(400).json({ error: `Invalid ${name}` });
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

  // The person's own order for the project list: kept on the tenant record, so
  // every device that syncs gets the same one (see get-notion-logs.js, which
  // returns it). The whole order is replaced each time; what is stored is only
  // what is fit to (see _lib/projectOrder.js).
  // Which part of each photo shows when it is cropped (see _lib/thumbnailFocus.js),
  // kept on the tenant record like the project order so every device crops the
  // same way; the whole map is replaced each time.
  if (action === 'setThumbnailFocus') {
    try {
      tenant.thumbnailFocus = sanitizeThumbnailFocus(focus);
      await saveTenant(tenantId, tenant);
      return res.status(200).json({ success: true, focus: tenant.thumbnailFocus });
    } catch (err) {
      console.error('[backlog-photo] setThumbnailFocus failed:', err.message);
      return res.status(500).json({ error: 'Could not save that right now.' });
    }
  }

  if (action === 'setProjectOrder') {
    try {
      tenant.projectOrder = sanitizeProjectOrder(order);
      await saveTenant(tenantId, tenant);
      return res.status(200).json({ success: true, order: tenant.projectOrder });
    } catch (err) {
      console.error('[backlog-photo] setProjectOrder failed:', err.message);
      return res.status(500).json({ error: 'Could not save the order right now.' });
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

  if (action === 'archiveEntry' || action === 'restoreEntry') {
    try {
      const pageRes = await notionFetch(`https://api.notion.com/v1/pages/${pageId}`, { method: 'GET', headers });
      if (!pageRes.ok) {
        const errData = await pageRes.json().catch(() => ({}));
        return res.status(400).json({ error: errData.message || 'Could not read this entry.' });
      }
      const page = await pageRes.json();
      // The integration can see more than the calendar's entries (project pages,
      // other databases it was shared with): only a page in one of THIS tenant's
      // own databases may be removed or restored here.
      const normalizeId = (id) => String(id || '').replace(/-/g, '').toLowerCase();
      const parentDatabase = normalizeId(page.parent?.database_id);
      const isCalendarEntry = parentDatabase && (tenant.sources || []).some((source) => normalizeId(source.databaseId) === parentDatabase);
      if (!isCalendarEntry) return res.status(403).json({ error: 'That page is not an entry in your calendar.' });

      const trash = action === 'archiveEntry';
      if (Boolean(page.in_trash ?? page.archived) === trash) return res.status(200).json({ success: true });
      const send = (body) => notionFetch(`https://api.notion.com/v1/pages/${pageId}`, { method: 'PATCH', headers, body: JSON.stringify(body) });
      let patchRes = await send({ in_trash: trash });
      let patchData = await patchRes.json().catch(() => ({}));
      // An older API shape names it `archived`.
      if (patchData.object === 'error' && patchData.code === 'validation_error') {
        patchRes = await send({ archived: trash });
        patchData = await patchRes.json().catch(() => ({}));
      }
      if (patchData.object === 'error') return res.status(400).json({ error: patchData.message || 'Notion would not change this entry.' });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error(`[backlog-photo] ${action} failed:`, err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Moving an entry to another project: its project (and, where the database
  // keeps it on the entry, its type) is copied from an entry of that project --
  // see _lib/entryProject.js. Answers with what it replaced, which undoing the
  // move sends back as `restore`. Only a page in one of THIS tenant's own
  // databases can be changed, and the project has to come from the same one.
  if (action === 'recategorizeEntry') {
    try {
      const normalizeId = (id) => String(id || '').replace(/-/g, '').toLowerCase();
      const readPage = async (id, what) => {
        const pageRes = await notionFetch(`https://api.notion.com/v1/pages/${id}`, { method: 'GET', headers });
        if (!pageRes.ok) {
          const errData = await pageRes.json().catch(() => ({}));
          throw new ProjectChangeError(errData.message || `Could not read ${what}.`);
        }
        return pageRes.json();
      };

      const entry = await readPage(pageId, 'this entry');
      const entryDatabase = normalizeId(entry.parent?.database_id);
      const source = entryDatabase ? (tenant.sources || []).find((s) => normalizeId(s.databaseId) === entryDatabase) : null;
      if (!source) return res.status(403).json({ error: 'That page is not an entry in your calendar.' });

      let assignment;
      if (restore !== undefined) {
        assignment = restore;
      } else {
        const reference = await readPage(referenceLogId, 'that project');
        if (normalizeId(reference.parent?.database_id) !== entryDatabase) {
          return res.status(400).json({ error: 'That project is in a different database than this entry.' });
        }
        assignment = assignmentFrom(reference.properties || {}, source);
      }

      const patch = patchFromAssignment(entry.properties || {}, assignment);
      const previous = currentValues(entry.properties || {}, assignment);
      if (sameValues(previous, assignment)) return res.status(200).json({ success: true, changed: false, previous });

      const patchRes = await notionFetch(`https://api.notion.com/v1/pages/${pageId}`, { method: 'PATCH', headers, body: JSON.stringify({ properties: patch }) });
      const patchData = await patchRes.json().catch(() => ({}));
      if (patchData.object === 'error') return res.status(400).json({ error: patchData.message || 'Notion would not change this entry.' });
      return res.status(200).json({ success: true, changed: true, previous });
    } catch (err) {
      if (err instanceof ProjectChangeError) return res.status(400).json({ error: err.message });
      console.error('[backlog-photo] recategorizeEntry failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'timer') {
    try {
      const body = req.body || {};
      // Every timestamp is this server's clock, and each answer says what it is
      // now, so a device can allow for its own clock being off.
      const now = Date.now();
      const current = await getActiveTimer(tenantId);

      // A picture the timer holds, for a device that didn't take it.
      if (op === 'getPhoto') {
        const held = validTimerPhotoId(body.id) && current?.photos?.some((photo) => photo.id === body.id);
        return res.status(200).json({ success: true, imageBase64: held ? await getTimerPhotoData(tenantId, body.id) : null });
      }
      if (op === 'addPhoto' && !validTimerPhotoDataUrl(body.imageBase64)) {
        return res.status(400).json({ error: 'That photo can’t be added (it is too large, or not an image).' });
      }

      const result = applyTimerOp(current ?? null, op, body, now);
      const next = result.timer ?? null;
      if (next !== (current ?? null)) {
        if (op === 'addPhoto') await putTimerPhotoData(tenantId, body.id, body.imageBase64);
        if (next) await saveActiveTimer(tenantId, next);
        else await deleteActiveTimer(tenantId);
      }
      if (result.removedPhotoIds?.length) await deleteTimerPhotoData(tenantId, result.removedPhotoIds);
      return res.status(200).json({ success: true, timer: next, serverNow: now, existing: Boolean(result.existing) });
    } catch (err) {
      if (err instanceof TimerOpError) return res.status(400).json({ error: err.message });
      console.error('[backlog-photo] timer failed:', err.message);
      return res.status(500).json({ error: 'Could not reach the timer right now.' });
    }
  }

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
      const source = findSource(tenant, sourceLabel);
      const taxonomy = resolveSourceTaxonomy(refPage.properties || {}, source);

      // A select-style source keeps its topic (and type) on the entry itself, so a
      // new project has no page to create: it comes into being the first time an
      // entry uses it (the topic / type are written then -- see the create path
      // below), and Notion adds the select option on the spot.
      if (taxonomy.topicProp && valueForProperty(taxonomy.topicProp.type, 'x')) {
        return res.status(200).json({ success: true, virtual: true });
      }

      const relationEntry = Object.entries(refPage.properties || {}).find(([, v]) => v.type === 'relation' && v.relation?.length > 0);
      if (!relationEntry) return res.status(400).json({ error: 'Could not find a project relation on this database.' });
      const [relationPropName, relationVal] = relationEntry;

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

      const newProjectProperties = { [targetTitlePropName]: { title: [{ text: { content: newProjectTitle.trim() } }] } };

      // The logs database shows a project's type as a rollup of a property on the
      // project's own page, so a new project's type is set on that property.
      // Whatever can't be set (an unreadable schema, a computed or status
      // property) doesn't stop the project being created -- it is made without
      // the type and the caller is told.
      const wantedType = typeof projectType === 'string' ? projectType.trim() : '';
      let typeSet = false;
      let warning = null;
      if (wantedType) {
        try {
          const logsDatabaseId = refPage.parent?.database_id;
          const typePropName = logsDatabaseId
            ? await findProjectTypePropName(logsDatabaseId, relationPropName, taxonomy.typeProp?.name, headers)
            : null;
          const typeProp = typePropName ? dataSource.properties?.[typePropName] : null;
          const typeValue = typeProp ? await projectTypeValue(typeProp, wantedType, headers) : null;
          if (typeValue) {
            newProjectProperties[typePropName] = typeValue;
            typeSet = true;
          }
        } catch (err) {
          console.error('[backlog-photo] setting the new project\'s type failed:', err.message);
        }
        if (!typeSet) warning = `The project was added, but its type "${wantedType}" could not be set -- set it in Notion.`;
      }

      const createRes = await notionFetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { database_id: targetDatabaseId },
          properties: newProjectProperties,
        }),
      });
      const createData = await createRes.json();
      if (createData.object === 'error') return res.status(400).json({ error: createData.message });

      return res.status(200).json({ success: true, projectPageId: createData.id, ...(wantedType ? { typeSet, warning } : {}) });
    } catch (err) {
      console.error('[backlog-photo] createProject failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // One photo for a timer session, uploaded on its own: it isn't attached to a
  // page yet (logTime does that, once the session is stopped), so the id is
  // all that comes back. Notion drops an upload that is never attached.
  if (action === 'uploadTimerPhoto') {
    try {
      let source = imageBase64;
      if (timerPhotoId !== undefined) {
        source = await getTimerPhotoData(tenantId, timerPhotoId);
        if (!source) return res.status(404).json({ error: 'That photo is no longer available.' });
      }
      const fileUploadId = await uploadBase64Photo(source, notionToken);
      return res.status(200).json({ success: true, fileUploadId });
    } catch (err) {
      console.error('[backlog-photo] uploadTimerPhoto failed:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === 'logTime') {
    // Two devices can press Stop on the same timer at about the same moment.
    // The first to claim the session (by its start time) saves it; the other
    // is told it is already saved (or being) rather than making a second entry.
    const sessionKey = sessionStartedAt === undefined ? null : String(Math.trunc(sessionStartedAt));
    let claimed = false;
    let saved = false;
    try {
      if (sessionKey) {
        claimed = await claimSavedSession(tenantId, sessionKey);
        if (!claimed) {
          return res.status(200).json({ success: true, duplicate: true, pageId: await getSavedSessionPageId(tenantId, sessionKey) });
        }
      }
      const refRes = await notionFetch(`https://api.notion.com/v1/pages/${referenceLogId}`, { method: 'GET', headers });
      if (!refRes.ok) {
        const errData = await refRes.json().catch(() => ({}));
        return res.status(400).json({ error: errData.message || 'Could not read the reference log entry.' });
      }
      const refPage = await refRes.json();
      const databaseId = refPage.parent?.database_id;
      if (!databaseId) return res.status(400).json({ error: 'Reference log entry is not part of a database.' });

      const sessionTitle = buildSessionTitle({ dateStr: dateTaken, projectTitle, minutes });
      const { properties, hasRelation } = buildSessionProperties(refPage.properties, {
        title: sessionTitle,
        dateStr: dateTaken,
        minutes,
        projectPageId,
      });
      // An entry with no project link would just float unattributed on the
      // calendar and never count toward any project's total.
      if (!hasRelation) return res.status(400).json({ error: 'Could not find the project link on this database.' });

      // Photos first, then the notes; the first photo doubles as the cover.
      const { children, cover } = buildSessionChildren({
        noteText: buildSessionNote({ minutes, startLabel, endLabel, notes: sanitizeSessionNotes(notes) }),
        photoUploadIds: photoUploadIds || [],
      });
      const createRes = await notionFetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          parent: { database_id: databaseId },
          properties,
          children,
          ...(cover ? { cover } : {}),
        }),
      });
      const createData = await createRes.json();
      if (createData.object === 'error') return res.status(400).json({ error: createData.message });
      saved = true;

      // Saved: remember the page against the session, and clear the running
      // timer (and its photos) if it is this very session. Neither failing
      // undoes the entry, so they are best effort.
      if (sessionKey) {
        try {
          await markSavedSession(tenantId, sessionKey, createData.id);
          const running = await getActiveTimer(tenantId);
          if (running && running.startedAt === Math.trunc(sessionStartedAt)) {
            await deleteActiveTimer(tenantId);
            await deleteTimerPhotoData(tenantId, (running.photos || []).map((photo) => photo.id));
          }
        } catch (err) {
          console.error('[backlog-photo] logTime cleanup failed:', err.message);
        }
      }

      return res.status(200).json({ success: true, pageId: createData.id, title: sessionTitle });
    } catch (err) {
      console.error('[backlog-photo] logTime failed:', err.message);
      return res.status(500).json({ error: err.message });
    } finally {
      // Nothing was saved: let a retry (from either device) claim the session.
      if (claimed && !saved) await releaseSavedSession(tenantId, sessionKey).catch(() => {});
    }
  }

  try {
    const fileUploadId = await uploadBase64Photo(imageBase64, notionToken);
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
    const dateProperties = []; // the database's date properties, which get the photo's date
    for (const [propName, propVal] of Object.entries(refPage.properties || {})) {
      if (propVal.type === 'title') {
        properties[propName] = { title: [{ text: { content: String(title || 'Backlogged Photo') } }] };
      } else if (propVal.type === 'date') {
        dateProperties.push(propName);
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

    // A select-style source carries its topic and type on the entry itself, so
    // they are written here (a new name becomes a new select option).
    if (sourceLabel !== undefined && (topicName || typeName)) {
      const taxonomy = resolveSourceTaxonomy(refPage.properties || {}, findSource(tenant, sourceLabel));
      Object.assign(properties, taxonomyProperties(taxonomy, { topicName, typeName }));
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

    // What date Notion actually kept. A database with no date property can't be
    // given one -- the calendar then dates the entry by when it was created
    // (today) -- so the answer says whether one was set, and which date stuck,
    // for the import to tell the person rather than leave them to find out.
    const storedDates = dateProperties
      .map((name) => createData.properties?.[name]?.date?.start)
      .filter((start) => typeof start === 'string');
    console.log(`[backlog-photo] created an entry: asked for ${dateTaken}, date properties ${JSON.stringify(dateProperties)}, stored ${JSON.stringify(storedDates)}`);

    return res.status(200).json({ success: true, pageId: createData.id, dated: dateProperties.length > 0, storedDate: storedDates[0] || null });
  } catch (err) {
    console.error('[backlog-photo] Failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
