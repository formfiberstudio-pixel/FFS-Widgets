// The geometry behind selecting several photos at once in Import Photos: the
// range a shift+click or a finger drag covers, which tiles a mouse-drawn box
// touches, and how fast to scroll when the pointer pushes against an edge.
// Pure, so it can be unit-tested; ImportPhotosPanel.jsx does the listening.

// The ids from position `from` to position `to` in the list, both ends
// included, whichever way round they are. Out-of-range positions give nothing.
export function idsBetween(ids, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return [];
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return [];
  return ids.slice(Math.min(from, to), Math.max(from, to) + 1);
}

// A shift+click: everything from the photo last clicked (the first photo, when
// nothing has been clicked yet -- the way a file manager reads it) to this one.
export function shiftRange(ids, anchorIndex, clickedIndex) {
  return idsBetween(ids, anchorIndex ?? 0, clickedIndex);
}

// The ids of the tiles a box touches, even by a pixel. `tiles` is a list of
// [id, { left, top, right, bottom }]; the box has the same four edges.
export function idsInBox(tiles, box) {
  return tiles
    .filter(([, r]) => r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top)
    .map(([id]) => id);
}

// How many pixels to scroll by, per step, while a drag is held near an edge of
// the scrolling area: negative towards the start, positive towards the end,
// 0 away from both. It builds up from nothing at `edge` px in to `maxSpeed` at
// the edge itself (and beyond it, if the pointer is dragged outside).
export function edgeScrollSpeed(position, start, end, { edge = 40, maxSpeed = 16 } = {}) {
  if (!(end > start)) return 0;
  // Never let the two zones overlap on a small area.
  const zone = Math.min(edge, (end - start) / 2);
  if (position < start + zone) return -Math.round(maxSpeed * Math.min(1, (start + zone - position) / zone));
  if (position > end - zone) return Math.round(maxSpeed * Math.min(1, (position - (end - zone)) / zone));
  return 0;
}
