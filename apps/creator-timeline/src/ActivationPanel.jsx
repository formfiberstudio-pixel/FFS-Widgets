import { useState, useEffect } from 'react';
import { copyToClipboard } from './clipboard.js';

function makeId() {
  return crypto.randomUUID();
}

// Remembering the license key locally (this browser only, never synced or
// sent anywhere but our own API) is what lets a returning creator open
// Settings and immediately see their current setup instead of re-entering
// the key and clicking "Look up" every time. It's still the same
// ownership credential gating actual changes -- a client who only has a
// shared embed link never has this in their own browser's storage.
const STORED_LICENSE_KEY = 'notionWidgetLicenseKey';

// Colors follow the embedding app's current theme (light/dark, or any
// custom color preset) via the --theme-* CSS custom properties it defines
// on an ancestor element. The fallbacks match this component's original
// hardcoded dark palette, so setup.html -- a standalone page with no
// theme system at all -- renders exactly as before.
const colors = {
  bg: 'var(--theme-bg, #0a0a0a)',
  card: 'var(--theme-card, #171717)',
  border: 'var(--theme-border, #404040)',
  text: 'var(--theme-text, #f5f5f5)',
  primary: 'var(--theme-primary, #f43f5e)',
  // Derived by blending the theme's own text color toward transparent,
  // so "muted"/"faint" text stays readable against whatever background
  // is actually active instead of assuming a fixed dark backdrop.
  muted: 'color-mix(in srgb, var(--theme-text, #f5f5f5) 65%, transparent)',
  faint: 'color-mix(in srgb, var(--theme-text, #f5f5f5) 45%, transparent)',
  dangerText: '#e11d48',
  dangerBg: 'rgba(244, 63, 94, 0.1)',
  dangerBorder: 'rgba(244, 63, 94, 0.35)',
  successText: '#059669',
  successBg: 'rgba(16, 185, 129, 0.1)',
  successBorder: 'rgba(16, 185, 129, 0.35)',
};

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
export default function ActivationPanel({ embedded = false, onActivated, onContinue, continueLabel = 'Continue', hideSavedViewsList = false, skipAutoLoad = false, facetCandidates = null }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [notionToken, setNotionToken] = useState('');
  const [specialDaysDatabaseId, setSpecialDaysDatabaseId] = useState('');
  const [sources, setSources] = useState([{ id: makeId(), label: '', databaseId: '', topicFacetKey: '', typeFacetKey: '' }]);
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
  const [autoLoading, setAutoLoading] = useState(false);

  const addSource = () => setSources(prev => [...prev, { id: makeId(), label: '', databaseId: '', topicFacetKey: '', typeFacetKey: '' }]);
  const removeSource = (id) => setSources(prev => prev.filter(s => s.id !== id));
  const updateSource = (id, field, value) => setSources(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));

  const copyText = async (text, key) => {
    const ok = await copyToClipboard(text);
    setCopiedKey(ok ? key : `${key}:failed`);
    setTimeout(() => setCopiedKey(''), ok ? 2000 : 4000);
  };

  const copyLabel = (key, idleLabel) => {
    if (copiedKey === key) return 'Copied!';
    if (copiedKey === `${key}:failed`) return 'Copy manually';
    return idleLabel;
  };

  // Shared by the manual "Look Up" form and the silent auto-load below.
  // `showSummary` additionally jumps straight to the "Activated" screen
  // (Embed URL + saved links) instead of the editable form, since that's
  // the more useful thing to see when we already knew this tenant was set
  // up before the user did anything.
  const applyTenantData = (key, data, { showSummary = false } = {}) => {
    const loadedSources = data.sources.length > 0
      ? data.sources.map(s => ({ id: makeId(), label: s.label, databaseId: s.databaseId, topicFacetKey: s.topicFacetKey || '', typeFacetKey: s.typeFacetKey || '' }))
      : [{ id: makeId(), label: '', databaseId: '', topicFacetKey: '', typeFacetKey: '' }];

    setLicenseKey(key);
    setSources(loadedSources);
    setSpecialDaysDatabaseId(data.specialDaysDatabaseId || '');
    setSavedViews(data.savedViews || []);
    setHasExistingToken(Boolean(data.hasToken));
    setTenantId(data.tenantId);
    setNotionToken('');
    setShowLookup(false);
    setLookupStatus('idle');
    try { localStorage.setItem(STORED_LICENSE_KEY, key); } catch { /* storage unavailable -- non-fatal */ }

    if (showSummary) {
      setSelectedForEmbed(loadedSources.filter(s => s.databaseId.trim()).map(s => s.databaseId.trim()));
      setStatus('done');
    }

    onActivated?.(data.tenantId);
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
      applyTenantData(lookupLicenseKey, data);
    } catch (err) {
      setErrorMessage(err.message || 'Lookup failed');
      setLookupStatus('error');
    }
  };

  // Silently try a remembered license key on mount so a returning creator
  // sees their already-activated setup immediately, without retyping the
  // key or clicking through the manual lookup form. skipAutoLoad opts out
  // of this -- used for a guaranteed-blank setup link the owner can share
  // or preview on their own browser without it picking up their own
  // cached license.
  useEffect(() => {
    if (skipAutoLoad) return;
    let stored;
    try { stored = localStorage.getItem(STORED_LICENSE_KEY); } catch { stored = null; }
    if (!stored) return;

    setAutoLoading(true);
    (async () => {
      try {
        const res = await fetch('/api/tenant-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ licenseKey: stored }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error();
        applyTenantData(stored, data, { showSummary: true });
      } catch {
        // Stale/revoked key -- fall back to the normal blank/lookup flow
        // instead of silently retrying this on every future mount.
        try { localStorage.removeItem(STORED_LICENSE_KEY); } catch { /* ignore */ }
      } finally {
        setAutoLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          sources: sources.map(s => ({ label: s.label, databaseId: s.databaseId, topicFacetKey: s.topicFacetKey, typeFacetKey: s.typeFacetKey })),
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
      try { localStorage.setItem(STORED_LICENSE_KEY, licenseKey); } catch { /* ignore */ }
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
          sources: sources.map(s => ({ label: s.label, databaseId: s.databaseId, topicFacetKey: s.topicFacetKey, typeFacetKey: s.typeFacetKey })),
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

  // Forgets everything about this browser's remembered license so a
  // different license/Notion account can be activated from a clean slate,
  // without needing to know and re-enter the previous one first. Purely
  // local -- doesn't touch the server-side tenant record.
  const handleReset = () => {
    try { localStorage.removeItem(STORED_LICENSE_KEY); } catch { /* ignore */ }
    setLicenseKey('');
    setNotionToken('');
    setSpecialDaysDatabaseId('');
    setSources([{ id: makeId(), label: '', databaseId: '', topicFacetKey: '', typeFacetKey: '' }]);
    setSavedViews([]);
    setHasExistingToken(false);
    setTenantId('');
    setSelectedForEmbed([]);
    setStatus('idle');
    setShowLookup(false);
    setLookupLicenseKey('');
    setErrorMessage('');
  };

  const validSources = sources.filter(s => s.databaseId.trim());
  const allSelected = selectedForEmbed.length === validSources.length;
  const embedUrl = tenantId ? buildEmbedUrl(tenantId, allSelected ? null : selectedForEmbed) : '';

  const toggleEmbedSource = (databaseId) => {
    setSelectedForEmbed(prev => prev.includes(databaseId) ? prev.filter(id => id !== databaseId) : [...prev, databaseId]);
  };

  const inputClass = 'w-full px-3 py-2 rounded border text-sm outline-none transition-colors focus:border-[var(--theme-primary,#f43f5e)]';
  const inputStyle = { backgroundColor: colors.card, borderColor: colors.border, color: colors.text };
  const cardClass = 'border rounded-lg';
  const cardStyle = { backgroundColor: colors.card, borderColor: colors.border };
  const primaryButtonClass = 'rounded text-sm font-bold cursor-pointer hover:opacity-90 disabled:cursor-not-allowed disabled:hover:opacity-100';
  // A disabled button needs to look clearly inert, not just a slightly
  // paler version of the same color -- opacity alone on a bright primary
  // color still reads as "active but faint," which is exactly what looked
  // like a broken/unresponsive Save Link button in practice.
  const primaryButtonStyle = (disabled) => disabled
    ? { backgroundColor: colors.border, color: colors.faint }
    : { backgroundColor: colors.primary, color: '#fff' };

  return (
    <div className={embedded ? 'space-y-5' : 'min-h-screen bg-neutral-950 text-neutral-100 flex justify-center px-4 py-12'}>
      <div className={embedded ? '' : 'w-full max-w-xl space-y-6'}>
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold">Creator Timeline Setup</h1>
            <p className="text-sm mt-1" style={{ color: colors.muted }}>
              Connect your own Notion workspace to activate your license. Your Notion token stays on our server and is never shared with anyone viewing your calendar.
            </p>
          </div>
        )}

        <div className={embedded ? 'space-y-5' : 'space-y-6'}>
          {licenseKey && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                className="text-xs font-bold underline cursor-pointer opacity-70 hover:opacity-100"
              >
                Reset (use a different license)
              </button>
            </div>
          )}

          {status !== 'done' && !licenseKey && (
            <div className={`p-3 ${cardClass}`} style={cardStyle}>
              {autoLoading ? (
                <p className="text-sm" style={{ color: colors.muted }}>Checking for an existing setup on this device...</p>
              ) : !showLookup ? (
                <button
                  type="button"
                  onClick={() => { setShowLookup(true); setLookupLicenseKey(licenseKey); }}
                  className="text-sm underline cursor-pointer opacity-80 hover:opacity-100"
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
                      style={inputStyle}
                    />
                    <button
                      type="submit"
                      disabled={lookupStatus === 'looking'}
                      className={`px-4 py-2 shrink-0 ${primaryButtonClass}`}
                      style={primaryButtonStyle(lookupStatus === 'looking')}
                    >
                      {lookupStatus === 'looking' ? 'Looking up...' : 'Look Up'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowLookup(false)}
                      className="text-sm cursor-pointer px-2 opacity-70 hover:opacity-100"
                    >
                      Cancel
                    </button>
                  </div>
                  {lookupStatus === 'error' && (
                    <div className="p-2 rounded border text-xs" style={{ backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder, color: colors.dangerText }}>{errorMessage}</div>
                  )}
                </form>
              )}
            </div>
          )}

          {status === 'done' ? (
            <div className="space-y-6">
              <div className="p-4 rounded-lg border text-sm" style={{ backgroundColor: colors.successBg, borderColor: colors.successBorder, color: colors.successText }}>
                Activated. Paste the link below into a Notion embed block on any page.
              </div>

              {validSources.length > 1 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: colors.muted }}>
                    Include in this embed's link
                  </label>
                  <div className="space-y-1.5">
                    {validSources.map(s => (
                      <label key={s.id} className={`flex items-center gap-2 p-2 cursor-pointer text-sm ${cardClass}`} style={cardStyle}>
                        <input
                          type="checkbox"
                          checked={selectedForEmbed.includes(s.databaseId.trim())}
                          onChange={() => toggleEmbedSource(s.databaseId.trim())}
                          style={{ accentColor: colors.primary }}
                        />
                        <span>{s.label || 'Untitled database'}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: colors.faint }}>
                    Uncheck databases to generate a filtered link -- e.g. a client-facing page showing only that client's database.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: colors.muted }}>Embed URL</label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={embedUrl}
                    onFocus={(e) => e.target.select()}
                    className={`flex-1 font-mono ${inputClass}`}
                    style={inputStyle}
                  />
                  <button
                    onClick={() => copyText(embedUrl, 'main')}
                    className={`px-4 py-2 shrink-0 ${primaryButtonClass}`}
                    style={primaryButtonStyle(false)}
                  >
                    {copyLabel('main', 'Copy')}
                  </button>
                </div>
              </div>

              <div className={`space-y-2 p-3 ${cardClass}`} style={cardStyle}>
                <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: colors.muted }}>Save this link for later</label>
                <p className="text-xs" style={{ color: colors.faint }}>
                  Give the current selection a name (e.g. "Personal", "Acme Client") so you can come back here and grab it again without reconfiguring.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newViewLabel}
                    onChange={(e) => setNewViewLabel(e.target.value)}
                    placeholder={'e.g. "Acme Client Page"'}
                    className={`flex-1 ${inputClass}`}
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={handleSaveView}
                    disabled={!newViewLabel.trim() || status === 'submitting'}
                    className={`px-4 py-2 shrink-0 ${primaryButtonClass}`}
                    style={primaryButtonStyle(!newViewLabel.trim() || status === 'submitting')}
                  >
                    Save Link
                  </button>
                </div>
              </div>

              {!hideSavedViewsList && savedViews.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: colors.muted }}>Your Saved Links</label>
                  <div className="space-y-1.5">
                    {savedViews.map((v) => (
                      <div key={v.id} className={`flex items-center justify-between gap-2 p-2.5 text-sm ${cardClass}`} style={cardStyle}>
                        <div className="min-w-0">
                          <div className="font-bold truncate">{v.label}</div>
                          <div className="text-xs" style={{ color: colors.faint }}>{v.sources ? `${v.sources.length} database${v.sources.length === 1 ? '' : 's'}` : 'All databases'}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => copyText(buildEmbedUrl(tenantId, v.sources), v.id)}
                            className="text-xs font-bold px-2.5 py-1.5 rounded cursor-pointer hover:opacity-80 transition-opacity"
                            style={{ backgroundColor: colors.border, color: colors.text }}
                          >
                            {copyLabel(v.id, 'Copy')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteView(v.id)}
                            className="text-xs font-bold hover:underline cursor-pointer"
                            style={{ color: colors.dangerText }}
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
                <div className="p-3 rounded border text-sm" style={{ backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder, color: colors.dangerText }}>{errorMessage}</div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStatus('idle')}
                  className={`px-4 py-2 ${primaryButtonClass}`}
                  style={primaryButtonStyle(false)}
                >
                  Reconfigure or add another database
                </button>
                {onContinue && (
                  <button
                    onClick={onContinue}
                    style={{ marginLeft: 'auto', ...primaryButtonStyle(false) }}
                    className={`px-4 py-2 ${primaryButtonClass}`}
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
                  style={inputStyle}
                />
                <p className="text-xs mt-1" style={{ color: colors.faint }}>Found in your Gumroad purchase receipt email.</p>
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
                  style={inputStyle}
                />
                {hasExistingToken && (
                  <p className="text-xs mt-1" style={{ color: colors.faint }}>A token is already on file -- only fill this in if you want to replace it.</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold">Databases to Show</label>
                  <button
                    type="button"
                    onClick={addSource}
                    className="text-xs font-bold cursor-pointer underline opacity-80 hover:opacity-100"
                  >
                    + Add Database
                  </button>
                </div>
                <div className="space-y-2">
                  {sources.map((source) => (
                    <div key={source.id} className={`flex items-start gap-2 p-2 ${cardClass}`} style={cardStyle}>
                      <div className="flex-1 space-y-1.5">
                        <input
                          type="text"
                          value={source.label}
                          onChange={(e) => updateSource(source.id, 'label', e.target.value)}
                          placeholder={'Label, e.g. "Project Tracking"'}
                          className="w-full px-2.5 py-1.5 rounded border text-xs font-bold outline-none"
                          style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
                        />
                        <input
                          type="text"
                          required
                          value={source.databaseId}
                          onChange={(e) => updateSource(source.id, 'databaseId', e.target.value)}
                          placeholder="Database ID: 3728d5a5..."
                          className="w-full px-2.5 py-1.5 rounded border text-xs outline-none"
                          style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
                        />
                        {facetCandidates && (
                          (facetCandidates[source.label] && facetCandidates[source.label].length > 0) ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={source.topicFacetKey}
                                  onChange={(e) => updateSource(source.id, 'topicFacetKey', e.target.value)}
                                  className="flex-1 px-2 py-1 rounded border text-[11px] outline-none"
                                  style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
                                >
                                  <option value="">Topic: Auto (recommended)</option>
                                  {facetCandidates[source.label].map(f => (
                                    <option key={f.key} value={f.key}>Topic: {f.label} ({f.type})</option>
                                  ))}
                                </select>
                                <select
                                  value={source.typeFacetKey}
                                  onChange={(e) => updateSource(source.id, 'typeFacetKey', e.target.value)}
                                  className="flex-1 px-2 py-1 rounded border text-[11px] outline-none"
                                  style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.text }}
                                >
                                  <option value="">Type: Auto (recommended)</option>
                                  {facetCandidates[source.label].map(f => (
                                    <option key={f.key} value={f.key}>Type: {f.label} ({f.type})</option>
                                  ))}
                                </select>
                              </div>
                              <p className="text-[10px]" style={{ color: colors.faint }}>
                                Overrides automatic detection for this database. Leave both on Auto to keep the current behavior.
                              </p>
                            </div>
                          ) : (
                            <p className="text-[10px]" style={{ color: colors.faint }}>Sync at least once to enable manual topic/type selection here.</p>
                          )
                        )}
                      </div>
                      {sources.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeSource(source.id)}
                          className="text-xs font-bold hover:underline cursor-pointer px-1 py-1.5 shrink-0"
                          style={{ color: colors.dangerText }}
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
                  style={inputStyle}
                />
              </div>

              {!hideSavedViewsList && savedViews.length > 0 && (
                <div className="space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wide" style={{ color: colors.muted }}>Your Saved Links</label>
                  <div className="space-y-1.5">
                    {savedViews.map((v) => (
                      <div key={v.id} className={`flex items-center justify-between gap-2 p-2.5 text-sm ${cardClass}`} style={cardStyle}>
                        <div className="min-w-0">
                          <div className="font-bold truncate">{v.label}</div>
                          <div className="text-xs" style={{ color: colors.faint }}>{v.sources ? `${v.sources.length} database${v.sources.length === 1 ? '' : 's'}` : 'All databases'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyText(buildEmbedUrl(tenantId, v.sources), v.id)}
                          className="text-xs font-bold px-2.5 py-1.5 rounded cursor-pointer hover:opacity-80 transition-opacity shrink-0"
                          style={{ backgroundColor: colors.border, color: colors.text }}
                        >
                          {copiedKey === v.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {status === 'error' && (
                <div className="p-3 rounded border text-sm" style={{ backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder, color: colors.dangerText }}>
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'submitting'}
                className={`w-full py-2.5 ${primaryButtonClass}`}
                style={primaryButtonStyle(status === 'submitting')}
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
