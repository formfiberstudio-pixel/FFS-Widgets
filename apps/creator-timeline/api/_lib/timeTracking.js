// Shared by backlog-photo.js (the logTime action, which saves a stopped
// project-timer session as a text-only log page) and get-notion-logs.js
// (which reads those sessions back as `minutes` on each log row).
//
// A session is stored two ways at once: a Number property when the
// database has one for time (so totals can be rolled up inside Notion
// itself), and a machine-readable "⏱ 80 min" line in the page body, which
// is what the sync falls back to when the database has no such property.
// That fallback is why no schema change is required to use the timer.

export const TIME_MARKER = '⏱';

// A Number property the tenant's database already has for tracked time,
// matched by name rather than created for them.
const MINUTES_PROP_RE = /^(minutes?|mins?|duration|time(\s*(spent|tracked))?)$/i;

export function findMinutesPropName(properties) {
  const entry = Object.entries(properties || {}).find(
    ([name, value]) => value?.type === 'number' && MINUTES_PROP_RE.test(name.trim())
  );
  return entry ? entry[0] : null;
}

// 80 -> "1h 20m", 45 -> "45m", 120 -> "2h"
export function formatMinutesLabel(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

// Notes jotted while the timer ran: [{ at: "14:12", text }] in, a cleaned
// list out. Anything that isn't a non-empty text note is dropped, runs of
// whitespace (incl. newlines) collapse so each note stays one line, and the
// list and each note are capped. client: src/timeFormat.js mirrors the caps.
export const MAX_SESSION_NOTES = 50;
export const MAX_SESSION_NOTE_LENGTH = 500;

export function sanitizeSessionNotes(notes) {
  if (!Array.isArray(notes)) return [];
  const clean = [];
  for (const note of notes) {
    const text = typeof note?.text === 'string' ? note.text.replace(/\s+/g, ' ').trim().slice(0, MAX_SESSION_NOTE_LENGTH) : '';
    if (!text) continue;
    const at = typeof note.at === 'string' && /^\d{2}:\d{2}$/.test(note.at) ? note.at : '';
    clean.push({ at, text });
    if (clean.length >= MAX_SESSION_NOTES) break;
  }
  return clean;
}

// "⏱ 80 min · 14:05–15:25" (the range is omitted when either end is
// missing), then one "14:12 · note" line per note. Everything lives in the
// ONE first paragraph of the page on purpose: that first text block is the
// note the calendar shows for an entry (see findImageAndTextInBlocks in
// get-notion-logs.js), so the notes show up there too, and the minutes
// marker stays on line 1 where parseMinutesFromNote finds it first.
export function buildSessionNote({ minutes, startLabel, endLabel, notes = [] }) {
  const range = startLabel && endLabel ? ` · ${startLabel}–${endLabel}` : '';
  const lines = [`${TIME_MARKER} ${Math.round(minutes)} min${range}`];
  for (const note of notes) lines.push(note.at ? `${note.at} · ${note.text}` : note.text);
  return lines.join('\n');
}

// Notion caps one rich_text object at 2000 characters, so a long note
// list is split into several objects inside the same paragraph block,
// breaking only between lines.
export function toRichTextChunks(text, limit = 2000) {
  const lines = String(text).split('\n');
  const chunks = [];
  let current = '';
  lines.forEach((line, i) => {
    const piece = i < lines.length - 1 ? `${line}\n` : line;
    if (current && current.length + piece.length > limit) {
      chunks.push(current);
      current = '';
    }
    current += piece;
  });
  if (current) chunks.push(current);
  return chunks.map((content) => ({ text: { content } }));
}

export function parseMinutesFromNote(text) {
  const match = /⏱\s*(\d+)\s*min\b/.exec(String(text || ''));
  return match ? parseInt(match[1], 10) : 0;
}

// Minutes for one log row: the Number property wins when it holds a
// positive value, otherwise the body marker. 0 for an ordinary entry.
export function extractMinutes(properties, pageContent) {
  const propName = findMinutesPropName(properties);
  const value = propName ? properties[propName]?.number : null;
  if (typeof value === 'number' && value > 0) return value;
  return parseMinutesFromNote(pageContent);
}

// Properties for a new session page, shaped from a reference log page the
// same way photo entries are (see backlog-photo.js): title, date, and the
// project relation copied verbatim (or pointed at projectPageId), plus the
// minutes Number property when the database has one. Returns the
// properties and whether a project relation made it in, so the caller can
// refuse to create an entry that would belong to no project.
export function buildSessionProperties(refProperties, { title, dateStr, minutes, projectPageId }) {
  const properties = {};
  let hasRelation = false;
  for (const [name, value] of Object.entries(refProperties || {})) {
    if (value.type === 'title') {
      properties[name] = { title: [{ text: { content: String(title) } }] };
    } else if (value.type === 'date') {
      // Bare YYYY-MM-DD on purpose: see the date note in backlog-photo.js's
      // photo path (a full timestamp would reintroduce a day-shift).
      properties[name] = { date: { start: dateStr } };
    } else if (value.type === 'relation' && value.relation?.length > 0) {
      properties[name] = projectPageId
        ? { relation: [{ id: projectPageId }] }
        : { relation: value.relation.map((r) => ({ id: r.id })) };
      hasRelation = true;
    }
  }
  const minutesProp = findMinutesPropName(refProperties);
  if (minutesProp) properties[minutesProp] = { number: Math.round(minutes) };
  return { properties, hasRelation };
}
