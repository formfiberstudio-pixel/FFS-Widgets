import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAccount, rememberAccount, clearAccountData, isInstalledApp, shortAccountId,
  SAVED_TENANT_KEY, SIGNED_OUT_KEY, LICENSE_KEY_STORAGE,
} from '../../src/account.js';

// A stand-in for localStorage.
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()],
  };
}

test('in a browser tab the address says whose calendar it is, even if the device has an account', () => {
  const storage = makeStorage({ [SAVED_TENANT_KEY]: 'saved1' });
  assert.deepEqual(resolveAccount({ urlTenant: 'link1', storage, installed: false }), { tenantId: 'link1', from: 'link' });
});

test('in a browser tab with no address account, the device\'s own account is used -- unless it signed out', () => {
  assert.deepEqual(resolveAccount({ urlTenant: null, storage: makeStorage({ [SAVED_TENANT_KEY]: 'saved1' }), installed: false }), { tenantId: 'saved1', from: 'saved' });
  assert.deepEqual(resolveAccount({ urlTenant: null, storage: makeStorage({ [SAVED_TENANT_KEY]: 'saved1', [SIGNED_OUT_KEY]: '1' }), installed: false }), { tenantId: null, from: null });
  assert.deepEqual(resolveAccount({ urlTenant: null, storage: makeStorage(), installed: false }), { tenantId: null, from: null });
});

test('an embed link still opens its calendar in a tab after the device signed out', () => {
  const storage = makeStorage({ [SIGNED_OUT_KEY]: '1' });
  assert.deepEqual(resolveAccount({ urlTenant: 'embed1', storage, installed: false }), { tenantId: 'embed1', from: 'link' });
});

test('an installed app starts from the same address every time, so the device\'s own account wins', () => {
  const storage = makeStorage({ [SAVED_TENANT_KEY]: 'saved1' });
  assert.deepEqual(resolveAccount({ urlTenant: 'owner-from-start-address', storage, installed: true }), { tenantId: 'saved1', from: 'saved' });
});

test('an installed app that has never chosen takes the account its start address names', () => {
  assert.deepEqual(resolveAccount({ urlTenant: 'owner', storage: makeStorage(), installed: true }), { tenantId: 'owner', from: 'link' });
});

test('an installed app that signed out is not signed back in by its start address', () => {
  const storage = makeStorage({ [SIGNED_OUT_KEY]: '1' });
  assert.deepEqual(resolveAccount({ urlTenant: 'owner', storage, installed: true }), { tenantId: null, from: null });
});

test('signing in saves the account and clears the signed-out mark', () => {
  const storage = makeStorage({ [SIGNED_OUT_KEY]: '1' });
  rememberAccount(storage, 'new1');
  assert.equal(storage.getItem(SAVED_TENANT_KEY), 'new1');
  assert.equal(storage.getItem(SIGNED_OUT_KEY), null);
  // ...and an installed app whose start address names someone else now shows the new account
  assert.deepEqual(resolveAccount({ urlTenant: 'old-owner', storage, installed: true }), { tenantId: 'new1', from: 'saved' });
});

test('signing out forgets the account and what the device kept of it, and leaves the device\'s own settings', () => {
  const storage = makeStorage({
    [SAVED_TENANT_KEY]: 'a1',
    [LICENSE_KEY_STORAGE]: 'key',
    notionWidgetCustomProjectColors: '{"P":"#fff"}',
    notionWidgetCustomCategoryColors: '{}',
    notionWidgetColorFacetBySource: '{}',
    notionWidgetThumbnails: '{}',
    'notionWidgetCache:a1:all': '{"data":[]}',
    'notionWidgetCache:a1:db-1': '{"data":[]}',
    'notionWidgetTimer:a1': '{}',
    'notionWidgetProjectOrderUnsaved:a1': '1',
    'notionWidgetColorsUnsaved:a1': '1',
    'notionWidgetColorsSeen:a1': '1',
    // belong to the device, not the account
    notionWidgetActiveThemeId: 'default-rose',
    notionWidgetViewScale: '110',
    notionWidgetYearLayout: 'blocks',
    notionWidgetSidebarWidth: '300',
    somethingElse: 'x',
  });
  const removed = clearAccountData(storage);
  assert.equal(removed.length, 12);
  assert.deepEqual(storage.keys().sort(), [
    'notionWidgetActiveThemeId', 'notionWidgetSidebarWidth', 'notionWidgetViewScale', 'notionWidgetYearLayout',
    SIGNED_OUT_KEY, 'somethingElse',
  ].sort());
  assert.equal(storage.getItem(SIGNED_OUT_KEY), '1');
  // and the device now shows nobody
  assert.deepEqual(resolveAccount({ urlTenant: null, storage, installed: true }), { tenantId: null, from: null });
});

test('storage that throws does not break signing out or resolving', () => {
  const broken = {
    get length() { throw new Error('blocked'); },
    key() { throw new Error('blocked'); },
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.deepEqual(clearAccountData(broken), []);
  assert.deepEqual(resolveAccount({ urlTenant: 'x', storage: broken, installed: true }), { tenantId: 'x', from: 'link' });
  rememberAccount(broken, 'x'); // no throw
});

test('installed means the Android app or a web app opened from the home screen', () => {
  assert.equal(isInstalledApp({ Capacitor: { isNativePlatform: () => true } }), true);
  assert.equal(isInstalledApp({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(isInstalledApp({ navigator: { standalone: true } }), true);
  assert.equal(isInstalledApp({ Capacitor: { isNativePlatform: () => false }, matchMedia: () => ({ matches: false }), navigator: {} }), false);
  assert.equal(isInstalledApp({}), false);
});

test('an account is told apart by the end of its id, never the whole of it', () => {
  assert.equal(shortAccountId('687d3b360d0542843dc858ebb85b034d'), '…5b034d');
  assert.equal(shortAccountId('abc'), 'abc');
  assert.equal(shortAccountId(null), '');
});
