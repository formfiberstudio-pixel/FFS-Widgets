// Which of the phone's photos have already been logged from the Import window.
//
// The Android picker (nativePhotoPicker.js) hands over each photo's stable
// MediaStore address (content://media/external/images/media/<id>) -- the same
// address every time the photo is listed. When a photo is uploaded, that address
// is kept here against the entry it went into, and the picker marks any photo it
// finds in this record -- the way the Mandalart app tells its "Log Photos" screen
// which of a day's photos it has already brought in. Kept on this device, per
// account (a camera roll belongs to one phone). Pure -- the storage is passed in.
//
// A photo stops being marked when its entry is gone from the calendar. The record
// notes when it has SEEN the entry in the calendar (`seen`): after that, the entry
// being absent means it was deleted, and the mark goes at once. Before that -- an
// upload the calendar has not caught up with yet -- it is kept until a sync has
// finished since the upload (or, failing that, a few minutes).
//
// Photos logged before this existed, or by another route (the website, a share
// from Google Photos with a different kind of address), are not in the record and
// show as new.

const storageKey = (tenantId) => `notionWidgetLoggedPhotos:${tenantId}`;

// A phone's roll can hold tens of thousands of photos but a person logs a few a
// day; this is years of logging, and the oldest go first.
export const MAX_KEPT = 5000;

// How long an upload the calendar has not shown yet is still taken as logged when no
// sync has finished since to say otherwise.
export const SYNC_GRACE_MS = 15 * 60 * 1000;

export function loadLoggedPhotos(storage, tenantId) {
  if (!tenantId) return {};
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(tenantId)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLoggedPhotos(storage, tenantId, map) {
  if (!tenantId) return;
  try { storage.setItem(storageKey(tenantId), JSON.stringify(map)); } catch { /* quota or blocked: marks are a convenience */ }
}

// The record with `uri` added: { pageId, title, date, at }. The input is left alone.
export function withLoggedPhoto(map, uri, { pageId, title, date }, now = Date.now()) {
  const next = { ...map, [uri]: { pageId: pageId || null, title: title || '', date: date || '', at: now } };
  const keys = Object.keys(next);
  if (keys.length > MAX_KEPT) {
    keys.sort((a, b) => (next[a].at || 0) - (next[b].at || 0));
    keys.slice(0, keys.length - MAX_KEPT).forEach((key) => delete next[key]);
  }
  return next;
}

// Notes every record whose entry is in the calendar (`entryIds`, a Set of the
// calendar's entry ids) as seen there. The same object comes back if nothing was
// newly seen, so a caller can tell whether there is anything to save.
export function markSeen(map, entryIds) {
  if (!entryIds || entryIds.size === 0) return map;
  let next = map;
  for (const [uri, record] of Object.entries(map)) {
    if (!record.seen && record.pageId && entryIds.has(record.pageId)) {
      if (next === map) next = { ...map };
      next[uri] = { ...record, seen: true };
    }
  }
  return next;
}

// What is known of `uri`'s logging, or null if it is not logged -- including when
// the entry it went into has since been deleted. `known` is what the calendar shows:
// { ids: Set of entry ids, syncedAt: when it was last brought up to date }, or null
// when there is no way to check (the record is then taken as it stands).
export function loggedInfo(map, uri, known, now = Date.now()) {
  const record = map[uri];
  if (!record) return null;
  if (!known || !record.pageId) return record;
  if (known.ids.has(record.pageId)) return record;
  // The calendar does not have it. If it once did, it was deleted.
  if (record.seen) return null;
  // Never seen: an upload the calendar may not have caught up with. A sync that has
  // finished since the upload would have shown it; so would the passing of time.
  if (known.syncedAt && known.syncedAt > (record.at || 0)) return null;
  if (now - (record.at || 0) > SYNC_GRACE_MS) return null;
  return record;
}

// How many of `photos` (each with a uri) are logged.
export function countLogged(map, photos, known, now = Date.now()) {
  let count = 0;
  for (const photo of photos) if (loggedInfo(map, photo.uri, known, now)) count++;
  return count;
}
