import { useState, useEffect, useRef } from 'react';

// A log entry's note, writable back to Notion -- not just a display of
// whatever text already lives in the page's body. Saving PATCHes the
// exact block the sync found the text in (pageContentBlockId/Type, from
// get-notion-logs.js), or appends a fresh paragraph block when the entry
// had no text yet, via backlog-photo.js's updateNote action.
//
// Renders as plain text sitting directly under the photo/title (no boxed
// frame) rather than an always-visible textarea -- a saved note reads as
// a paragraph, clamped to 5 lines with an ellipsis past that; an empty
// entry is just a small "+ Add Note" button. Either one switches to an
// editing textarea on click, sized to its own content instead of a fixed
// height, and reverts back to the plain-text view once saved.
export default function LogNoteEditor({ log, tenantId, onSaved }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(log.pageContent || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    setDraft(log.pageContent || '');
    setIsEditing(false);
    setError(null);
  }, [log.id]);

  // Autosize to content instead of scrolling internally, so the editing
  // box grows/shrinks with what's typed the same way the read view's
  // block does.
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [isEditing, draft]);

  // No real tenant to write back to (demo mode, or setup incomplete) --
  // same condition the Sync/Import buttons already gate on elsewhere.
  const isReadOnly = !tenantId;
  const hasNote = !!(log.pageContent && log.pageContent.trim());

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
      setIsEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(log.pageContent || '');
    setError(null);
    setIsEditing(false);
  };

  // Nothing to show and nothing they can do about it.
  if (isReadOnly && !hasNote) return null;

  if (isEditing) {
    return (
      <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1.5">
        <textarea
          ref={textareaRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note -- saved back to this entry in Notion"
          rows={1}
          className="text-xs leading-normal bg-transparent resize-none outline-none overflow-hidden"
          style={{ color: 'var(--theme-text)' }}
        />
        <div className="flex items-center justify-between gap-2 shrink-0">
          <span className="text-[10px] truncate" style={{ color: 'var(--theme-secondary)' }}>
            {error || ''}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleCancel}
              className="text-xs font-semibold px-2 py-1 rounded cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ backgroundColor: 'var(--theme-primary)' }}
              className="text-xs font-bold text-white px-2.5 py-1 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {saving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (hasNote) {
    return (
      <p
        onClick={(e) => { e.stopPropagation(); if (!isReadOnly) setIsEditing(true); }}
        title={isReadOnly ? undefined : 'Tap to edit'}
        className={`text-xs leading-normal whitespace-pre-wrap line-clamp-5 ${isReadOnly ? '' : 'cursor-pointer'}`}
        style={{ color: 'var(--theme-text)' }}
      >
        {log.pageContent}
      </p>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
      className="self-start text-xs font-bold cursor-pointer hover:opacity-70 transition-opacity"
      style={{ color: 'var(--theme-primary)' }}
    >
      + Add Note
    </button>
  );
}
