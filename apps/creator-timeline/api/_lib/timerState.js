// The running project timer as the SERVER holds it, so every device a tenant
// uses sees the same one (see timerStore.js for where it is kept, and
// backlog-photo.js's action: 'timer' for the entry point). This file is the
// pure part -- no I/O -- so the rules can be unit-tested with node:test.
//
// A timer is { version, project, startedAt, pausedAt?, pausedMs, notes,
// photos, updatedAt }:
//   - project: { key, title, source, referenceLogId, projectType?,
//     projectTypeColor? }, the same shape the client keeps;
//   - startedAt / pausedAt / pausedMs: as in src/timeFormat.js's
//     timerElapsedMs. Every timestamp is the SERVER's clock, never a
//     device's, so two devices whose clocks differ by a few seconds still
//     agree on the time spent (each device learns its own offset from the
//     serverNow every response carries);
//   - notes: [{ at, text }] -- appended here, so notes written on two devices
//     at once both survive;
//   - photos: [{ id, at }] -- just the ids; the pictures are stored apart
//     (timerStore.js) because they are too big to ride along;
//   - version: counts changes, so a device can tell nothing moved since it
//     last looked.

import { MAX_SESSION_NOTE_LENGTH, MAX_SESSION_NOTES, MAX_SESSION_PHOTOS } from './timeTracking.js';

// A timer nobody touches for this long is forgotten (the key expires).
export const TIMER_TTL_SECONDS = 3 * 24 * 60 * 60;

// A photo's data URL, as the client sends it (already downscaled). Redis
// refuses very large values, so this is a little under what it takes.
export const MAX_TIMER_PHOTO_DATA_URL_LENGTH = 900000;

const PHOTO_ID_RE = /^[a-z0-9-]{8,40}$/;
const PHOTO_DATA_URL_RE = /^data:image\/(jpeg|png|gif|webp);base64,/;
const MAX_FIELD_LENGTH = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

export class TimerOpError extends Error {}

export const validTimerPhotoId = (id) => typeof id === 'string' && PHOTO_ID_RE.test(id);

export const validTimerPhotoDataUrl = (value) =>
  typeof value === 'string' && value.length <= MAX_TIMER_PHOTO_DATA_URL_LENGTH && PHOTO_DATA_URL_RE.test(value);

const cleanString = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_LENGTH) : '');

// The project a timer is on. The four identifying fields must be there;
// the type and its colour are optional (they only colour the saved entry).
export function sanitizeTimerProject(project) {
  const key = cleanString(project?.key);
  const title = cleanString(project?.title);
  const source = cleanString(project?.source);
  const referenceLogId = cleanString(project?.referenceLogId);
  if (!key || !title || !source || !referenceLogId) throw new TimerOpError('Invalid project');
  const clean = { key, title, source, referenceLogId };
  const projectType = cleanString(project?.projectType);
  const projectTypeColor = cleanString(project?.projectTypeColor);
  if (projectType) clean.projectType = projectType;
  if (projectTypeColor) clean.projectTypeColor = projectTypeColor;
  return clean;
}

// One note's text: one line, trimmed, capped -- as sanitizeSessionNotes does.
const cleanNote = (text) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, MAX_SESSION_NOTE_LENGTH) : '');

const finiteWithin = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;

// What a timer started on a device before the server held timers looks like,
// taken over as it is ('adopt'): its own start time and pauses and notes,
// kept only if they are believable.
function adoptedFields(payload, now) {
  const startedAt = Number(payload.startedAt);
  if (!finiteWithin(startedAt, now - 3 * DAY_MS, now + 60000)) throw new TimerOpError('Invalid start time');
  const fields = { startedAt: Math.min(Math.round(startedAt), now), pausedMs: 0, notes: [] };
  const pausedMs = Number(payload.pausedMs);
  if (Number.isFinite(pausedMs) && pausedMs > 0) fields.pausedMs = Math.round(Math.min(pausedMs, now - fields.startedAt));
  const pausedAt = Number(payload.pausedAt);
  if (finiteWithin(pausedAt, fields.startedAt, now + 60000)) fields.pausedAt = Math.min(Math.round(pausedAt), now);
  if (Array.isArray(payload.notes)) {
    for (const note of payload.notes) {
      const text = cleanNote(note?.text);
      const at = Number(note?.at);
      if (!text || !Number.isFinite(at)) continue;
      fields.notes.push({ at: Math.min(Math.round(at), now), text });
      if (fields.notes.length >= MAX_SESSION_NOTES) break;
    }
  }
  return fields;
}

function touched(timer, changes, now) {
  return { ...timer, ...changes, version: (timer.version || 0) + 1, updatedAt: now };
}

// Applies one operation to the timer (null when none is running) and says
// what came of it: { timer } is the timer afterwards (null if there is none),
// `existing` that a start found one already running, `removedPhotoIds` the
// pictures that should be deleted. Throws TimerOpError for a request that
// can't be honoured (bad input, over a limit). An operation that needs a
// timer but finds none just returns { timer: null }: the timer ended
// somewhere else, and the device asking learns that from the answer.
export function applyTimerOp(timer, op, payload = {}, now = Date.now()) {
  switch (op) {
    case 'get':
      return { timer };

    case 'start':
    case 'adopt': {
      if (timer) return { timer, existing: true };
      const project = sanitizeTimerProject(payload.project);
      const fields = op === 'adopt' ? adoptedFields(payload, now) : { startedAt: now, pausedMs: 0, notes: [] };
      return { timer: { version: 1, project, ...fields, photos: [], updatedAt: now } };
    }

    case 'pause':
      if (!timer) return { timer: null };
      if (timer.pausedAt) return { timer };
      return { timer: touched(timer, { pausedAt: now }, now) };

    case 'resume': {
      if (!timer) return { timer: null };
      if (!timer.pausedAt) return { timer };
      const { pausedAt, ...running } = timer;
      return { timer: touched(running, { pausedMs: (timer.pausedMs || 0) + Math.max(0, now - pausedAt) }, now) };
    }

    case 'addNote': {
      if (!timer) return { timer: null };
      const text = cleanNote(payload.text);
      if (!text) throw new TimerOpError('A note can’t be empty');
      if (timer.notes.length >= MAX_SESSION_NOTES) throw new TimerOpError(`That’s the limit of ${MAX_SESSION_NOTES} notes for one session`);
      return { timer: touched(timer, { notes: [...timer.notes, { at: now, text }] }, now) };
    }

    case 'removeNote': {
      if (!timer) return { timer: null };
      const index = timer.notes.findIndex((note) => note.at === Number(payload.at) && note.text === payload.text);
      if (index === -1) return { timer };
      return { timer: touched(timer, { notes: timer.notes.filter((_, i) => i !== index) }, now) };
    }

    // Rewrites a note's words, keeping when it was written. The note is found
    // the way removeNote finds it (its time and its old text), so an edit made
    // after the note was changed or removed elsewhere finds nothing and is left alone.
    case 'editNote': {
      if (!timer) return { timer: null };
      const index = timer.notes.findIndex((note) => note.at === Number(payload.at) && note.text === payload.text);
      if (index === -1) return { timer };
      const text = cleanNote(payload.newText);
      if (!text) throw new TimerOpError('A note can’t be empty');
      if (text === timer.notes[index].text) return { timer };
      return { timer: touched(timer, { notes: timer.notes.map((note, i) => (i === index ? { ...note, text } : note)) }, now) };
    }

    case 'addPhoto': {
      if (!timer) return { timer: null };
      if (!validTimerPhotoId(payload.id)) throw new TimerOpError('Invalid photo');
      if (timer.photos.some((photo) => photo.id === payload.id)) return { timer };
      if (timer.photos.length >= MAX_SESSION_PHOTOS) throw new TimerOpError(`That’s the limit of ${MAX_SESSION_PHOTOS} photos for one session`);
      return { timer: touched(timer, { photos: [...timer.photos, { id: payload.id, at: now }] }, now) };
    }

    case 'removePhoto': {
      if (!timer) return { timer: null };
      if (!timer.photos.some((photo) => photo.id === payload.id)) return { timer };
      return { timer: touched(timer, { photos: timer.photos.filter((photo) => photo.id !== payload.id) }, now), removedPhotoIds: [payload.id] };
    }

    case 'clear':
      return { timer: null, removedPhotoIds: timer ? timer.photos.map((photo) => photo.id) : [] };

    default:
      throw new TimerOpError('Unknown timer operation');
  }
}
