import { useEffect, useState } from 'react';

// "Remove" for one entry on the Day page. Removing moves the entry's Notion
// page to the trash, so it takes two presses: the first arms it (and says what
// will happen), the second does it; it disarms by itself after a few seconds,
// the same two-step as discarding a timer. `onRemove` does the removal (and
// resolves when it's done); the entry's card goes away once it has.
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
      className="text-xs font-semibold px-2.5 py-1 rounded border shrink-0 cursor-pointer transition-colors hover:opacity-100 disabled:cursor-default"
    >
      {busy ? 'Removing…' : armed ? 'Remove? Press again' : 'Remove'}
    </button>
  );
}
