import { useCallback, useEffect, useRef, useState } from 'react';
import { clockLabel, dialSweepDegrees, formatClock, formatDuration, formatMinutes, localDateString } from './timeFormat.js';

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
// endedAt?, error? }. endedAt/error only exist while a finished session
// failed to save and is waiting on Retry or Discard.
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
    const minutes = Math.round((endedAt - session.startedAt) / 60000);
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
            minutes,
            dateTaken: dateStr,
            startLabel,
            endLabel,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) throw new Error(result.error || 'Could not save to Notion');
        pageId = result.pageId;
      }
      commit(null);
      onSavedRef.current?.({ id: pageId, project: session.project, minutes, dateStr, startLabel, endLabel });
      flash(`Saved ${formatMinutes(minutes)} to ${session.project.title}${isDemoMode ? ' (demo only)' : ''}`);
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
    const endedAt = Date.now();
    if (endedAt - timer.startedAt < 60000) {
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

  const retry = useCallback(() => {
    if (!timer?.endedAt) return;
    save({ project: timer.project, startedAt: timer.startedAt }, timer.endedAt);
  }, [timer, save]);

  return { timer, saving, notice, start, stop, discard, retry };
}

// Ticks once a second, only while `active`, and re-reads the clock when the
// tab becomes visible again. Lives in the chip (not the hook) so the
// per-second re-render stays inside this one small component instead of
// re-rendering the whole calendar.
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
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
function useTabTitle(running, elapsedSeconds, projectTitle) {
  useEffect(() => {
    if (!running) return undefined;
    const original = document.title;
    document.title = `${formatDuration(elapsedSeconds * 1000)} · ${projectTitle}`;
    return () => { document.title = original; };
  }, [running, elapsedSeconds, projectTitle]);
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

export function TimerChip({ timer, saving, notice, onStop, onDiscard, onRetry }) {
  const running = !!timer && !timer.endedAt;
  const now = useNow(running);
  const elapsed = timer ? (timer.endedAt ?? now) - timer.startedAt : 0;
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const [discardArmed, pressDiscard] = useTwoStepDiscard(onDiscard);
  useTabTitle(running, elapsedSeconds, timer?.project.title);

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
          <span className={`w-2 h-2 rounded-full shrink-0 ${running ? 'animate-pulse' : ''}`} style={{ backgroundColor: 'var(--theme-primary)' }} />
          <span className="truncate min-w-0 font-semibold" title={timer.project.title}>{timer.project.title}</span>
          <span className="shrink-0 font-bold tabular-nums">{formatDuration(elapsed)}</span>
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

// The sidebar's spotlight on the project being tracked: a dial that fills
// round the hour (45:24 in is three-quarters full) with the clock in its
// middle, echoing the Life Log timer. Tints come from --theme-primary at a
// partial opacity rather than a fixed colour, so the digits (--theme-text)
// stay readable on every theme preset. Rendered instead of TimerChip while
// the sidebar is open, so only one of them ever ticks.
export function ActiveTimerCard({ timer, saving, notice, loggedMinutes, onStop, onDiscard, onRetry }) {
  const running = !timer.endedAt;
  const now = useNow(running);
  const elapsed = (timer.endedAt ?? now) - timer.startedAt;
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const [discardArmed, pressDiscard] = useTwoStepDiscard(onDiscard);
  useTabTitle(running, elapsedSeconds, timer.project.title);

  const degrees = dialSweepDegrees(elapsed);
  const detail = [
    timer.project.source !== 'Activity Log' ? timer.project.source : '',
    `Started ${clockLabel(new Date(timer.startedAt))}`,
  ].filter(Boolean).join(' · ');
  const outline = { backgroundColor: 'var(--theme-card)', color: 'var(--theme-text)' };

  return (
    <section
      aria-label="Active project timer"
      className="shrink-0 mb-3 rounded-2xl border p-3 flex flex-col items-center text-center gap-1"
      style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-primary)', color: 'var(--theme-text)' }}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider opacity-70">
        <span className={`w-2 h-2 rounded-full ${running ? 'animate-pulse' : ''}`} style={{ backgroundColor: 'var(--theme-primary)' }} />
        {running ? 'Now tracking' : 'Not saved yet'}
      </div>
      <div className="w-full text-sm font-bold leading-snug line-clamp-2 break-words" title={timer.project.title}>{timer.project.title}</div>

      <div className="relative w-[136px] h-[136px] my-1">
        <svg viewBox="0 0 160 160" className="absolute inset-0 w-full h-full" aria-hidden="true">
          <circle cx="80" cy="80" r="74" fill="var(--theme-primary)" fillOpacity="0.14" stroke="var(--theme-primary)" strokeOpacity="0.5" strokeWidth="2" />
          {degrees > 0 && <path d={sectorPath(80, 80, 74, degrees)} fill="var(--theme-primary)" fillOpacity="0.45" />}
          {[0, 90, 180, 270].map((deg) => (
            <line key={deg} x1="80" y1="9" x2="80" y2="17" stroke="var(--theme-text)" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" transform={`rotate(${deg} 80 80)`} />
          ))}
          {/* Marker on the sweep's leading edge, kept to the rim so it never crosses the digits. */}
          <line x1="80" y1="6" x2="80" y2="22" stroke="var(--theme-primary)" strokeWidth="3.5" strokeLinecap="round" transform={`rotate(${degrees} 80 80)`} />
        </svg>
        <div
          role="timer"
          aria-label={`Elapsed ${formatDuration(elapsed)}`}
          className="absolute inset-0 flex items-center justify-center text-[23px] font-bold tabular-nums tracking-tight"
        >
          {formatClock(elapsed)}
        </div>
      </div>

      <div className="text-[11px] opacity-70">{detail}</div>
      {loggedMinutes > 0 && <div className="text-[11px] opacity-70">{formatMinutes(loggedMinutes)} logged before this</div>}

      {timer.error && (
        <div className="text-[11px] font-semibold mt-1 w-full break-words" title={timer.error}>
          Couldn&rsquo;t save the {formatMinutes(Math.round(elapsed / 60000))} &mdash; it&rsquo;s kept here until you retry.
        </div>
      )}

      <div className="flex items-start justify-center gap-5 mt-2">
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

      {notice && <div className="text-[11px] opacity-70 mt-1">{notice}</div>}
    </section>
  );
}
