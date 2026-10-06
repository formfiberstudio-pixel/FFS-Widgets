// Photos added while a project timer runs, kept on this device until the
// session is saved (or discarded). They live in IndexedDB rather than in the
// timer's localStorage record: a few photos would blow through localStorage's
// ~5MB, and IndexedDB is built for that. The timer record itself only keeps
// each photo's id (see ProjectTimer.jsx); the picture is looked up here by it.
//
// Each photo is stored as the data URL resizeImageForUpload produced (already
// downscaled and re-encoded), which is exactly what gets uploaded on Stop and
// can be shown as an <img> src as it is. If IndexedDB can't be used at all (a
// private window, blocked site data) the photos are held in memory instead --
// they still work for the session, they just don't survive a reload.

const DB_NAME = 'notionWidgetTimerPhotos';
const STORE = 'photos';

const memory = new Map();
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

const settle = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

export async function putTimerPhoto(id, dataUrl) {
  const db = await openDb();
  if (db) {
    try {
      await settle(db.transaction(STORE, 'readwrite').objectStore(STORE).put(dataUrl, id));
      return;
    } catch { /* fall back to memory below */ }
  }
  memory.set(id, dataUrl);
}

// The photo's data URL, or null when it is gone (site data cleared).
export async function getTimerPhoto(id) {
  if (memory.has(id)) return memory.get(id);
  const db = await openDb();
  if (!db) return null;
  try {
    const value = await settle(db.transaction(STORE, 'readonly').objectStore(STORE).get(id));
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

export async function deleteTimerPhotos(ids) {
  for (const id of ids) memory.delete(id);
  const db = await openDb();
  if (!db || !ids.length) return;
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    for (const id of ids) store.delete(id);
  } catch { /* nothing to clean up if storage is unavailable */ }
}

// Drops every stored photo that no running timer lists, so photos left behind
// (a timer lost with the browser's localStorage, say) don't pile up.
export async function pruneTimerPhotos(keepIds) {
  const keep = new Set(keepIds);
  for (const id of [...memory.keys()]) if (!keep.has(id)) memory.delete(id);
  const db = await openDb();
  if (!db) return;
  try {
    const keys = await settle(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
    const stale = keys.filter((id) => !keep.has(id));
    if (stale.length) await deleteTimerPhotos(stale);
  } catch { /* best effort */ }
}
