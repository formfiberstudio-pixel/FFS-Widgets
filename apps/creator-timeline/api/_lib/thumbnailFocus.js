// Which part of a photo shows when it is cropped to fit its frame: a point in the
// picture, as percentages across (x) and down (y), per entry -- the browser's
// own object-position, so 50/50 is the middle (and is never stored). Kept on the
// tenant record, so every device crops the same way. This only decides what is
// fit to store; src/thumbnailFocus.js has the browser's side.

const MAX_ENTRIES = 5000;
const NOTION_ID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

const clampPercent = (value) => Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;

// { entry id: { x, y } } with real ids and numbers inside 0-100, the middle left
// out, and no more than a sensible number of them.
export function sanitizeThumbnailFocus(raw) {
  const clean = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return clean;
  for (const [id, point] of Object.entries(raw)) {
    if (Object.keys(clean).length >= MAX_ENTRIES) break;
    if (!NOTION_ID.test(id)) continue;
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const focus = { x: clampPercent(x), y: clampPercent(y) };
    if (focus.x === 50 && focus.y === 50) continue;
    clean[id] = focus;
  }
  return clean;
}
