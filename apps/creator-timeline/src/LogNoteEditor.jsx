import { useState, useEffect, useRef } from 'react';
import { resizeImageForUpload } from './imageResize.js';

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
//
// While editing, an entry that has no photo yet also gets a "+ Add Photo"
// button (left side, opposite Cancel/Save Note) -- for a text-only log
// that was never backlogged with an image of its own. It reuses
// backlog-photo.js's existing append-to-an-existing-page path (passing
// this entry's own pageId, no referenceLogId/database routing needed)
// rather than requiring a whole new endpoint.
export default function LogNoteEditor({ log, tenantId, onSaved, onPhotoAdded }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(log.pageContent || '');
  const [saving, setSaving] = useState(false);
  const [addingPhoto, setAddingPhoto] = useState(false);
  const [photoAdded, setPhotoAdded] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  const photoInputRef = useRef(null);

  useEffect(() => {
    setDraft(log.pageContent || '');
    setIsEditing(false);
    setError(null);
    setPhotoAdded(false);
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
  const canAddPhoto = !isReadOnly && !log.imageUrl;

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

  const handleAddPhoto = () => photoInputRef.current?.click();

  const handlePhotoFileSelected = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAddingPhoto(true);
    setError(null);
    setPhotoAdded(false);
    try {
      const imageBase64 = await resizeImageForUpload(file);
      const response = await fetch('/api/backlog-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, pageId: log.id, imageBase64 }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Upload failed');
      setPhotoAdded(true);
      // The new image only shows up on this entry's card once the logs
      // are re-fetched from Notion -- this component only owns the note
      // text, not the photo, so it can't just update local state itself.
      onPhotoAdded?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingPhoto(false);
    }
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
          onChange={(e) => { setDraft(e.target.value); setPhotoAdded(false); }}
          placeholder="Add a note -- saved back to this entry in Notion"
          rows={1}
          className="text-xs leading-normal bg-transparent resize-none outline-none overflow-hidden"
          style={{ color: 'var(--theme-text)' }}
        />
        {canAddPhoto && (
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoFileSelected}
          />
        )}
        <div className="flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            {error ? (
              <span className="text-[10px] truncate block" style={{ color: 'var(--theme-secondary)' }}>{error}</span>
            ) : photoAdded ? (
              <span className="text-[10px] truncate block opacity-60">Photo added</span>
            ) : canAddPhoto ? (
              <button
                type="button"
                onClick={handleAddPhoto}
                disabled={addingPhoto}
                className="text-xs font-bold cursor-pointer hover:opacity-70 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: 'var(--theme-primary)' }}
              >
                {addingPhoto ? 'Adding Photo…' : '+ Add Photo'}
              </button>
            ) : null}
          </div>
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
