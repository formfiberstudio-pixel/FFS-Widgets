// The person's own order for the project list, as the server keeps it (on their
// tenant record, so every device gets the same one). See src/projectOrder.js for
// what the lists mean and how the browser uses them -- this only decides what is
// fit to store, so a bad request can not fill the record with junk.

const MAX_LISTS = 300;
const MAX_NAMES_PER_LIST = 500;
const MAX_NAME_LENGTH = 200;
const MAX_KEY_LENGTH = 420;

// Only lists of the three kinds, of distinct non-empty names, within sensible
// sizes. Anything else is dropped; the rest is kept as sent.
export function sanitizeProjectOrder(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [key, list] of Object.entries(raw).slice(0, MAX_LISTS)) {
    if (key.length > MAX_KEY_LENGTH) continue;
    if (!(key === 'sources' || key.startsWith('types:') || key.startsWith('projects:'))) continue;
    if (!Array.isArray(list)) continue;
    const names = [...new Set(list.filter((name) => typeof name === 'string' && name && name.length <= MAX_NAME_LENGTH))].slice(0, MAX_NAMES_PER_LIST);
    if (names.length > 0) clean[key] = names;
  }
  return clean;
}
