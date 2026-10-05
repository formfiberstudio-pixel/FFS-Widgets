import { useCallback, useEffect, useRef, useState } from 'react';
import { clockLabel, formatDuration, formatMinutes, localDateString } from './timeFormat.js';

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

const chipButtonClass = 'shrink-0 px-2 py-0.5 rounded-full border text-[11px] font-bold cursor-pointer disabled:opacity-50';

export function TimerChip({ timer, saving, notice, onStop, onDiscard, onRetry }) {
  const running = !!timer && !timer.endedAt;
  const now = useNow(running);
  const elapsed = timer ? (timer.endedAt ?? now) - timer.startedAt : 0;
  const elapsedSeconds = Math.floor(elapsed / 1000);
  const [discardArmed, setDiscardArmed] = useState(false);

  // Two-step discard: the first tap arms it, and it disarms by itself.
  useEffect(() => {
    if (!discardArmed) return undefined;
    const id = setTimeout(() => setDiscardArmed(false), 3000);
    return () => clearTimeout(id);
  }, [discardArmed]);

  // Show the running time in the browser tab, and put the title back after.
  const projectTitle = timer?.project.title;
  useEffect(() => {
    if (!running) return undefined;
    const original = document.title;
    document.title = `${formatDuration(elapsedSeconds * 1000)} · ${projectTitle}`;
    return () => { document.title = original; };
  }, [running, elapsedSeconds, projectTitle]);

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
            onClick={() => { if (discardArmed) { setDiscardArmed(false); onDiscard(); } else setDiscardArmed(true); }}
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
