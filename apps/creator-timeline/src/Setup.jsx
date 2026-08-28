import { useState } from 'react';

function makeId() {
  return crypto.randomUUID();
}

export default function Setup() {
  const [licenseKey, setLicenseKey] = useState('');
  const [notionToken, setNotionToken] = useState('');
  const [specialDaysDatabaseId, setSpecialDaysDatabaseId] = useState('');
  const [sources, setSources] = useState([{ id: makeId(), label: '', databaseId: '' }]);
  const [status, setStatus] = useState('idle'); // idle | submitting | error | done
  const [errorMessage, setErrorMessage] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [selectedForEmbed, setSelectedForEmbed] = useState([]); // databaseIds included in the copyable URL
  const [copied, setCopied] = useState(false);

  const addSource = () => setSources(prev => [...prev, { id: makeId(), label: '', databaseId: '' }]);
  const removeSource = (id) => setSources(prev => prev.filter(s => s.id !== id));
  const updateSource = (id, field, value) => setSources(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));

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
          notionToken,
          specialDaysDatabaseId,
          sources: sources.map(s => ({ label: s.label, databaseId: s.databaseId })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Setup failed');
      }
      setTenantId(data.tenantId);
      setSelectedForEmbed(sources.filter(s => s.databaseId.trim()).map(s => s.databaseId.trim()));
      setStatus('done');
    } catch (err) {
      setErrorMessage(err.message || 'Something went wrong');
      setStatus('error');
    }
  };

  const validSources = sources.filter(s => s.databaseId.trim());
  const allSelected = selectedForEmbed.length === validSources.length;
  const embedUrl = tenantId
    ? `${window.location.origin}/${allSelected ? `?tenant=${tenantId}` : `?tenant=${tenantId}&sources=${selectedForEmbed.join(',')}`}`
    : '';

  const toggleEmbedSource = (databaseId) => {
    setSelectedForEmbed(prev => prev.includes(databaseId) ? prev.filter(id => id !== databaseId) : [...prev, databaseId]);
    setCopied(false);
  };

  const copyEmbedUrl = async () => {
    try {
      await navigator.clipboard.writeText(embedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (permissions, insecure context) -- the URL is still shown to copy manually.
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex justify-center px-4 py-12">
      <div className="w-full max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Creator Timeline Setup</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Connect your own Notion workspace to activate your license. Your Notion token stays on our server and is never shared with anyone viewing your calendar.
          </p>
        </div>

        {status === 'done' ? (
          <div className="space-y-5">
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
                    <label key={s.id} className="flex items-center gap-2 p-2 rounded border border-neutral-800 bg-neutral-900 cursor-pointer text-sm">
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
                  className="flex-1 px-3 py-2 rounded border border-neutral-700 bg-neutral-900 text-sm font-mono"
                />
                <button
                  onClick={copyEmbedUrl}
                  className="px-4 py-2 rounded bg-white text-black text-sm font-bold shrink-0 cursor-pointer hover:opacity-90"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <button
              onClick={() => setStatus('idle')}
              className="text-sm text-neutral-400 hover:text-neutral-200 underline cursor-pointer"
            >
              Reconfigure or add another database
            </button>
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
                className="w-full px-3 py-2 rounded border border-neutral-700 bg-neutral-900 text-sm outline-none focus:border-neutral-400"
              />
              <p className="text-xs text-neutral-500 mt-1">Found in your Gumroad purchase receipt email.</p>
            </div>

            <div>
              <label className="block text-xs font-bold mb-1.5">Notion Integration Token</label>
              <input
                type="password"
                required
                value={notionToken}
                onChange={(e) => setNotionToken(e.target.value)}
                placeholder="secret_..."
                className="w-full px-3 py-2 rounded border border-neutral-700 bg-neutral-900 text-sm outline-none focus:border-neutral-400"
              />
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
                  <div key={source.id} className="flex items-start gap-2 p-2 rounded border border-neutral-800 bg-neutral-900">
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
                className="w-full px-3 py-2 rounded border border-neutral-700 bg-neutral-900 text-sm outline-none focus:border-neutral-400"
              />
            </div>

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
              {status === 'submitting' ? 'Activating...' : 'Activate'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
