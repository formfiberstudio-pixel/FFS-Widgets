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
// Photos logged before this existed, or by another route (the website, a share
// from Google Photos with a different kind of address), are not in the record and
// show as new.

const storageKey = (tenantId) => `notionWidgetLoggedPhotos:${tenantId}`;

// A phone's roll can hold tens of thousands of photos but a person logs a few a
// day; this is years of logging, and the oldest go first.
export const MAX_KEPT = 5000;

// An entry only appears in the calendar after the next sync, which follows an
// upload within moments; until then a photo is taken as logged without that check.
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

// What is known of `uri`'s logging, or null if it is not logged -- including when
// the entry it went into has since been deleted. `knownEntryIds` is the set of the
// calendar's entry ids (null: no way to check, take the record as it stands).
export function loggedInfo(map, uri, knownEntryIds, now = Date.now()) {
  const record = map[uri];
  if (!record) return null;
  if (knownEntryIds && record.pageId && !knownEntryIds.has(record.pageId) && now - (record.at || 0) > SYNC_GRACE_MS) return null;
  return record;
}

// How many of `photos` (each with a uri) are logged.
export function countLogged(map, photos, knownEntryIds, now = Date.now()) {
  let count = 0;
  for (const photo of photos) if (loggedInfo(map, photo.uri, knownEntryIds, now)) count++;
  return count;
}
