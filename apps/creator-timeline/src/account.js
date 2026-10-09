// Which account (tenant) this device shows, and what signing out leaves behind.
// Pure -- the storage and the page are passed in -- so the rules can be tested.
//
// An account used to be only the ?tenant= in the address, so the Android app (whose
// start address was built with the owner's tenant) and an installed web app (whose
// start_url carries it) were permanently signed in as that one account. Now a device
// REMEMBERS its account, and a person can leave it:
//
//  - Signing in (a license key, see SignInPanel) saves the account on the device.
//  - Signing out forgets it, clears what this device kept of it (see
//    clearAccountData), and marks the device signed out.
//
// Installed apps (the Android app, an installed web app) start from the same
// address every time, so there the device's own choice wins over the address:
// otherwise the address would sign the person straight back in. In an ordinary
// browser tab the address wins -- an embed, a shared link or a bookmark says whose
// calendar it is.

export const SAVED_TENANT_KEY = 'notionWidgetTenant';
export const SIGNED_OUT_KEY = 'notionWidgetSignedOut';
export const LICENSE_KEY_STORAGE = 'notionWidgetLicenseKey';

const read = (storage, key) => {
  try { return storage.getItem(key); } catch { return null; }
};
const write = (storage, key, value) => {
  try { storage.setItem(key, value); } catch { /* storage unavailable -- non-fatal */ }
};
const remove = (storage, key) => {
  try { storage.removeItem(key); } catch { /* ignore */ }
};

// Is this the Android app, or an installed web app (opened from the home screen),
// rather than a tab in a browser? `win` is the window.
export function isInstalledApp(win) {
  try {
    if (win.Capacitor?.isNativePlatform?.()) return true;
    if (win.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    return win.navigator?.standalone === true;
  } catch {
    return false;
  }
}

// Whose calendar to show: { tenantId, from } where `from` is 'saved' (this device's
// own account), 'link' (the address) or null (nobody -- show the sign-in screen).
export function resolveAccount({ urlTenant, storage, installed }) {
  const saved = read(storage, SAVED_TENANT_KEY);
  const signedOut = read(storage, SIGNED_OUT_KEY) === '1';
  if (installed) {
    if (saved) return { tenantId: saved, from: 'saved' };
    // The start address still names the account that was left; it must not bring it back.
    if (signedOut) return { tenantId: null, from: null };
    if (urlTenant) return { tenantId: urlTenant, from: 'link' };
    return { tenantId: null, from: null };
  }
  if (urlTenant) return { tenantId: urlTenant, from: 'link' };
  if (saved && !signedOut) return { tenantId: saved, from: 'saved' };
  return { tenantId: null, from: null };
}

// This device's account is now `tenantId` (a sign-in, or an installed app picking up
// the account its start address names).
export function rememberAccount(storage, tenantId) {
  write(storage, SAVED_TENANT_KEY, tenantId);
  remove(storage, SIGNED_OUT_KEY);
}

// What this device keeps of an account. Not here: the display choices that belong
// to the device (theme, view scale, panel sizes, the dots/blocks layout).
const ACCOUNT_KEYS = [
  SAVED_TENANT_KEY,
  LICENSE_KEY_STORAGE,
  'notionWidgetCustomProjectColors',
  'notionWidgetCustomCategoryColors',
  'notionWidgetColorFacetBySource',
  'notionWidgetThumbnails',
];
const ACCOUNT_KEY_PREFIXES = [
  'notionWidgetCache:',
  'notionWidgetTimer:',
  'notionWidgetProjectOrderUnsaved:',
  'notionWidgetColorsUnsaved:',
  'notionWidgetColorsSeen:',
];

// Forgets the account and everything this device kept of it, so the next account
// starts clean (its colours, cached calendar and photo picks would otherwise be
// mixed with the last one's), and marks the device signed out. Returns the keys
// removed.
export function clearAccountData(storage) {
  const found = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && (ACCOUNT_KEYS.includes(key) || ACCOUNT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))) found.push(key);
    }
  } catch { /* storage unavailable */ }
  found.forEach((key) => remove(storage, key));
  write(storage, SIGNED_OUT_KEY, '1');
  return found;
}

// The last few characters of an account id, to tell accounts apart on screen
// without printing the whole thing (the id is what opens the calendar).
export function shortAccountId(tenantId) {
  return typeof tenantId === 'string' && tenantId.length > 6 ? `…${tenantId.slice(-6)}` : tenantId || '';
}
