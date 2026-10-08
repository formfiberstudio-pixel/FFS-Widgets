import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cleanNoteText, clockLabel, dialSweepDegrees, formatClock, formatDuration, formatMinutes, localDateString, MAX_SESSION_NOTE_LENGTH, MAX_SESSION_NOTES, MAX_SESSION_PHOTOS, MAX_TIMER_PHOTO_DATA_URL_LENGTH, timerElapsedMs } from './timeFormat.js';
import { resizeImageForUpload } from './imageResize.js';
import { canReadClipboardImages, imageFilesFromClipboardData, readClipboardImageFiles } from './clipboardImages.js';
import { deleteTimerPhotos, getTimerPhoto, pruneTimerPhotos, putTimerPhoto } from './timerPhotos.js';

// One running timer per tenant. For a real tenant it lives on the SERVER (see
// api/_lib/timerState.js), so every device they use shows the same one and can
// add notes and photos to it: each action here is sent to the server, which
// answers with the timer as it now stands, and this device checks back every
// so often (and whenever the page is looked at again) to pick up what the
// others did. A copy is kept in localStorage so a reload (or the Android
// WebView being reclaimed) shows it at once while the server is asked.
// Demo mode (no tenant) runs entirely locally, as the timer first did.
//
// Elapsed time is always derived from `startedAt`, never counted by ticks, so a
// throttled background tab can't drift. The server stamps every time with its
// own clock, and each answer says what that clock reads now, so a device
// whose clock is off keeps `clockOffset` (server minus this device) and adds it
// to its own to show the same time as the others.
const storageKey = (key) => `notionWidgetTimer:${key}`;

function readStored(key) {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const timer = JSON.parse(raw);
    return timer && timer.project && typeof timer.startedAt === 'number' ? timer : null;
  } catch {
    return null;
  }
}

function writeStored(key, timer) {
  if (!key) return;
  try {
    if (timer) localStorage.setItem(storageKey(key), JSON.stringify(timer));
    else localStorage.removeItem(storageKey(key));
  } catch { /* storage unavailable -- the timer still works for this session */ }
}

// How often a device checks the server for changes made elsewhere: sooner
// while a timer is running, since that is when something may change.
const POLL_RUNNING_MS = 15000;
const POLL_IDLE_MS = 45000;

// One request to the server's timer, resolving to its answer plus this
// device's clockOffset (the server's clock minus its own, taken to be half a
// round trip old).
async function timerRequest(tenantId, op, fields = {}) {
  const sent = Date.now();
  let response;
  try {
    response = await fetch('/api/backlog-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, action: 'timer', op, ...fields }),
    });
  } catch {
    // The browser's own message ("Failed to fetch") says nothing useful.
    throw new Error('Couldn’t reach the server — check your connection');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error || 'Couldn’t reach the timer right now');
  return { ...result, clockOffset: Math.round(result.serverNow - (sent + Date.now()) / 2) };
}

// The server's timer as this device keeps it.
const fromServer = (result) => (result.timer ? { ...result.timer, synced: true, clockOffset: result.clockOffset } : null);

// The time right now on the server's clock, as best this device can tell.
const nowFor = (timer) => Date.now() + (timer?.clockOffset || 0);

// A photo is downscaled -- smaller each try -- until it fits what the server
// will take; null when it never does (an animated GIF over the limit).
const PHOTO_RESIZE_STEPS = [[1400, 0.78], [1100, 0.68], [800, 0.6]];

async function prepareTimerPhoto(file) {
  for (const [maxDim, quality] of PHOTO_RESIZE_STEPS) {
    const dataUrl = await resizeImageForUpload(file, maxDim, quality);
    if (dataUrl.length <= MAX_TIMER_PHOTO_DATA_URL_LENGTH) return dataUrl;
    if (file.type === 'image/gif') break; // passed through as it is: smaller settings change nothing
  }
  return null;
}

// timer shape: { project: { key, title, source, referenceLogId }, startedAt,
// pausedMs?, pausedAt?, notes?, photos?, version?, synced?, clockOffset?,
// endedAt?, error? }. notes is the list of { at: ms timestamp, text } jotted
// while it ran, saved with the session when it's stopped. photos is the list
// of { id, at } for pictures added while it ran: the pictures themselves are
// kept by the server (and cached on this device, see timerPhotos.js) and go up
// with the session, ahead of the notes. pausedAt is set only while the
// timer is paused and pausedMs totals the pauses already resumed from, so
// time spent = timerElapsedMs() (see timeFormat.js), never wall-clock span.
// version / synced / clockOffset come from the server. endedAt/error only
// exist while a finished session failed to save and is waiting on Retry or
// Discard -- that one is this device's alone.
export function useProjectTimer({ tenantId, isDemoMode, onSessionSaved }) {
  // Demo mode has no tenant; the timer then runs entirely locally.
  const key = tenantId || (isDemoMode ? 'demo' : null);
  const remote = !!tenantId && !isDemoMode;
  const keyRef = useRef(key);
  keyRef.current = key;
  const onSavedRef = useRef(onSessionSaved);
  onSavedRef.current = onSessionSaved;

  const [timer, setTimer] = useState(() => readStored(key));
  // The latest timer, readable from async work (adding photos) that may
  // finish after the timer has moved on.
  const timerRef = useRef(timer);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const noticeTimeout = useRef(null);
  // Requests this device has under way. While any are, a check of the server
  // is skipped (its answer could be older than the one coming back).
  const inFlight = useRef(0);
  const pulling = useRef(false);

  // The tenant id arrives after first render in real use.
  useEffect(() => {
    const stored = readStored(key);
    timerRef.current = stored;
    setTimer(stored);
    // Photos no running timer lists are left over; clear them. Not while the
    // key is still unknown, or a reload's photos would be dropped before
    // the tenant id arrives and the timer they belong to is found.
    if (key) pruneTimerPhotos((stored?.photos || []).map((photo) => photo.id));
  }, [key]);
  useEffect(() => () => clearTimeout(noticeTimeout.current), []);

  const flash = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimeout.current);
    noticeTimeout.current = setTimeout(() => setNotice(''), 4000);
  }, []);

  const commit = useCallback((next) => {
    timerRef.current = next;
    setTimer(next);
    writeStored(keyRef.current, next);
  }, []);

  // Sends one change to the server and shows the timer as it answers. With
  // `optimistic` the change shows at once (and is taken back if the server
  // refuses it); without, the screen waits for the answer. Resolves to the
  // server's answer, or null when it failed.
  const run = useCallback(async (op, fields, optimistic) => {
    const before = timerRef.current;
    if (optimistic !== undefined) commit(optimistic);
    inFlight.current += 1;
    try {
      const result = await timerRequest(tenantId, op, fields);
      commit(fromServer(result));
      return result;
    } catch (err) {
      if (optimistic !== undefined) commit(before);
      flash(err.message || 'Couldn’t reach the timer right now');
      return null;
    } finally {
      inFlight.current -= 1;
    }
  }, [tenantId, commit, flash]);

  // A picture of the session: the copy on this device, or -- for one added on
  // another device -- fetched from the server and kept here.
  const loadPhoto = useCallback(async (id) => {
    const local = await getTimerPhoto(id);
    if (local || !remote) return local;
    try {
      const result = await timerRequest(tenantId, 'getPhoto', { id });
      if (!result.imageBase64) return null;
      await putTimerPhoto(id, result.imageBase64);
      return result.imageBase64;
    } catch {
      return null;
    }
  }, [remote, tenantId]);

  // A timer started before the server held timers exists only on this device.
  // Hand it over (its start, pauses, notes, then its photos one by one) so the
  // other devices see it too.
  const adoptLocal = useCallback(async (local) => {
    inFlight.current += 1;
    try {
      let latest = await timerRequest(tenantId, 'adopt', {
        project: local.project,
        startedAt: local.startedAt,
        pausedAt: local.pausedAt,
        pausedMs: local.pausedMs,
        notes: local.notes || [],
      });
      for (const photo of local.photos || []) {
        const dataUrl = await getTimerPhoto(photo.id);
        if (!dataUrl) continue;
        latest = await timerRequest(tenantId, 'addPhoto', { id: photo.id, imageBase64: dataUrl });
      }
      commit(fromServer(latest));
    } catch { /* offline: it stays on this device and is offered again next time */ } finally {
      inFlight.current -= 1;
    }
  }, [tenantId, commit]);

  // Looks at the server's timer and brings this device in line with it: one
  // started elsewhere appears, one stopped elsewhere goes, changes show up.
  const pull = useCallback(async () => {
    if (!remote || pulling.current || inFlight.current > 0) return;
    if (timerRef.current?.endedAt) return; // a failed save waiting on Retry is this device's alone
    pulling.current = true;
    try {
      const result = await timerRequest(tenantId, 'get');
      // Something of ours began while the answer was on its way: that is newer.
      if (inFlight.current > 0) return;
      const current = timerRef.current;
      if (current?.endedAt) return;
      const server = result.timer;
      if (server) {
        if (!current || current.version !== server.version || current.project.key !== server.project.key) {
          commit(fromServer(result));
        } else if (Math.abs((current.clockOffset || 0) - result.clockOffset) > 1500) {
          commit({ ...current, clockOffset: result.clockOffset });
        }
      } else if (current) {
        if (current.synced) {
          deleteTimerPhotos((current.photos || []).map((photo) => photo.id));
          commit(null);
          flash('That timer was stopped on another device');
        } else {
          await adoptLocal(current);
        }
      }
    } catch { /* offline: keep showing what this device has */ } finally {
      pulling.current = false;
    }
  }, [remote, tenantId, commit, flash, adoptLocal]);

  const hasTimer = !!timer;
  useEffect(() => {
    if (!remote) return undefined;
    pull();
    const id = setInterval(() => { if (!document.hidden) pull(); }, hasTimer ? POLL_RUNNING_MS : POLL_IDLE_MS);
    const onVisible = () => { if (!document.hidden) pull(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [remote, hasTimer, pull]);

  // Saves a finished session; true on success. On failure the session stays
  // in the chip (with the error) so no tracked time is lost.
  const save = useCallback(async (session, endedAt) => {
    const notes = (session.notes || []).map((n) => ({ at: clockLabel(new Date(n.at)), text: n.text }));
    const photoIds = (session.photos || []).map((photo) => photo.id);
    // A session under a minute is normally dropped (see stop), but one with
    // notes or photos is kept as 1 minute so what was added isn't lost.
    const minutes = Math.max(notes.length || photoIds.length ? 1 : 0, Math.round(timerElapsedMs({ ...session, endedAt }) / 60000));
    const started = new Date(session.startedAt);
    const ended = new Date(endedAt);
    const dateStr = localDateString(started);
    const startLabel = clockLabel(started);
    const endLabel = clockLabel(ended);
    setSaving(true);
    inFlight.current += 1;
    try {
      // The first photo, to show as the new entry's picture straight away
      // (one that has gone missing is just left out).
      const firstPhoto = photoIds.length ? await loadPhoto(photoIds[0]) : null;
      let pageId;
      let alreadySaved = false;
      if (!remote) {
        pageId = `demo-timer-${endedAt}`;
      } else {
        // The pictures are already on the server, so each is uploaded to Notion
        // by id, one request each (a request can't carry them all), in the order
        // taken; the session then attaches them together. One the server no
        // longer has (the session was saved from another device) is skipped.
        const photoUploadIds = [];
        for (const id of photoIds) {
          const upload = await fetch('/api/backlog-photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId, action: 'uploadTimerPhoto', timerPhotoId: id }),
          });
          if (upload.status === 404) continue;
          const uploaded = await upload.json().catch(() => ({}));
          if (!upload.ok || !uploaded.success) throw new Error(uploaded.error || 'Could not upload a photo');
          photoUploadIds.push(uploaded.fileUploadId);
        }
        const response = await fetch('/api/backlog-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            action: 'logTime',
            referenceLogId: session.project.referenceLogId,
            projectTitle: session.project.title,
            minutes,
            dateTaken: dateStr,
            startLabel,
            endLabel,
            notes,
            // Lets the server make ONE entry when two devices press Stop at once,
            // and clear the running timer when it is saved.
            sessionStartedAt: session.startedAt,
            ...(photoUploadIds.length ? { photoUploadIds } : {}),
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || 'Could not save to Notion');
        pageId = result.pageId;
        alreadySaved = !!result.duplicate;
      }
      commit(null);
      deleteTimerPhotos(photoIds);
      if (alreadySaved) {
        flash('That session was already saved from another device');
        return true;
      }
      onSavedRef.current?.({ id: pageId, project: session.project, minutes, dateStr, startLabel, endLabel, notes, photos: firstPhoto ? [firstPhoto] : [] });
      const extras = [
        photoIds.length ? `${photoIds.length} photo${photoIds.length === 1 ? '' : 's'}` : '',
        notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' and ');
      flash(`Saved ${formatMinutes(minutes)}${extras ? ` with ${extras}` : ''} to ${session.project.title}${isDemoMode ? ' (demo only)' : ''}`);
      return true;
    } catch (err) {
      commit({ ...session, endedAt, error: err.message || 'Could not save' });
      return false;
    } finally {
      inFlight.current -= 1;
      setSaving(false);
    }
  }, [remote, tenantId, isDemoMode, commit, flash, loadPhoto]);

  const stop = useCallback(async () => {
    let current = timerRef.current;
    if (!current || current.endedAt) return false;
    if (remote) {
      // Look first: notes and photos added from another device belong to this
      // session, and it may already have been stopped over there.
      try {
        const result = await timerRequest(tenantId, 'get');
        if (!result.timer) {
          deleteTimerPhotos((current.photos || []).map((photo) => photo.id));
          commit(null);
          flash('That timer was already stopped on another device');
          return true;
        }
        current = fromServer(result);
        commit(current);
      } catch { /* offline: stop with what this device has */ }
    }
    // Stopping while paused ends the session at the moment of the pause, so
    // the time spent paused isn't counted.
    const endedAt = current.pausedAt ?? nowFor(current);
    if (timerElapsedMs({ ...current, endedAt }) < 60000 && !current.notes?.length && !current.photos?.length) {
      if (remote) await timerRequest(tenantId, 'clear').catch(() => {});
      commit(null);
      flash('Under a minute, so it wasn’t logged');
      return true;
    }
    return save(current, endedAt);
  }, [remote, tenantId, commit, flash, save]);

  const start = useCallback(async (project) => {
    if (!keyRef.current) return;
    const current = timerRef.current;
    if (current?.endedAt) { flash('Save or discard the previous session first'); return; }
    if (current && current.project.key === project.key) return;
    // Starting another project saves the current session first; if that
    // save fails, the old session stays put rather than being replaced.
    if (current && !(await stop())) return;
    if (!remote) {
      commit({ project, startedAt: Date.now() });
      return;
    }
    const result = await run('start', { project }, { project, startedAt: Date.now(), version: 0, synced: false });
    // Another device had a timer going already: that one stands.
    if (result?.existing && result.timer && result.timer.project.key !== project.key) {
      flash(`Already tracking ${result.timer.project.title} on another device`);
    }
  }, [remote, stop, commit, flash, run]);

  const discard = useCallback(() => {
    const current = timerRef.current;
    deleteTimerPhotos((current?.photos || []).map((photo) => photo.id));
    if (remote && current) run('clear', {}, null);
    else commit(null);
  }, [remote, commit, run]);

  const addNote = useCallback((text) => {
    const current = timerRef.current;
    if (!current || current.endedAt) return false;
    const clean = cleanNoteText(text);
    if (!clean) return false;
    const notes = current.notes || [];
    if (notes.length >= MAX_SESSION_NOTES) { flash(`That’s the limit of ${MAX_SESSION_NOTES} notes for one session`); return false; }
    const next = { ...current, notes: [...notes, { at: nowFor(current), text: clean }] };
    if (remote) run('addNote', { text: clean }, next);
    else commit(next);
    return true;
  }, [remote, commit, flash, run]);

  // Rewrites the words of note number `index`, keeping its time. True when it
  // went through (or changed nothing); false for an empty note, which is not
  // an edit -- removing a note has its own control.
  const editNote = useCallback((index, text) => {
    const current = timerRef.current;
    const note = current?.notes?.[index];
    if (!current || current.endedAt || !note) return false;
    const clean = cleanNoteText(text);
    if (!clean) return false;
    if (clean === note.text) return true;
    const next = { ...current, notes: current.notes.map((n, i) => (i === index ? { ...n, text: clean } : n)) };
    if (remote) run('editNote', { at: note.at, text: note.text, newText: clean }, next);
    else commit(next);
    return true;
  }, [remote, commit, run]);

  const removeNote = useCallback((index) => {
    const current = timerRef.current;
    const note = current?.notes?.[index];
    if (!current || current.endedAt || !note) return;
    const next = { ...current, notes: current.notes.filter((_, i) => i !== index) };
    if (remote) run('removeNote', { at: note.at, text: note.text }, next);
    else commit(next);
  }, [remote, commit, run]);

  // Adds pictures to the running session: each is downscaled to fit what the
  // server keeps, cached on this device, and listed on the timer by id.
  // Resolves to how many were added.
  const addPhotos = useCallback(async (files) => {
    const started = timerRef.current;
    if (!started || started.endedAt) return 0;
    const room = MAX_SESSION_PHOTOS - (started.photos?.length || 0);
    if (room <= 0) { flash(`That’s the limit of ${MAX_SESSION_PHOTOS} photos for one session`); return 0; }
    const added = [];
    for (const file of Array.from(files).slice(0, room)) {
      try {
        const dataUrl = await prepareTimerPhoto(file);
        if (!dataUrl) { flash('That photo is too large to add'); continue; }
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await putTimerPhoto(id, dataUrl);
        if (remote) {
          // The server takes the picture and answers with the timer listing it.
          const result = await run('addPhoto', { id, imageBase64: dataUrl });
          if (!result) { deleteTimerPhotos([id]); break; }
          if (!result.timer) { deleteTimerPhotos([id]); flash('That timer was stopped on another device'); break; }
        }
        added.push({ id, at: Date.now() });
      } catch {
        flash('Couldn’t read that photo');
      }
    }
    if (!added.length || remote) return added.length;
    const latest = timerRef.current;
    // Stopped or discarded while the pictures were being prepared: they have no timer to join.
    if (!latest || latest.endedAt || latest.startedAt !== started.startedAt) {
      deleteTimerPhotos(added.map((photo) => photo.id));
      return 0;
    }
    commit({ ...latest, photos: [...(latest.photos || []), ...added].slice(0, MAX_SESSION_PHOTOS) });
    return added.length;
  }, [remote, commit, flash, run]);

  const removePhoto = useCallback((id) => {
    const current = timerRef.current;
    if (!current || current.endedAt || !current.photos?.some((photo) => photo.id === id)) return;
    deleteTimerPhotos([id]);
    const next = { ...current, photos: current.photos.filter((photo) => photo.id !== id) };
    if (remote) run('removePhoto', { id }, next);
    else commit(next);
  }, [remote, commit, run]);

  const pause = useCallback(() => {
    const current = timerRef.current;
    if (!current || current.endedAt || current.pausedAt) return;
    const next = { ...current, pausedAt: nowFor(current) };
    if (remote) run('pause', {}, next);
    else commit(next);
  }, [remote, commit, run]);

  const resume = useCallback(() => {
    const current = timerRef.current;
    if (!current || current.endedAt || !current.pausedAt) return;
    const { pausedAt, ...running } = current;
    const next = { ...running, pausedMs: (current.pausedMs || 0) + Math.max(0, nowFor(current) - pausedAt) };
    if (remote) run('resume', {}, next);
    else commit(next);
  }, [remote, commit, run]);

  const retry = useCallback(() => {
    const current = timerRef.current;
    if (!current?.endedAt) return;
    save({ project: current.project, startedAt: current.startedAt, pausedMs: current.pausedMs, notes: current.notes, photos: current.photos }, current.endedAt);
  }, [save]);

  return { timer, saving, notice, start, stop, discard, retry, pause, resume, addNote, editNote, removeNote, addPhotos, removePhoto, loadPhoto };
}

// Ticks once a second, only while `active`, and re-reads the clock when the
// tab becomes visible again. Lives in the chip (not the hook) so the
// per-second re-render stays inside this one small component instead of
// re-rendering the whole calendar.
// `offset` is the server's clock minus this device's (see the top of the file), so
// what this returns is the time on the clock the timer was stamped with.
function useNow(active, offset = 0) {
  const [now, setNow] = useState(() => Date.now() + offset);
  // Refresh before paint when ticking (re)starts, so resuming from a pause
  // never shows a frame computed from the stale pre-pause clock.
  useLayoutEffect(() => { if (active) setNow(Date.now() + offset); }, [active, offset]);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    const onVisible = () => setNow(Date.now() + offset);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, offset]);
  return now;
}

// Show the running time in the browser tab, and put the title back after.
// Whichever of the chip / sidebar card is on screen calls this -- never both
// at once (see App), or they would fight over document.title.
function useTabTitle(live, paused, elapsedSeconds, projectTitle) {
  useEffect(() => {
    if (!live) return undefined;
    const original = document.title;
    document.title = `${paused ? 'Paused ' : ''}${formatDuration(elapsedSeconds * 1000)} · ${projectTitle}`;
    return () => { document.title = original; };
  }, [live, paused, elapsedSeconds, projectTitle]);
}

// Two-step discard: the first press arms it, and it disarms by itself.
function useTwoStepDiscard(onDiscard) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  const press = () => {
    if (armed) { setArmed(false); onDiscard(); } else setArmed(true);
  };
  return [armed, press];
}

const chipButtonClass = 'shrink-0 px-2 py-0.5 rounded-full border text-[11px] font-bold cursor-pointer disabled:opacity-50';

export function TimerChip({ timer, saving, notice, onStop, onDiscard, onRetry, onPause, onResume }) {
  const live = !!timer && !timer.endedAt; // not finished (running or paused)
  const paused = live && !!timer.pausedAt;
  const now = useNow(live && !paused, timer?.clockOffset);
  const elapsed = timer ? timerElapsedMs(timer, now) : 0;
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const [discardArmed, pressDiscard] = useTwoStepDiscard(onDiscard);
  useTabTitle(live, paused, elapsedSeconds, timer?.project.title);

  if (!timer && !notice) return null;

  const outline = { backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' };

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 max-w-full rounded-full border px-3 py-1.5 shadow-sm text-xs"
      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-primary)', color: 'var(--theme-text)' }}
    >
      {timer ? (
        <>
          <span className={`w-2 h-2 rounded-full shrink-0 ${live && !paused ? 'animate-pulse' : ''}`} style={{ backgroundColor: 'var(--theme-primary)' }} />
          <span className="truncate min-w-0 font-semibold" title={timer.project.title}>{timer.project.title}</span>
          <span className={`shrink-0 font-bold tabular-nums ${paused ? 'opacity-60' : ''}`}>{formatDuration(elapsed)}</span>
          {live && (
            <button
              onClick={paused ? onResume : onPause}
              disabled={saving}
              title={paused ? 'Resume the timer' : 'Pause the timer'}
              aria-label={paused ? `Resume the timer on ${timer.project.title}` : `Pause the timer on ${timer.project.title}`}
              style={{ ...outline, borderColor: 'var(--theme-primary)' }}
              className={`${chipButtonClass} flex items-center`}
            >
              {paused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}
            </button>
          )}
          {timer.error ? (
            <>
              <span className="truncate min-w-0 opacity-70" title={timer.error}>Couldn&rsquo;t save</span>
              <button onClick={onRetry} disabled={saving} style={outline} className={chipButtonClass}>{saving ? 'Saving…' : 'Retry'}</button>
            </>
          ) : (
            <button onClick={onStop} disabled={saving} style={{ ...outline, borderColor: 'var(--theme-primary)' }} className={chipButtonClass}>
              {saving ? 'Saving…' : '■ Stop'}
            </button>
          )}
          <button
            onClick={pressDiscard}
            disabled={saving}
            title="Discard this session without saving it"
            style={outline}
            className={chipButtonClass}
          >
            {discardArmed ? 'Discard?' : '✕'}
          </button>
          {notice && <span className="truncate min-w-0 opacity-70">{notice}</span>}
        </>
      ) : (
        <span className="truncate min-w-0">{notice}</span>
      )}
    </div>
  );
}

// Pie sector from 12 o'clock clockwise by `degrees` (0 < degrees < 360).
function sectorPath(cx, cy, r, degrees) {
  const rad = (degrees * Math.PI) / 180;
  const x = cx + r * Math.sin(rad);
  const y = cy - r * Math.cos(rad);
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${degrees > 180 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

const roundButtonClass = 'w-11 h-11 rounded-full border-2 flex items-center justify-center text-base leading-none cursor-pointer disabled:opacity-50 transition-transform hover:scale-105';

const PauseIcon = ({ size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

const PlayIcon = ({ size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
  </svg>
);

// One photo of the session, loaded back from this device by its id.
function TimerPhotoThumb({ id, readOnly, onRemove, onLoadPhoto }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    (onLoadPhoto || getTimerPhoto)(id).then((dataUrl) => { if (alive) setSrc(dataUrl); });
    return () => { alive = false; };
  }, [id, onLoadPhoto]);
  return (
    <div className="relative aspect-square overflow-hidden border" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-card)', borderRadius: 'var(--theme-radius-sm, 0.25rem)' }}>
      {src && <img src={src} alt="A photo added to this session" className="w-full h-full object-cover" />}
      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove this photo"
          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] leading-none cursor-pointer"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff' }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

// Photos for the running session. They go up with the session on Stop, saved
// FIRST in the Notion entry -- above the notes -- so a gallery view of the
// database previews them. Add them from a file (or the camera on a phone), or
// paste a copied image: Ctrl/Cmd+V anywhere on the page, or the Paste button.
// Read-only once the session has ended (a failed save waiting on Retry).
function TimerPhotos({ photos, readOnly, onAdd, onRemove, onLoadPhoto }) {
  const inputRef = useRef(null);
  const [adding, setAdding] = useState(false);
  const [hint, setHint] = useState('');

  const addFiles = useCallback(async (files) => {
    setHint('');
    setAdding(true);
    try { await onAdd(files); } finally { setAdding(false); }
  }, [onAdd]);

  // A paste with an image on the clipboard adds it, wherever the pointer or
  // focus is -- an image can't mean anything else here. A paste of text is
  // left alone, so typing a note still pastes normally.
  useEffect(() => {
    if (readOnly) return undefined;
    const onPaste = (e) => {
      const files = imageFilesFromClipboardData(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [readOnly, addFiles]);

  if (readOnly && !photos.length) return null;
  const full = photos.length >= MAX_SESSION_PHOTOS;

  const pick = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length) await addFiles(files);
  };
  const pasteFromClipboard = async () => {
    setHint('');
    try {
      const files = await readClipboardImageFiles();
      if (!files.length) { setHint('There’s no image on the clipboard — copy one first.'); return; }
      await addFiles(files);
    } catch {
      setHint('Couldn’t read the clipboard here — press Ctrl/⌘+V to paste instead.');
    }
  };
  const actionClass = 'text-[11px] font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default';

  return (
    <div className="w-full mt-3 pt-3 border-t text-left" style={{ borderColor: 'var(--theme-border)' }}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">
          Photos{photos.length ? ` · ${photos.length}` : ''}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-3">
            <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={pick} />
            {canReadClipboardImages() && (
              <button
                type="button"
                onClick={pasteFromClipboard}
                disabled={adding || full}
                title="Add the image you have copied (or press Ctrl/⌘+V)"
                className={actionClass}
                style={{ color: 'var(--theme-primary)' }}
              >
                Paste
              </button>
            )}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={adding || full}
              title={full ? `That’s the limit of ${MAX_SESSION_PHOTOS} photos for one session` : 'Add photos to this session'}
              className={actionClass}
              style={{ color: 'var(--theme-primary)' }}
            >
              {adding ? 'Adding…' : '+ Add photo'}
            </button>
          </div>
        )}
      </div>
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {photos.map((photo) => (
            <TimerPhotoThumb key={photo.id} id={photo.id} readOnly={readOnly} onRemove={() => onRemove(photo.id)} onLoadPhoto={onLoadPhoto} />
          ))}
        </div>
      )}
      {hint && <p role="status" className="text-[10px] mt-1.5" style={{ color: 'var(--theme-secondary)' }}>{hint}</p>}
      {!readOnly && <p className="text-[10px] opacity-60 mt-1.5">Saved to Notion first, above the notes, when you stop. You can also paste an image with Ctrl/⌘+V.</p>}
    </div>
  );
}

// Notes for the running session: a one-line input and the list so far. They
// stay in the timer (so a reload keeps them) and are uploaded to Notion with
// the session on Stop. Read-only once the session has ended (a failed save
// waiting on Retry), so what's kept is still visible but can't change.
function TimerNotes({ notes, readOnly, onAdd, onEdit, onRemove }) {
  const [draft, setDraft] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (onAdd(draft)) setDraft('');
  };

  // The note being reworded, if any: its position and the words so far. It is
  // kept when you click away or press Enter, so a note edited just before
  // Stop & save is saved as edited; Esc puts the old words back.
  const [editing, setEditingState] = useState(null); // { index, text }
  // The same, readable at once: a click-away, Enter and the ✕ below can follow
  // each other before a re-render, and each edit must be applied only once --
  // a late one could land on a different note after another was removed.
  const editingRef = useRef(null);
  const setEditing = (value) => { editingRef.current = value; setEditingState(value); };
  const startEditing = (index) => {
    if (readOnly) return;
    if (editingRef.current) finishEditing();
    setEditing({ index, text: notes[index].text });
  };
  const finishEditing = () => {
    const current = editingRef.current;
    setEditing(null);
    if (!current) return;
    // An emptied note is not an edit (✕ removes one): the old words stay.
    onEdit(current.index, current.text);
  };
  const cancelEditing = () => setEditing(null);
  return (
    <div className="w-full mt-3 pt-3 border-t text-left" style={{ borderColor: 'var(--theme-border)' }}>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70 mb-1.5">
        Notes{notes.length ? ` · ${notes.length}` : ''}
      </div>
      {!readOnly && (
        <form onSubmit={submit} className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_SESSION_NOTE_LENGTH}
            placeholder="Add a note…"
            aria-label="Add a note to this session"
            className="select-text min-w-0 flex-1 rounded-full border px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
            style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
          />
          <button
            type="submit"
            disabled={!cleanNoteText(draft)}
            className="shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-default"
            style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-primary)', color: 'var(--theme-text)' }}
          >
            Add
          </button>
        </form>
      )}
      {notes.length > 0 && (
        <ul className="mt-2 space-y-1.5 max-h-28 overflow-y-auto pr-1">
          {notes.map((note, i) => (
            <li key={`${note.at}-${i}`} className="flex items-start gap-2 text-xs leading-snug">
              <span className="shrink-0 tabular-nums opacity-60">{clockLabel(new Date(note.at))}</span>
              {editing?.index === i ? (
                <input
                  autoFocus
                  value={editing.text}
                  onChange={(e) => setEditing({ index: i, text: e.target.value })}
                  onBlur={finishEditing}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); finishEditing(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
                  }}
                  maxLength={MAX_SESSION_NOTE_LENGTH}
                  aria-label="Edit this note"
                  className="select-text min-w-0 flex-1 rounded border px-2 py-0.5 text-xs outline-none focus:ring-2 focus:ring-[var(--theme-primary)]"
                  style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-primary)', color: 'var(--theme-text)' }}
                />
              ) : (
                <span
                  onClick={() => startEditing(i)}
                  title={readOnly ? undefined : 'Click to edit'}
                  className={`select-text min-w-0 flex-1 break-words ${readOnly ? '' : 'cursor-text'}`}
                >
                  {note.text}
                </span>
              )}
              {!readOnly && editing?.index !== i && (
                <button onClick={() => startEditing(i)} aria-label="Edit this note" title="Edit" className="shrink-0 leading-none opacity-50 hover:opacity-100 cursor-pointer">✎</button>
              )}
              {!readOnly && (
                // onMouseDown keeps focus on a note being edited, so the click
                // is not eaten by that note's own blur re-rendering the list.
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    // Another note's unsaved wording is kept; this note's own is moot.
                    if (editingRef.current && editingRef.current.index !== i) finishEditing(); else cancelEditing();
                    onRemove(i);
                  }}
                  aria-label="Remove this note"
                  className="shrink-0 leading-none opacity-50 hover:opacity-100 cursor-pointer"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && <p className="text-[10px] opacity-60 mt-1.5">Saved to Notion with the session when you stop.</p>}
    </div>
  );
}

// The sidebar's spotlight on the project being tracked: a dial that fills
// round the hour (45:24 in is three-quarters full) with the clock in its
// middle, echoing the Life Log timer. Tints come from --theme-primary at a
// partial opacity rather than a fixed colour, so the digits (--theme-text)
// stay readable on every theme preset. Rendered instead of TimerChip while
// the sidebar is open, so only one of them ever ticks.
//
// The whole dial -- digits included, since they're SVG text -- scales with
// the card's width, so it follows the sidebar as it's dragged wider or
// narrower (and fills the phone overlay). It's capped so a very wide
// sidebar or a short window never lets it swallow the project list.
export function ActiveTimerCard({ timer, saving, notice, loggedMinutes, onStop, onDiscard, onRetry, onPause, onResume, onAddNote, onEditNote, onRemoveNote, onAddPhotos, onRemovePhoto, onLoadPhoto }) {
  const live = !timer.endedAt; // not finished (running or paused)
  const paused = live && !!timer.pausedAt;
  const now = useNow(live && !paused, timer.clockOffset);
  const elapsed = timerElapsedMs(timer, now);
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const [discardArmed, pressDiscard] = useTwoStepDiscard(onDiscard);
  useTabTitle(live, paused, elapsedSeconds, timer.project.title);

  const degrees = dialSweepDegrees(elapsed);
  const detail = [
    timer.project.source !== 'Activity Log' ? timer.project.source : '',
    `Started ${clockLabel(new Date(timer.startedAt))}`,
  ].filter(Boolean).join(' · ');
  const outline = { backgroundColor: 'var(--theme-card)', color: 'var(--theme-text)' };
  const eyebrow = !live ? 'Not saved yet' : paused ? 'Paused' : 'Now tracking';

  return (
    <section
      aria-label="Active project timer"
      className="shrink-0 mb-3 border p-3 flex flex-col items-center text-center gap-1"
      style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-primary)', color: 'var(--theme-text)', borderRadius: 'var(--theme-radius-lg, 1rem)' }}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider opacity-70">
        <span className={`w-2 h-2 rounded-full ${live && !paused ? 'animate-pulse' : ''}`} style={{ backgroundColor: 'var(--theme-primary)' }} />
        {eyebrow}
      </div>
      <div className="w-full text-sm font-bold leading-snug line-clamp-2 break-words" title={timer.project.title}>{timer.project.title}</div>

      <div
        role="timer"
        aria-label={`${paused ? 'Paused at ' : 'Elapsed '}${formatDuration(elapsed)}`}
        className="my-1 aspect-square"
        style={{ width: 'min(100%, 240px, 32vh)' }}
      >
        <svg viewBox="0 0 160 160" className="block w-full h-full" aria-hidden="true">
          <circle cx="80" cy="80" r="74" fill="var(--theme-primary)" fillOpacity="0.14" stroke="var(--theme-primary)" strokeOpacity="0.5" strokeWidth="2" />
          {degrees > 0 && <path d={sectorPath(80, 80, 74, degrees)} fill="var(--theme-primary)" fillOpacity={paused ? 0.3 : 0.45} />}
          {[0, 90, 180, 270].map((deg) => (
            <line key={deg} x1="80" y1="9" x2="80" y2="17" stroke="var(--theme-text)" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" transform={`rotate(${deg} 80 80)`} />
          ))}
          {/* Marker on the sweep's leading edge, kept to the rim so it never crosses the digits. */}
          <line x1="80" y1="6" x2="80" y2="22" stroke="var(--theme-primary)" strokeWidth="3.5" strokeLinecap="round" transform={`rotate(${degrees} 80 80)`} />
          <text
            x="80"
            y="80"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="27"
            fontWeight="700"
            letterSpacing="-0.5"
            fill="var(--theme-text)"
            fillOpacity={paused ? 0.6 : 1}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatClock(elapsed)}
          </text>
        </svg>
      </div>

      <div className="text-[11px] opacity-70">{detail}</div>
      {loggedMinutes > 0 && <div className="text-[11px] opacity-70">{formatMinutes(loggedMinutes)} logged before this</div>}

      {timer.error && (
        <div className="text-[11px] font-semibold mt-1 w-full break-words" title={timer.error}>
          Couldn&rsquo;t save the {formatMinutes(Math.round(elapsed / 60000))} &mdash; it&rsquo;s kept here until you retry.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-center gap-x-4 gap-y-2 mt-2">
        {live && (
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={paused ? onResume : onPause}
              disabled={saving}
              aria-label={paused ? `Resume the timer on ${timer.project.title}` : `Pause the timer on ${timer.project.title}`}
              style={{ ...outline, borderColor: 'var(--theme-primary)' }}
              className={roundButtonClass}
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <span className="text-[10px] font-semibold opacity-70">{paused ? 'Resume' : 'Pause'}</span>
          </div>
        )}
        <div className="flex flex-col items-center gap-1">
          {timer.error ? (
            <button onClick={onRetry} disabled={saving} aria-label="Retry saving this session" style={{ ...outline, borderColor: 'var(--theme-primary)' }} className={roundButtonClass}>{saving ? '…' : '↻'}</button>
          ) : (
            <button onClick={onStop} disabled={saving} aria-label={`Stop and save the timer on ${timer.project.title}`} style={{ ...outline, borderColor: 'var(--theme-primary)' }} className={roundButtonClass}>{saving ? '…' : '■'}</button>
          )}
          <span className="text-[10px] font-semibold opacity-70">{timer.error ? 'Retry' : saving ? 'Saving…' : 'Stop & save'}</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={pressDiscard}
            disabled={saving}
            aria-label="Discard this session without saving it"
            style={{ ...outline, borderColor: discardArmed ? 'var(--theme-text)' : 'var(--theme-border)' }}
            className={roundButtonClass}
          >
            ✕
          </button>
          <span className="text-[10px] font-semibold opacity-70">{discardArmed ? 'Tap again' : 'Discard'}</span>
        </div>
      </div>

      <TimerPhotos photos={timer.photos || []} readOnly={!live} onAdd={onAddPhotos} onRemove={onRemovePhoto} onLoadPhoto={onLoadPhoto} />
      <TimerNotes notes={timer.notes || []} readOnly={!live} onAdd={onAddNote} onEdit={onEditNote} onRemove={onRemoveNote} />

      {notice && <div className="text-[11px] opacity-70 mt-1">{notice}</div>}
    </section>
  );
}

// What the project's own gallery shows above its year-by-year calendar: the
// total time tracked on it (see projectTimeSummary in timeFormat.js).
export function ProjectTimeSummary({ summary }) {
  const stat = (label, minutes) => (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{formatMinutes(minutes)}</div>
    </div>
  );
  return (
    <section
      aria-label="Time worked on this project"
      className="border px-3 py-2.5 shadow-sm"
      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)', borderRadius: 'var(--theme-radius-md, 0.5rem)' }}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Time worked</div>
      {summary.allTime > 0 ? (
        <>
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-bold tabular-nums leading-none">{formatMinutes(summary.allTime)}</span>
            <span className="text-xs opacity-70">all time · {summary.sessions} session{summary.sessions === 1 ? '' : 's'}</span>
          </div>
          <div className="mt-2 flex gap-6">
            {stat('This year', summary.thisYear)}
            {stat('This month', summary.thisMonth)}
          </div>
        </>
      ) : (
        <div className="mt-1 text-xs opacity-60">Nothing tracked yet. Start the timer from this project in the sidebar list.</div>
      )}
    </section>
  );
}
