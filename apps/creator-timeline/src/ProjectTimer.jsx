import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cleanNoteText, clockLabel, dialSweepDegrees, formatClock, formatDuration, formatMinutes, localDateString, MAX_SESSION_NOTE_LENGTH, MAX_SESSION_NOTES, timerElapsedMs } from './timeFormat.js';

// One running timer per tenant, kept in localStorage so a reload (or the
// Android WebView being reclaimed) doesn't lose it. Elapsed time is always
// derived from `startedAt`, never counted by ticks, so a throttled
// background tab can't drift. A running timer is local to this browser;
// only the finished session is saved to Notion.
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

// timer shape: { project: { key, title, source, referenceLogId }, startedAt,
// pausedMs?, pausedAt?, notes?, endedAt?, error? }. notes is the list of
// { at: ms timestamp, text } jotted while it ran, uploaded with the session
// when it's stopped. pausedAt is set only while the
// timer is paused and pausedMs totals the pauses already resumed from, so
// time spent = timerElapsedMs() (see timeFormat.js), never wall-clock span.
// endedAt/error only exist while a finished session failed to save and is
// waiting on Retry or Discard.
export function useProjectTimer({ tenantId, isDemoMode, onSessionSaved }) {
  // Demo mode has no tenant; the timer then runs entirely locally.
  const key = tenantId || (isDemoMode ? 'demo' : null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const onSavedRef = useRef(onSessionSaved);
  onSavedRef.current = onSessionSaved;

  const [timer, setTimer] = useState(() => readStored(key));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const noticeTimeout = useRef(null);

  // The tenant id arrives after first render in real use.
  useEffect(() => { setTimer(readStored(key)); }, [key]);
  useEffect(() => () => clearTimeout(noticeTimeout.current), []);

  const flash = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimeout.current);
    noticeTimeout.current = setTimeout(() => setNotice(''), 4000);
  }, []);

  const commit = useCallback((next) => {
    setTimer(next);
    writeStored(keyRef.current, next);
  }, []);

  // Saves a finished session; true on success. On failure the session stays
  // in the chip (with the error) so no tracked time is lost.
  const save = useCallback(async (session, endedAt) => {
    const notes = (session.notes || []).map((n) => ({ at: clockLabel(new Date(n.at)), text: n.text }));
    // A session under a minute is normally dropped (see stop), but one with
    // notes is kept as 1 minute so what was written isn't lost.
    const minutes = Math.max(notes.length ? 1 : 0, Math.round(timerElapsedMs({ ...session, endedAt }) / 60000));
    const started = new Date(session.startedAt);
    const ended = new Date(endedAt);
    const dateStr = localDateString(started);
    const startLabel = clockLabel(started);
    const endLabel = clockLabel(ended);
    setSaving(true);
    try {
      let pageId;
      if (isDemoMode || !tenantId) {
        pageId = `demo-timer-${endedAt}`;
      } else {
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
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || 'Could not save to Notion');
        pageId = result.pageId;
      }
      commit(null);
      onSavedRef.current?.({ id: pageId, project: session.project, minutes, dateStr, startLabel, endLabel, notes });
      const withNotes = notes.length ? ` with ${notes.length} note${notes.length === 1 ? '' : 's'}` : '';
      flash(`Saved ${formatMinutes(minutes)}${withNotes} to ${session.project.title}${isDemoMode ? ' (demo only)' : ''}`);
      return true;
    } catch (err) {
      commit({ ...session, endedAt, error: err.message || 'Could not save' });
      return false;
    } finally {
      setSaving(false);
    }
  }, [tenantId, isDemoMode, commit, flash]);

  const stop = useCallback(async () => {
    if (!timer || timer.endedAt) return false;
    // Stopping while paused ends the session at the moment of the pause, so
    // the time spent paused isn't counted.
    const endedAt = timer.pausedAt ?? Date.now();
    if (timerElapsedMs({ ...timer, endedAt }) < 60000 && !timer.notes?.length) {
      commit(null);
      flash('Under a minute, so it wasn’t logged');
      return true;
    }
    return save(timer, endedAt);
  }, [timer, commit, flash, save]);

  const start = useCallback(async (project) => {
    if (!keyRef.current) return;
    if (timer?.endedAt) { flash('Save or discard the previous session first'); return; }
    if (timer && timer.project.key === project.key) return;
    // Starting another project saves the current session first; if that
    // save fails, the old session stays put rather than being replaced.
    if (timer && !(await stop())) return;
    commit({ project, startedAt: Date.now() });
  }, [timer, stop, commit, flash]);

  const discard = useCallback(() => commit(null), [commit]);

  const addNote = useCallback((text) => {
    if (!timer || timer.endedAt) return false;
    const clean = cleanNoteText(text);
    if (!clean) return false;
    const notes = timer.notes || [];
    if (notes.length >= MAX_SESSION_NOTES) { flash(`That’s the limit of ${MAX_SESSION_NOTES} notes for one session`); return false; }
    commit({ ...timer, notes: [...notes, { at: Date.now(), text: clean }] });
    return true;
  }, [timer, commit, flash]);

  const removeNote = useCallback((index) => {
    if (!timer || timer.endedAt || !timer.notes?.[index]) return;
    commit({ ...timer, notes: timer.notes.filter((_, i) => i !== index) });
  }, [timer, commit]);

  const pause = useCallback(() => {
    if (!timer || timer.endedAt || timer.pausedAt) return;
    commit({ ...timer, pausedAt: Date.now() });
  }, [timer, commit]);

  const resume = useCallback(() => {
    if (!timer || timer.endedAt || !timer.pausedAt) return;
    const { pausedAt, ...running } = timer;
    commit({ ...running, pausedMs: (timer.pausedMs || 0) + (Date.now() - pausedAt) });
  }, [timer, commit]);

  const retry = useCallback(() => {
    if (!timer?.endedAt) return;
    save({ project: timer.project, startedAt: timer.startedAt, pausedMs: timer.pausedMs, notes: timer.notes }, timer.endedAt);
  }, [timer, save]);

  return { timer, saving, notice, start, stop, discard, retry, pause, resume, addNote, removeNote };
}

// Ticks once a second, only while `active`, and re-reads the clock when the
// tab becomes visible again. Lives in the chip (not the hook) so the
// per-second re-render stays inside this one small component instead of
// re-rendering the whole calendar.
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  // Refresh before paint when ticking (re)starts, so resuming from a pause
  // never shows a frame computed from the stale pre-pause clock.
  useLayoutEffect(() => { if (active) setNow(Date.now()); }, [active]);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    const onVisible = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active]);
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
  const now = useNow(live && !paused);
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

// Notes for the running session: a one-line input and the list so far. They
// stay in the timer (so a reload keeps them) and are uploaded to Notion with
// the session on Stop. Read-only once the session has ended (a failed save
// waiting on Retry), so what's kept is still visible but can't change.
function TimerNotes({ notes, readOnly, onAdd, onRemove }) {
  const [draft, setDraft] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (onAdd(draft)) setDraft('');
  };
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
              <span className="select-text min-w-0 flex-1 break-words">{note.text}</span>
              {!readOnly && (
                <button onClick={() => onRemove(i)} aria-label="Remove this note" className="shrink-0 leading-none opacity-50 hover:opacity-100 cursor-pointer">✕</button>
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
export function ActiveTimerCard({ timer, saving, notice, loggedMinutes, onStop, onDiscard, onRetry, onPause, onResume, onAddNote, onRemoveNote }) {
  const live = !timer.endedAt; // not finished (running or paused)
  const paused = live && !!timer.pausedAt;
  const now = useNow(live && !paused);
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

      <TimerNotes notes={timer.notes || []} readOnly={!live} onAdd={onAddNote} onRemove={onRemoveNote} />

      {notice && <div className="text-[11px] opacity-70 mt-1">{notice}</div>}
    </section>
  );
}
