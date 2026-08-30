import { useState, useEffect } from 'react';

const ADMIN_KEY_SESSION = 'creatorTimelineAdminKey';

function formatDate(ms) {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Lists and revokes family (bypass key) tenants. Gated on the bare
// OWNER_BYPASS_KEY -- there's no separate admin account/password to
// manage, it's the same secret used to grant free access in the first
// place. Never shows or touches real paying customers' tenants.
export default function Admin() {
  const [adminKey, setAdminKey] = useState(() => {
    try { return sessionStorage.getItem(ADMIN_KEY_SESSION) || ''; } catch { return ''; }
  });
  const [keyInput, setKeyInput] = useState('');
  const [tenants, setTenants] = useState(null); // null = not loaded yet
  const [status, setStatus] = useState('idle'); // idle | loading | error
  const [errorMessage, setErrorMessage] = useState('');
  const [revokingId, setRevokingId] = useState('');

  const loadTenants = async (key) => {
    setStatus('loading');
    setErrorMessage('');
    try {
      const res = await fetch('/api/admin/list-family-tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey: key }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not load tenants');
      setTenants(data.tenants);
      setAdminKey(key);
      try { sessionStorage.setItem(ADMIN_KEY_SESSION, key); } catch { /* ignore */ }
      setStatus('idle');
    } catch (err) {
      setErrorMessage(err.message || 'Could not load tenants');
      setStatus('error');
      setTenants(null);
    }
  };

  const handleUnlock = (e) => {
    e.preventDefault();
    loadTenants(keyInput);
  };

  const handleRevoke = async (tenantId, label) => {
    if (!window.confirm(`Revoke access for "${label}"? Their embed will stop working immediately.`)) return;
    setRevokingId(tenantId);
    try {
      const res = await fetch('/api/admin/revoke-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminKey, tenantId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not revoke');
      setTenants((prev) => prev.filter((t) => t.tenantId !== tenantId));
    } catch (err) {
      setErrorMessage(err.message || 'Could not revoke that tenant');
    } finally {
      setRevokingId('');
    }
  };

  const handleLock = () => {
    setAdminKey('');
    setTenants(null);
    setKeyInput('');
    try { sessionStorage.removeItem(ADMIN_KEY_SESSION); } catch { /* ignore */ }
  };

  const inputClass = 'w-full px-3 py-2 rounded border text-sm outline-none border-neutral-700 bg-neutral-900 text-neutral-100 focus:border-neutral-400';
  const cardClass = 'border rounded-lg border-neutral-800 bg-neutral-900';

  // Auto-load once on mount if a key is already remembered for this tab session.
  useEffect(() => {
    if (adminKey) loadTenants(adminKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Family Tenants</h1>
            <p className="text-sm text-neutral-400 mt-1">Family activations created with your FAMILY_BYPASS_KEY. Your own tenant isn't listed here.</p>
          </div>
          {adminKey && (
            <button onClick={handleLock} className="text-sm text-neutral-400 hover:text-neutral-200 underline cursor-pointer">Lock</button>
          )}
        </div>

        {!adminKey ? (
          <form onSubmit={handleUnlock} className={`p-4 space-y-3 ${cardClass}`}>
            <label className="block text-xs font-bold">Owner Bypass Key</label>
            <input
              type="password"
              required
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="Your bare OWNER_BYPASS_KEY (no suffix)"
              className={inputClass}
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full py-2.5 rounded bg-white text-black text-sm font-bold cursor-pointer hover:opacity-90 disabled:opacity-50"
            >
              {status === 'loading' ? 'Checking...' : 'Unlock'}
            </button>
            {status === 'error' && (
              <div className="p-2 rounded bg-rose-950 border border-rose-800 text-rose-200 text-xs">{errorMessage}</div>
            )}
          </form>
        ) : (
          <div className="space-y-3">
            {status === 'loading' && <p className="text-sm text-neutral-400">Loading...</p>}
            {errorMessage && (
              <div className="p-3 rounded bg-rose-950 border border-rose-800 text-rose-200 text-sm">{errorMessage}</div>
            )}
            {tenants && tenants.length === 0 && (
              <p className="text-sm text-neutral-400">No family tenants yet -- they'll show up here once someone activates with a key starting with your FAMILY_BYPASS_KEY.</p>
            )}
            {tenants && tenants.map((t) => (
              <div key={t.tenantId} className={`flex items-center justify-between gap-3 p-3 ${cardClass}`}>
                <div className="min-w-0">
                  <div className="font-bold truncate">{t.label}</div>
                  <div className="text-xs text-neutral-500">
                    {t.databaseCount} database{t.databaseCount === 1 ? '' : 's'} &middot; last verified {formatDate(t.lastVerifiedAt)}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(t.tenantId, t.label)}
                  disabled={revokingId === t.tenantId}
                  className="text-xs font-bold px-3 py-1.5 rounded bg-rose-950 border border-rose-800 text-rose-200 cursor-pointer hover:bg-rose-900 disabled:opacity-50 shrink-0"
                >
                  {revokingId === t.tenantId ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
