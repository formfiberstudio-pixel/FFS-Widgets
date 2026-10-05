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

// The entry's title, "2026.10.05_Personal Blog_1h 20m": session date, project
// and length of the log. Mirrors buildSessionTitle in api/_lib/timeTracking.js
// (same cap on the project name; a test keeps the two in step).
export const MAX_SESSION_TITLE_PROJECT_LENGTH = 100;

export function buildSessionTitle({ dateStr, projectTitle, minutes }) {
  const length = formatMinutes(minutes);
  const project = String(projectTitle ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SESSION_TITLE_PROJECT_LENGTH);
  if (!project) return `⏱ ${length}`;
  return `${String(dateStr).replace(/-/g, '.')}_${project}_${length}`;
}

// Notes jotted while a timer runs, saved with the session. Caps mirror
// MAX_SESSION_NOTES / MAX_SESSION_NOTE_LENGTH in api/_lib/timeTracking.js.
export const MAX_SESSION_NOTES = 50;
export const MAX_SESSION_NOTE_LENGTH = 500;

// One-line, trimmed, length-capped; '' when there's nothing to keep.
export const cleanNoteText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_SESSION_NOTE_LENGTH);

// The session's note text exactly as the server writes it into the Notion
// page (api/_lib/timeTracking.js buildSessionNote), so an entry added locally
// right after Stop reads the same as it will after the next sync.
// notes: [{ at: "14:12", text }]
export function buildSessionNoteText({ minutes, startLabel, endLabel, notes = [] }) {
  const range = startLabel && endLabel ? ` · ${startLabel}–${endLabel}` : '';
  const lines = [`⏱ ${Math.round(minutes)} min${range}`];
  for (const note of notes) lines.push(note.at ? `${note.at} · ${note.text}` : note.text);
  return lines.join('\n');
}

// The Week view's summary: one row per project (source + title) that has
// anything logged in the week, busiest first. `days` is [{ dateObj, logs }],
// one per day of the week. A log with minutes is a timer session (adds to
// `minutes` and `sessions`); any other log is an ordinary entry.
// `sampleLog` / `sampleDayLogs` are one real entry of the project and its
// day, so the caller can colour the row the way the calendar colours it.
export function summarizeWeekProjects(days) {
  const byKey = new Map();
  for (const { dateObj, logs } of days) {
    for (const log of logs) {
      const source = log.source || 'Activity Log';
      const title = log.Projects || 'Untitled Project';
      const key = projectTimerKey(source, title);
      let row = byKey.get(key);
      if (!row) {
        row = { key, source, title, minutes: 0, sessions: 0, entries: 0, dayKeys: new Set(), sampleLog: log, sampleDayLogs: logs, sampleDate: dateObj };
        byKey.set(key, row);
      }
      const minutes = Number(log.minutes) || 0;
      if (minutes > 0) {
        row.minutes += minutes;
        row.sessions += 1;
      } else {
        row.entries += 1;
      }
      row.dayKeys.add(localDateString(dateObj));
    }
  }
  const rows = [...byKey.values()].map(({ dayKeys, ...row }) => ({ ...row, days: dayKeys.size }));
  rows.sort((a, b) => b.minutes - a.minutes || b.days - a.days || a.title.localeCompare(b.title));
  return { rows, totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0) };
}

// Tracked time for one project (source + title) from its log entries: all
// time, the calendar year and month of `now`, how many sessions made it up,
// and the minutes per year (byYear: { 2026: 80, ... }). Matches projects the
// same way the gallery and sumProjectMinutes do.
export function projectTimeSummary(logs, source, title, now = new Date()) {
  const summary = { allTime: 0, thisYear: 0, thisMonth: 0, sessions: 0, byYear: {} };
  for (const log of logs) {
    const minutes = Number(log.minutes) || 0;
    if (minutes <= 0) continue;
    if ((log.source || 'Activity Log') !== source || (log.Projects || 'Untitled Project') !== title) continue;
    summary.allTime += minutes;
    summary.sessions += 1;
    const logYear = Number(log.year);
    summary.byYear[logYear] = (summary.byYear[logYear] || 0) + minutes;
    if (Number(log.year) === now.getFullYear()) {
      summary.thisYear += minutes;
      if (Number(log.monthNumber) === now.getMonth() + 1) summary.thisMonth += minutes;
    }
  }
  return summary;
}
