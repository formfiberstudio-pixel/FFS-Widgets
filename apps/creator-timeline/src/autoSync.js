// When the widget should sync with Notion by itself: when it is picked up again
// after a LONG BREAK -- a tab left open overnight, the phone or tablet app
// brought back to the front the next day. Never on a timer: someone using the
// widget for hours without a break is never interrupted by a sync. Pure, so the
// rules can be unit-tested; App.jsx supplies the facts and does the syncing.

// How long the widget must have gone unused to count as a long break: the hour
// Notion's photo links last, so pictures are fresh again when it is picked up.
// (Measured from the last sign of use, not from the last sync -- see App.jsx.)
export const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

// Coming back into view can fire several events at once (visibility, focus,
// pageshow), and a failed attempt shouldn't be retried in a loop: never start
// two attempts closer together than this.
export const AUTO_SYNC_MIN_GAP_MS = 30 * 1000;

// Was the widget unused for long enough, up to `now`, that picking it up again
// should bring the calendar up to date? `lastActiveAt` is the last moment it
// was seen in use (0 or missing: no idea, so not a long break).
export function isLongBreak({ now, lastActiveAt }) {
  return Boolean(lastActiveAt) && now - lastActiveAt >= AUTO_SYNC_AFTER_MS;
}

// Whether to run the sync a long break has made owed, right now.
export function shouldAutoSync({ now, owed, lastAttemptAt = 0, hidden, isDemoMode, tenantId, busy, viewMode }) {
  if (!owed) return false;
  // Nothing to sync with, or nobody looking.
  if (hidden || isDemoMode || !tenantId) return false;
  // A sync (or the first load) is already under way.
  if (busy) return false;
  // Import Photos is mid-flow: swapping the calendar's data under it helps no one.
  if (viewMode === 'import') return false;
  return now - lastAttemptAt >= AUTO_SYNC_MIN_GAP_MS;
}
