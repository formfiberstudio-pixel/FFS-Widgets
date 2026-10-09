import { useState } from 'react';
import { LICENSE_KEY_STORAGE } from './account.js';

// The sign-in screen's form: the license key the account was activated with.
// It finds that account (api/tenant-lookup.js, which also checks the license is
// still valid) and hands its id to onSignedIn. A license that has never been set
// up says so and offers the setup instead (onSetUp).
//
// Colours follow the app's theme through the --theme-* variables.
export default function SignInPanel({ onSignedIn, onSetUp }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [status, setStatus] = useState('idle'); // idle | looking | error | notSetUp
  const [message, setMessage] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const key = licenseKey.trim();
    if (!key) return;
    setStatus('looking');
    setMessage('');
    try {
      const res = await fetch('/api/tenant-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setStatus('notSetUp');
        return;
      }
      if (!res.ok || !data.success || !data.tenantId) throw new Error(data.error || 'Could not sign in.');
      // Kept on this device so Settings > Connection can load the setup without asking again.
      try { localStorage.setItem(LICENSE_KEY_STORAGE, key); } catch { /* optional */ }
      onSignedIn(data.tenantId);
    } catch (err) {
      setMessage(err.message || 'Could not sign in.');
      setStatus('error');
    }
  };

  const muted = 'color-mix(in srgb, var(--theme-text) 65%, transparent)';

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <label htmlFor="sign-in-license" className="block text-xs font-bold mb-1 opacity-70">License key</label>
        <input
          id="sign-in-license"
          type="text"
          value={licenseKey}
          onChange={(e) => { setLicenseKey(e.target.value); if (status !== 'looking') setStatus('idle'); }}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="The key from your purchase receipt"
          className="w-full px-3 py-2.5 rounded-lg border text-sm outline-none"
          style={{ backgroundColor: 'var(--theme-bg)', borderColor: 'var(--theme-border)', color: 'var(--theme-text)' }}
        />
      </div>

      {status === 'error' && (
        <div className="text-xs p-2.5 rounded-lg border" style={{ color: '#e11d48', backgroundColor: 'rgba(244, 63, 94, 0.1)', borderColor: 'rgba(244, 63, 94, 0.35)' }}>
          {message}
        </div>
      )}

      {status === 'notSetUp' && (
        <div className="text-xs p-2.5 rounded-lg border space-y-2" style={{ borderColor: 'var(--theme-border)', backgroundColor: 'var(--theme-bg)' }}>
          <div>This license is valid, but no calendar has been set up with it yet.</div>
          <button
            type="button"
            onClick={onSetUp}
            className="font-bold underline cursor-pointer"
            style={{ color: 'var(--theme-primary)' }}
          >
            Set up a calendar with this license
          </button>
        </div>
      )}

      <button
        type="submit"
        disabled={!licenseKey.trim() || status === 'looking'}
        className="w-full py-2.5 rounded-lg text-sm font-bold cursor-pointer disabled:opacity-50 disabled:cursor-default"
        style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary, #fff)' }}
      >
        {status === 'looking' ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-xs text-center" style={{ color: muted }}>
        New here?{' '}
        <button type="button" onClick={onSetUp} className="font-bold underline cursor-pointer" style={{ color: 'var(--theme-primary)' }}>
          Set up a new calendar
        </button>
      </p>
    </form>
  );
}
