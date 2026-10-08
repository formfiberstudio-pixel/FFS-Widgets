// Choosing which part of a photo shows when it is cropped to fill its frame
// (every thumbnail is object-fit: cover). A position is a point in the picture,
// as percentages across (x) and down (y) -- the browser's own object-position, so
// 50 / 50 is the middle, the default. Pure, so it can be tested; App.jsx does the
// dragging and the saving (see api/_lib/thumbnailFocus.js for what is stored).

const clamp = (value) => Math.min(100, Math.max(0, value));
const tenth = (value) => Math.round(value * 10) / 10;

// The CSS for a position, or undefined for the middle (nothing to set).
export function focusCss(focus) {
  if (!focus || !Number.isFinite(focus.x) || !Number.isFinite(focus.y)) return undefined;
  if (focus.x === 50 && focus.y === 50) return undefined;
  return `${focus.x}% ${focus.y}%`;
}

// Where the position is after dragging the picture by (dx, dy) pixels inside its
// frame, from `start` (or the middle). The picture is scaled until it covers the
// frame, so it can only move along the side that overflows: dragging it right
// shows more of its left, which is a smaller x. A side that does not overflow
// keeps what it had.
export function focusAfterDrag({ start, dx, dy, frame, natural }) {
  const from = { x: Number.isFinite(start?.x) ? start.x : 50, y: Number.isFinite(start?.y) ? start.y : 50 };
  if (!(frame?.width > 0 && frame?.height > 0 && natural?.width > 0 && natural?.height > 0)) return from;
  const scale = Math.max(frame.width / natural.width, frame.height / natural.height);
  const overflowX = natural.width * scale - frame.width;
  const overflowY = natural.height * scale - frame.height;
  return {
    x: overflowX > 0.5 ? tenth(clamp(from.x - (dx / overflowX) * 100)) : from.x,
    y: overflowY > 0.5 ? tenth(clamp(from.y - (dy / overflowY) * 100)) : from.y,
  };
}

// The map of positions with one entry's set, or -- for the middle -- cleared:
// only positions that differ from the default are kept.
export function withFocus(map, id, focus) {
  const next = { ...(map || {}) };
  if (!focus || (focus.x === 50 && focus.y === 50)) delete next[id];
  else next[id] = { x: focus.x, y: focus.y };
  return next;
}
