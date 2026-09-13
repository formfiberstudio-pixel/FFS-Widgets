import { useState, useEffect } from 'react';

// A log entry's note, writable back to Notion -- not just a display of
// whatever text already lives in the page's body. Saving PATCHes the
// exact block the sync found the text in (pageContentBlockId/Type, from
// get-notion-logs.js), or appends a fresh paragraph block when the entry
// had no text yet, via backlog-photo.js's updateNote action.
export default function LogNoteEditor({ log, tenantId, onSaved }) {
  const [draft, setDraft] = useState(log.pageContent || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setDraft(log.pageContent || '');
    setJustSaved(false);
    setError(null);
  }, [log.id]);

  const isDirty = draft !== (log.pageContent || '');
  // No real tenant to write back to (demo mode, or setup incomplete) --
  // same condition the Sync/Import buttons already gate on elsewhere.
  const isReadOnly = !tenantId;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/backlog-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          action: 'updateNote',
          pageId: log.id,
          blockId: log.pageContentBlockId || null,
          blockType: log.pageContentBlockType || null,
          text: draft,
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Save failed');
      onSaved(log.id, draft, result.blockId, result.blockType);
      setJustSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-h-[100px] flex flex-col gap-1.5 p-3 rounded border cursor-default"
      style={{ backgroundColor: 'var(--theme-card)', borderColor: 'var(--theme-border)' }}
    >
      <textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setJustSaved(false); }}
        placeholder={isReadOnly ? 'Notes aren\'t editable in demo mode' : "Add a note -- saved back to this entry in Notion"}
        readOnly={isReadOnly}
        className="flex-1 min-h-[60px] text-xs leading-normal bg-transparent resize-none outline-none disabled:opacity-60"
        style={{ color: 'var(--theme-text)' }}
      />
      {!isReadOnly && (
        <div className="flex items-center justify-between gap-2 shrink-0">
          <span className="text-[10px] truncate" style={{ color: error ? 'var(--theme-secondary)' : 'var(--theme-text)', opacity: error ? 1 : 0.5 }}>
            {error || (justSaved ? 'Saved to Notion' : '')}
          </span>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            style={{ backgroundColor: 'var(--theme-primary)' }}
            className="text-xs font-bold text-white px-2.5 py-1 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
          >
            {saving ? 'Saving…' : 'Save Note'}
          </button>
        </div>
      )}
    </div>
  );
}
