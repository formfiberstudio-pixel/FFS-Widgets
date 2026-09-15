import { useState, useEffect } from 'react';

// A log entry's title, writable back to Notion -- same click-to-edit
// pattern as LogNoteEditor, but for the title property (backlog-photo.js's
// updateTitle action) instead of the body text. Renders as plain wrapping
// text (never truncated) so a long title reads in full rather than
// ellipsizing.
export default function LogTitleEditor({ log, tenantId, onSaved, className = '' }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(log.title || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDraft(log.title || '');
    setIsEditing(false);
    setError(null);
  }, [log.id]);

  const isReadOnly = !tenantId;

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setError('Title cannot be empty');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/backlog-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, action: 'updateTitle', pageId: log.id, newTitle: trimmed }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Save failed');
      onSaved(log.id, trimmed);
      setIsEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(log.title || '');
    setError(null);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-1 min-w-0">
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
          className={`bg-transparent outline-none border-b w-full ${className}`}
          style={{ color: 'var(--theme-text)', borderColor: 'var(--theme-primary)' }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] truncate" style={{ color: 'var(--theme-secondary)' }}>{error || ''}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleCancel}
              className="text-xs font-semibold px-2 py-0.5 rounded cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ backgroundColor: 'var(--theme-primary)' }}
              className="text-xs font-bold text-white px-2.5 py-0.5 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => { e.stopPropagation(); if (!isReadOnly) setIsEditing(true); }}
      title={isReadOnly ? undefined : 'Tap to edit'}
      className={`${className} min-w-0 ${isReadOnly ? '' : 'cursor-pointer'}`}
    >
      {log.title || 'Untitled'}
    </div>
  );
}
