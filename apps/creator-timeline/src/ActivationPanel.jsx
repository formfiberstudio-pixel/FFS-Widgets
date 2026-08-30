import { useState } from 'react';

function makeId() {
  return crypto.randomUUID();
}

export function buildEmbedUrl(tenantId, sourcesFilter) {
  const base = `${window.location.origin}/`;
  if (!sourcesFilter || sourcesFilter.length === 0) return `${base}?tenant=${tenantId}`;
  return `${base}?tenant=${tenantId}&sources=${sourcesFilter.join(',')}`;
}

// Shared by setup.html (a full standalone page for people arriving fresh,
// e.g. from a Gumroad receipt link) and the main app's own Settings modal
// (so reconfiguring an already-working embed doesn't require leaving it).
// onActivated(tenantId) fires right after a successful activate/lookup/save,
// letting an embedding parent react (e.g. silently refetch calendar data).
// onContinue, if provided, renders an extra button on the "done" screen for
// explicitly moving on (used by the first-activation flow, which needs to
// let the user copy their embed URL before the setup UI disappears).
export default function ActivationPanel({ embedded = false, onActivated, onContinue, continueLabel = 'Continue' }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [notionToken, setNotionToken] = useState('');
  const [specialDaysDatabaseId, setSpecialDaysDatabaseId] = useState('');
  const [sources, setSources] = useState([{ id: makeId(), label: '', databaseId: '' }]);
  const [status, setStatus] = useState('idle'); // idle | submitting | error | done
  const [errorMessage, setErrorMessage] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [selectedForEmbed, setSelectedForEmbed] = useState([]); // databaseIds included in the copyable URL
  const [copiedKey, setCopiedKey] = useState('');

  const [hasExistingToken, setHasExistingToken] = useState(false);
  const [savedViews, setSavedViews] = useState([]);
  const [newViewLabel, setNewViewLabel] = useState('');

  const [showLookup, setShowLookup] = useState(false);
  const [lookupLicenseKey, setLookupLicenseKey] = useState('');
  const [lookupStatus, setLookupStatus] = useState('idle'); // idle | looking | error

  const addSource = () => setSources(prev => [...prev, { id: makeId(), label: '', databaseId: '' }]);
  const removeSource = (id) => setSources(prev => prev.filter(s => s.id !== id));
  const updateSource = (id, field, value) => setSources(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(''), 2000);
    } catch {
      // Clipboard API can fail (permissions, insecure context) -- the URL is still shown to copy manually.
    }
  };

  const handleLookup = async (e) => {
    e.preventDefault();
    setLookupStatus('looking');
    setErrorMessage('');
    try {
      const res = await fetch('/api/tenant-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: lookupLicenseKey }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Lookup failed');

      setLicenseKey(lookupLicenseKey);
      setSources(
        data.sources.length > 0
          ? data.sources.map(s => ({ id: makeId(), label: s.label, databaseId: s.databaseId }))
          : [{ id: makeId(), label: '', databaseId: '' }]
      );
      setSpecialDaysDatabaseId(data.specialDaysDatabaseId || '');
      setSavedViews(data.savedViews || []);
      setHasExistingToken(Boolean(data.hasToken));
      setTenantId(data.tenantId);
      setNotionToken('');
      setShowLookup(false);
      setLookupStatus('idle');
      onActivated?.(data.tenantId);
    } catch (err) {
      setErrorMessage(err.message || 'Lookup failed');
      setLookupStatus('error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMessage('');
    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          notionToken: notionToken || undefined,
          specialDaysDatabaseId,
          sources: sources.map(s => ({ label: s.label, databaseId: s.databaseId })),
          savedViews,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Setup failed');
      }
      setTenantId(data.tenantId);
      setSavedViews(data.savedViews || []);
      setSelectedForEmbed(sources.filter(s => s.databaseId.trim()).map(s => s.databaseId.trim()));
      setHasExistingToken(true);
      setNotionToken('');
      setStatus('done');
      onActivated?.(data.tenantId);
    } catch (err) {
      setErrorMessage(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  const handleSaveView = async () => {
    if (!newViewLabel.trim()) return;
    const newView = { id: makeId(), label: newViewLabel.trim(), sources: allSelected ? null : selectedForEmbed };
    await persistViews([...savedViews, newView]);
    setNewViewLabel('');
  };

  const handleDeleteView = async (id) => {
    await persistViews(savedViews.filter(v => v.id !== id));
  };

  const persistViews = async (updatedViews) => {
    setStatus('submitting');
    setErrorMessage('');
    try {
      const res = await fetch('/api/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          licenseKey,
          notionToken: notionToken || undefined,
          specialDaysDatabaseId,
          sources: sources.map(s => ({ label: s.label, databaseId: s.databaseId })),
          savedViews: updatedViews,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not save');
      setSavedViews(data.savedViews || []);
      setStatus('done');
      onActivated?.(tenantId);
    } catch (err) {
      setErrorMessage(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  const validSources = sources.filter(s => s.databaseId.trim());
  const allSelected = selectedForEmbed.length === validSources.length;
  const embedUrl = tenantId ? buildEmbedUrl(tenantId, allSelected ? null : selectedForEmbed) : '';

  const toggleEmbedSource = (databaseId) => {
    setSelectedForEmbed(prev => prev.includes(databaseId) ? prev.filter(id => id !== databaseId) : [...prev, databaseId]);
  };

  const inputClass = `w-full px-3 py-2 rounded border text-sm outline-none focus:border-neutral-400 ${embedded ? 'border-neutral-700 bg-black/30' : 'border-neutral-700 bg-neutral-900'}`;
  const cardClass = `border rounded-lg ${embedded ? 'border-neutral-700 bg-black/20' : 'border-neutral-800 bg-neutral-900'}`;

  return (
    <div className={embedded ? 'space-y-5' : 'min-h-screen bg-neutral-950 text-neutral-100 flex justify-center px-4 py-12'}>
      <div className={embedded ? '' : 'w-full max-w-xl space-y-6'}>
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold">Creator Timeline Setup</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Connect your own Notion workspace to activate your license. Your Notion token stays on our server and is never shared with anyone viewing your calendar.
            </p>
          </div>
        )}

        <div className={embedded ? 'space-y-5' : 'space-y-6'}>
          {status !== 'done' && (
            <div className={`p-3 ${cardClass}`}>
              {!showLookup ? (
                <button
                  type="button"
                  onClick={() => { setShowLookup(true); setLookupLicenseKey(licenseKey); }}
                  className="text-sm text-neutral-300 hover:text-white underline cursor-pointer"
                >
                  Already activated? Look up your existing setup instead of starting blank
                </button>
              ) : (
                <form onSubmit={handleLookup} className="space-y-2">
                  <label className="block text-xs font-bold">Gumroad License Key</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={lookupLicenseKey}
                      onChange={(e) => setLookupLicenseKey(e.target.value)}
                      placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                      className={`flex-1 ${inputClass}`}
                    />
                    <button
                      type="submit"
                      disabled={lookupStatus === 'looking'}
                      className="px-4 py-2 rounded bg-white text-black text-sm font-bold cursor-pointer hover:opacity-90 disabled:opacity-50 shrink-0"
                    >
                      {lookupStatus === 'looking' ? 'Looking up...' : 'Look Up'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowLookup(false)}
                      className="text-sm text-neutral-400 hover:text-neutral-200 cursor-pointer px-2"
                    >
                      Cancel
                    </button>
                  </div>
                  {lookupStatus === 'error' && (
                    <div className="p-2 rounded bg-rose-950 border border-rose-800 text-rose-200 text-xs">{errorMessage}</div>
                  )}
                </form>
              )}
            </div>
          )}

          {status === 'done' ? (
            <div className="space-y-6">
              <div className="p-4 rounded-lg bg-emerald-950 border border-emerald-800 text-emerald-200 text-sm">
                Activated. Paste the link below into a Notion embed block on any page.
              </div>

              {validSources.length > 1 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-neutral-400">
                    Include in this embed's link
                  </label>
                  <div className="space-y-1.5">
                    {validSources.map(s => (
                      <label key={s.id} className={`flex items-center gap-2 p-2 cursor-pointer text-sm ${cardClass}`}>
                        <input
                          type="checkbox"
                          checked={selectedForEmbed.includes(s.databaseId.trim())}
                          onChange={() => toggleEmbedSource(s.databaseId.trim())}
                        />
                        <span>{s.label || 'Untitled database'}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-neutral-500">
                    Uncheck databases to generate a filtered link -- e.g. a client-facing page showing only that client's database.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wide text-neutral-400">Embed URL</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={embedUrl}
                    onFocus={(e) => e.target.select()}
                    className={`flex-1 font-mono ${inputClass}`}
                  />
                  <button
                    onClick={() => copyText(embedUrl, 'main')}
                    className="px-4 py-2 rounded bg-white text-black text-sm font-bold shrink-0 cursor-pointer hover:opacity-90"
                  >
                    {copiedKey === 'main' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className={`space-y-2 p-3 ${cardClass}`}>
                <label className="block text-xs font-bold uppercase tracking-wide text-neutral-400">Save this link for later</label>
                <p className="text-xs text-neutral-500">
                  Give the current selection a name (e.g. "Personal", "Acme Client") so you can come back here and grab it again without reconfiguring.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newViewLabel}
                    onChange={(e) => setNewViewLabel(e.target.value)}
                    placeholder={'e.g. "Acme Client Page"'}
                    className={`flex-1 ${inputClass}`}
                  />
                  <button
                    type="button"
                    onClick={handleSaveView}
                    disabled={!newViewLabel.trim() || status === 'submitting'}
                    className="px-4 py-2 rounded bg-white text-black text-sm font-bold cursor-pointer hover:opacity-90 disabled:opacity-50 shrink-0"
                  >
                    Save Link
                  </button>
                </div>
              </div>

              {savedViews.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-neutral-400">Your Saved Links</label>
                  <div className="space-y-1.5">
                    {savedViews.map((v) => (
                      <div key={v.id} className={`flex items-center justify-between gap-2 p-2.5 text-sm ${cardClass}`}>
                        <div className="min-w-0">
                          <div className="font-bold truncate">{v.label}</div>
                          <div className="text-xs text-neutral-500">{v.sources ? `${v.sources.length} database${v.sources.length === 1 ? '' : 's'}` : 'All databases'}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyText(buildEmbedUrl(tenantId, v.sources), v.id)}
                            className="text-xs font-bold px-2.5 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 cursor-pointer"
                          >
                            {copiedKey === v.id ? 'Copied!' : 'Copy'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteView(v.id)}
                            className="text-xs font-bold text-rose-400 hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="p-3 rounded bg-rose-950 border border-rose-800 text-rose-200 text-sm">{errorMessage}</div>
              )}

              <div className="flex items-center gap-4">
                <button
                  onClick={() => setStatus('idle')}
                  className="text-sm text-neutral-400 hover:text-neutral-200 underline cursor-pointer"
                >
                  Reconfigure or add another database
                </button>
                {onContinue && (
                  <button
                    onClick={onContinue}
                    style={{ marginLeft: 'auto' }}
                    className="px-4 py-2 rounded bg-white text-black text-sm font-bold cursor-pointer hover:opacity-90"
                  >
                    {continueLabel} →
                  </button>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-bold mb-1.5">Gumroad License Key</label>
                <input
                  type="text"
                  required
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                  className={inputClass}
                />
                <p className="text-xs text-neutral-500 mt-1">Found in your Gumroad purchase receipt email.</p>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5">Notion Integration Token</label>
                <input
                  type="password"
                  required={!hasExistingToken}
                  value={notionToken}
                  onChange={(e) => setNotionToken(e.target.value)}
                  placeholder={hasExistingToken ? 'Leave blank to keep your current token' : 'secret_...'}
                  className={inputClass}
                />
                {hasExistingToken && (
                  <p className="text-xs text-neutral-500 mt-1">A token is already on file -- only fill this in if you want to replace it.</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold">Databases to Show</label>
                  <button
                    type="button"
                    onClick={addSource}
                    className="text-xs font-bold text-neutral-300 hover:text-white cursor-pointer underline"
                  >
                    + Add Database
                  </button>
                </div>
                <div className="space-y-2">
                  {sources.map((source) => (
                    <div key={source.id} className={`flex items-start gap-2 p-2 ${cardClass}`}>
                      <div className="flex-1 space-y-1.5">
                        <input
                          type="text"
                          value={source.label}
                          onChange={(e) => updateSource(source.id, 'label', e.target.value)}
                          placeholder={'Label, e.g. "Project Tracking"'}
                          className="w-full px-2.5 py-1.5 rounded border border-neutral-700 bg-neutral-950 text-xs font-bold outline-none"
                        />
                        <input
                          type="text"
                          required
                          value={source.databaseId}
                          onChange={(e) => updateSource(source.id, 'databaseId', e.target.value)}
                          placeholder="Database ID: 3728d5a5..."
                          className="w-full px-2.5 py-1.5 rounded border border-neutral-700 bg-neutral-950 text-xs outline-none"
                        />
                      </div>
                      {sources.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSource(source.id)}
                          className="text-xs font-bold text-rose-400 hover:underline cursor-pointer px-1 py-1.5 shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold mb-1.5">Special Days Database ID (Optional)</label>
                <input
                  type="text"
                  value={specialDaysDatabaseId}
                  onChange={(e) => setSpecialDaysDatabaseId(e.target.value)}
                  placeholder="Optional ID for Birthdays/Vacations/Events..."
                  className={inputClass}
                />
              </div>

              {savedViews.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wide text-neutral-400">Your Saved Links</label>
                  <div className="space-y-1.5">
                    {savedViews.map((v) => (
                      <div key={v.id} className={`flex items-center justify-between gap-2 p-2.5 text-sm ${cardClass}`}>
                        <div className="min-w-0">
                          <div className="font-bold truncate">{v.label}</div>
                          <div className="text-xs text-neutral-500">{v.sources ? `${v.sources.length} database${v.sources.length === 1 ? '' : 's'}` : 'All databases'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyText(buildEmbedUrl(tenantId, v.sources), v.id)}
                          className="text-xs font-bold px-2.5 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 cursor-pointer shrink-0"
                        >
                          {copiedKey === v.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="p-3 rounded bg-rose-950 border border-rose-800 text-rose-200 text-sm">
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'submitting'}
                className="w-full py-2.5 rounded bg-white text-black text-sm font-bold cursor-pointer hover:opacity-90 disabled:opacity-50"
              >
                {status === 'submitting' ? 'Saving...' : hasExistingToken ? 'Save Changes' : 'Activate'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
