import { useEffect, useState } from 'react';

// The bin in the corner of an entry's card for removing it. Removing moves the
// entry's Notion page to the trash, so it takes two presses: the first arms it
// (the bin turns red and asks), the second does it; it disarms by itself after a
// few seconds, the same two-step as discarding a timer. `onRemove` does the
// removal (and resolves when it's done); the entry's card goes away once it has.
const IconTrash = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

export default function RemoveEntryButton({ onRemove }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  const press = async (e) => {
    e.stopPropagation();
    if (busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <button
      type="button"
      onClick={press}
      disabled={busy}
      title={armed ? 'Press again to move this entry to the Notion trash' : 'Remove this entry (moves it to the Notion trash)'}
      aria-label={armed ? 'Confirm: move this entry to the Notion trash' : 'Remove this entry'}
      style={{
        backgroundColor: 'var(--theme-card)',
        borderColor: armed ? '#e11d48' : 'var(--theme-border)',
        color: armed ? '#e11d48' : 'var(--theme-text)',
        opacity: armed || busy ? 1 : 0.7,
      }}
      className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-1.5 py-1 rounded border cursor-pointer transition-colors hover:opacity-100 disabled:cursor-default"
    >
      <IconTrash />
      {busy ? <span>Removing…</span> : armed ? <span>Remove?</span> : null}
    </button>
  );
}
