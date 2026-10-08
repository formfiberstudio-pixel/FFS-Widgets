// Turns what the Android Share handoff reports about a photo (see
// SharedPhotosPlugin.java) into a photo for the Import Photos review list.
// Pure, so the dating rules can be unit-tested.

// A blank stand-in until the thumbnail has been read.
export const SHARED_PREVIEW_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// A file's last-changed time only counts as a date once it is older than this --
// the same call the web file picker makes: a copy saved a moment ago says when
// it was saved, not when the photo was taken.
const MODIFIED_TRUST_AFTER_MS = 60 * 60 * 1000;

// When the photo was taken, and whether that can be trusted. The record's
// dateSource says where the date came from: "exif" (the camera's own capture
// time) and "mediastore" (the gallery's) are reliable; "modified" (the file's
// last-changed time) only when it is old enough; and with "none" -- or a date
// that isn't one -- it is today, flagged as a guess so the review shows the
// "check the date" marker.
export function sharedPhotoDate(record, now = Date.now()) {
  const taken = Number(record?.dateTaken);
  if (Number.isFinite(taken) && taken > 0) {
    const source = record?.dateSource;
    if (source === 'exif' || source === 'mediastore') return { date: new Date(taken), reliable: true };
    if (source === 'modified' && now - taken > MODIFIED_TRUST_AFTER_MS) return { date: new Date(taken), reliable: true };
  }
  return { date: new Date(now), reliable: false };
}

// One shared photo as a review-list entry, the shape the native picker's photos
// have (nativeUri set, no File). `toDateInputValue` turns a Date into the
// list's "YYYY-MM-DD" in local time.
export function sharedPhotoFromRecord(record, toDateInputValue, now = Date.now()) {
  const { date, reliable } = sharedPhotoDate(record, now);
  return {
    id: `shared-${record.uri}`,
    file: null,
    nativeUri: record.uri,
    displayName: record.displayName || 'photo',
    previewUrl: SHARED_PREVIEW_PLACEHOLDER,
    date: toDateInputValue(date),
    hasExif: reliable,
    projectKey: '',
  };
}

// The records worth importing: each photo once (the same one shared twice, or
// already in the list), and nothing without an address.
export function freshSharedRecords(records, alreadyStagedUris = []) {
  const seen = new Set(alreadyStagedUris);
  const fresh = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || typeof record.uri !== 'string' || !record.uri || seen.has(record.uri)) continue;
    seen.add(record.uri);
    fresh.push(record);
  }
  return fresh;
}
