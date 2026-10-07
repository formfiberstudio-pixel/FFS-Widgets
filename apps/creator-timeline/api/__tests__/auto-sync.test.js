import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLongBreak, shouldAutoSync, AUTO_SYNC_AFTER_MS, AUTO_SYNC_MIN_GAP_MS } from '../../src/autoSync.js';

const NOW = 1_800_000_000_000;
const MINUTE = 60 * 1000;

test('a long break is an hour or more with no sign of use', () => {
  assert.equal(AUTO_SYNC_AFTER_MS, 60 * MINUTE);
  assert.equal(isLongBreak({ now: NOW, lastActiveAt: NOW - AUTO_SYNC_AFTER_MS }), true);
  assert.equal(isLongBreak({ now: NOW, lastActiveAt: NOW - 8 * 60 * MINUTE }), true);
});

test('anything shorter is not: a coffee, a meeting, even most of an hour', () => {
  assert.equal(isLongBreak({ now: NOW, lastActiveAt: NOW - 5 * MINUTE }), false);
  assert.equal(isLongBreak({ now: NOW, lastActiveAt: NOW - 59 * MINUTE }), false);
  assert.equal(isLongBreak({ now: NOW, lastActiveAt: NOW - AUTO_SYNC_AFTER_MS + 1 }), false);
  assert.equal(isLongBreak({ now: NOW, lastActiveAt: NOW }), false);
});

test('with no idea when it was last used, it is not called a long break', () => {
  assert.equal(isLongBreak({ now: NOW, lastActiveAt: 0 }), false);
  assert.equal(isLongBreak({ now: NOW, lastActiveAt: undefined }), false);
});

test('using the widget for hours without a break never makes a sync owed', () => {
  // the last sign of use is always seconds ago, however long ago it was last synced
  for (let hoursIn = 1; hoursIn <= 6; hoursIn++) {
    assert.equal(isLongBreak({ now: NOW + hoursIn * 60 * MINUTE, lastActiveAt: NOW + hoursIn * 60 * MINUTE - 20 * 1000 }), false);
  }
});

const owedAndFree = { now: NOW, owed: true, hidden: false, isDemoMode: false, tenantId: 'tenant-abc', busy: false, viewMode: 'year' };

test('an owed sync runs when the widget is shown and free to', () => {
  assert.equal(shouldAutoSync(owedAndFree), true);
  for (const viewMode of ['year', 'month', 'week', 'day', 'gallery']) assert.equal(shouldAutoSync({ ...owedAndFree, viewMode }), true, viewMode);
});

test('nothing is owed, nothing runs', () => {
  assert.equal(shouldAutoSync({ ...owedAndFree, owed: false }), false);
  assert.equal(shouldAutoSync({ ...owedAndFree, owed: undefined }), false);
});

test('nothing to sync with, or nobody looking, means no sync (it stays owed for later)', () => {
  assert.equal(shouldAutoSync({ ...owedAndFree, hidden: true }), false);
  assert.equal(shouldAutoSync({ ...owedAndFree, isDemoMode: true }), false);
  assert.equal(shouldAutoSync({ ...owedAndFree, tenantId: null }), false);
});

test('not while a sync is already running, or in the middle of an import', () => {
  assert.equal(shouldAutoSync({ ...owedAndFree, busy: true }), false);
  assert.equal(shouldAutoSync({ ...owedAndFree, viewMode: 'import' }), false);
});

test('attempts are spaced out, so several events at once (or a failure) do not loop', () => {
  assert.equal(shouldAutoSync({ ...owedAndFree, lastAttemptAt: NOW - 1000 }), false);
  assert.equal(shouldAutoSync({ ...owedAndFree, lastAttemptAt: NOW - AUTO_SYNC_MIN_GAP_MS + 1 }), false);
  assert.equal(shouldAutoSync({ ...owedAndFree, lastAttemptAt: NOW - AUTO_SYNC_MIN_GAP_MS }), true);
});
