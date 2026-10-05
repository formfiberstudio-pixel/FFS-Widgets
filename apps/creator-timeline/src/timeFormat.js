// Pure helpers for the project timer (no React, no DOM), so they can be
// unit-tested with node:test. The server-side counterpart for session
// titles lives in api/_lib/timeTracking.js; formatMinutes here must stay
// in step with its formatMinutesLabel.

// How a project is identified on the client: the same source + title pair
// the sidebar and Import Photos already use.
export const projectTimerKey = (source, title) => `${source}::${title}`;

// Running clock: 5s -> "0:00:05", 3725s -> "1:02:05"
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Time actually spent on a timer, in ms: wall-clock since it started, minus
// every stretch it sat paused. The clock stops at `endedAt` once finished,
// and at `pausedAt` while paused (`pausedMs` is the pauses already ended).
export function timerElapsedMs(timer, now = Date.now()) {
  const end = timer.endedAt ?? timer.pausedAt ?? now;
  return Math.max(0, end - timer.startedAt - (timer.pausedMs || 0));
}

// Same clock with a two-digit hour, as the big dial shows it: "00:45:24"
export const formatClock = (ms) => formatDuration(ms).padStart(8, '0');

// How far round the dial's hour the sweep has gone, in degrees clockwise
// from 12 o'clock: 45:24 into the hour is 272.4. It wraps each hour, and is
// always below 360 so the sector never has to draw a closed circle.
export function dialSweepDegrees(ms) {
  const secondsIntoHour = Math.max(0, Math.floor(ms / 1000)) % 3600;
  return (secondsIntoHour * 360) / 3600;
}

// Totals: 80 -> "1h 20m", 45 -> "45m", 120 -> "2h"
export function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

// Local wall-clock "14:05" (24h), for the start/end range in a session note.
export function clockLabel(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Local calendar date as YYYY-MM-DD (not toISOString, which is UTC and would
// shift an evening session onto the next day).
export function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Sums log.minutes per project. `range` is the sidebar's visible
// {start, end} (inclusive Dates) or null when the sidebar isn't narrowed to
// the visible range; `inRange` is null in that case.
export function sumProjectMinutes(logs, range) {
  const all = new Map();
  const inRange = range ? new Map() : null;
  for (const log of logs) {
    const minutes = Number(log.minutes) || 0;
    if (minutes <= 0) continue;
    const key = projectTimerKey(log.source || 'Activity Log', log.Projects || 'Untitled Project');
    all.set(key, (all.get(key) || 0) + minutes);
    if (inRange) {
      const day = new Date(Number(log.year), Number(log.monthNumber) - 1, Number(log.dayNumber));
      if (day >= range.start && day <= range.end) inRange.set(key, (inRange.get(key) || 0) + minutes);
    }
  }
  return { all, inRange };
}
