import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTimerOp,
  TimerOpError,
  validTimerPhotoDataUrl,
  validTimerPhotoId,
  MAX_TIMER_PHOTO_DATA_URL_LENGTH,
} from '../_lib/timerState.js';
import { MAX_SESSION_NOTES, MAX_SESSION_PHOTOS } from '../_lib/timeTracking.js';

const T0 = 1_760_000_000_000;
const PROJECT = { key: 'Activity Log::Blog', title: 'Blog', source: 'Activity Log', referenceLogId: 'ref-1', projectType: 'Writing', projectTypeColor: '#f90' };
const photoId = (n) => `photo-${String(n).padStart(4, '0')}`;

const started = () => applyTimerOp(null, 'start', { project: PROJECT }, T0).timer;

test('start makes a timer on the server clock, with nothing in it yet', () => {
  const { timer, existing } = applyTimerOp(null, 'start', { project: PROJECT, startedAt: 12345 }, T0);
  assert.equal(existing, undefined);
  assert.equal(timer.startedAt, T0); // the device's own start time is ignored
  assert.equal(timer.version, 1);
  assert.deepEqual(timer.project, PROJECT);
  assert.deepEqual([timer.notes, timer.photos, timer.pausedMs], [[], [], 0]);
});

test('starting while a timer runs hands back the running one', () => {
  const running = started();
  const { timer, existing } = applyTimerOp(running, 'start', { project: { ...PROJECT, key: 'other', title: 'Other' } }, T0 + 5000);
  assert.equal(timer, running);
  assert.equal(existing, true);
});

test('a project needs its identifying fields', () => {
  for (const bad of [null, {}, { ...PROJECT, key: '' }, { ...PROJECT, title: undefined }, { ...PROJECT, referenceLogId: 7 }]) {
    assert.throws(() => applyTimerOp(null, 'start', { project: bad }, T0), TimerOpError);
  }
});

test('pause then resume adds the time spent paused, and counts each change', () => {
  const paused = applyTimerOp(started(), 'pause', {}, T0 + 60000).timer;
  assert.equal(paused.pausedAt, T0 + 60000);
  assert.equal(paused.version, 2);
  const resumed = applyTimerOp(paused, 'resume', {}, T0 + 90000).timer;
  assert.equal(resumed.pausedAt, undefined);
  assert.equal(resumed.pausedMs, 30000);
  assert.equal(resumed.version, 3);
});

test('pausing a paused timer, or resuming a running one, changes nothing', () => {
  const paused = applyTimerOp(started(), 'pause', {}, T0 + 1000).timer;
  assert.equal(applyTimerOp(paused, 'pause', {}, T0 + 2000).timer, paused);
  const running = started();
  assert.equal(applyTimerOp(running, 'resume', {}, T0 + 2000).timer, running);
});

test('an operation that needs a timer finds none: the answer is no timer, not an error', () => {
  for (const op of ['pause', 'resume', 'addNote', 'removeNote', 'addPhoto', 'removePhoto']) {
    assert.deepEqual(applyTimerOp(null, op, { text: 'x', id: photoId(1), at: 1 }, T0), { timer: null }, op);
  }
  assert.deepEqual(applyTimerOp(null, 'get', {}, T0), { timer: null });
});

test('notes are cleaned, stamped with the server time, and appended -- so two devices both keep theirs', () => {
  let timer = started();
  timer = applyTimerOp(timer, 'addNote', { text: '  outlined\n the   intro ' }, T0 + 1000).timer; // from the computer
  timer = applyTimerOp(timer, 'addNote', { text: 'took a photo' }, T0 + 2000).timer; // from the phone
  assert.deepEqual(timer.notes, [{ at: T0 + 1000, text: 'outlined the intro' }, { at: T0 + 2000, text: 'took a photo' }]);
});

test('a note can\'t be empty, and there is a limit', () => {
  assert.throws(() => applyTimerOp(started(), 'addNote', { text: '   ' }, T0), TimerOpError);
  assert.throws(() => applyTimerOp(started(), 'addNote', { text: 42 }, T0), TimerOpError);
  let timer = started();
  for (let i = 0; i < MAX_SESSION_NOTES; i++) timer = applyTimerOp(timer, 'addNote', { text: `n${i}` }, T0 + i).timer;
  assert.throws(() => applyTimerOp(timer, 'addNote', { text: 'one too many' }, T0), /limit/);
});

test('removing a note matches on its time and text', () => {
  let timer = started();
  timer = applyTimerOp(timer, 'addNote', { text: 'keep' }, T0 + 1000).timer;
  timer = applyTimerOp(timer, 'addNote', { text: 'drop' }, T0 + 2000).timer;
  assert.deepEqual(applyTimerOp(timer, 'removeNote', { at: T0 + 2000, text: 'drop' }, T0 + 3000).timer.notes.map((n) => n.text), ['keep']);
  assert.equal(applyTimerOp(timer, 'removeNote', { at: T0 + 2000, text: 'wrong text' }, T0 + 3000).timer, timer);
});

test('photos are listed by id, once each, up to the limit', () => {
  let timer = started();
  timer = applyTimerOp(timer, 'addPhoto', { id: photoId(1) }, T0 + 1000).timer;
  assert.deepEqual(timer.photos, [{ id: photoId(1), at: T0 + 1000 }]);
  assert.equal(applyTimerOp(timer, 'addPhoto', { id: photoId(1) }, T0 + 2000).timer, timer); // the same photo twice
  assert.throws(() => applyTimerOp(timer, 'addPhoto', { id: 'x' }, T0), TimerOpError);
  assert.throws(() => applyTimerOp(timer, 'addPhoto', { id: '../../etc/passwd-and-more' }, T0), TimerOpError);
  for (let i = 2; i <= MAX_SESSION_PHOTOS; i++) timer = applyTimerOp(timer, 'addPhoto', { id: photoId(i) }, T0 + i).timer;
  assert.equal(timer.photos.length, MAX_SESSION_PHOTOS);
  assert.throws(() => applyTimerOp(timer, 'addPhoto', { id: photoId(99) }, T0), /limit/);
});

test('removing a photo says which picture to delete', () => {
  let timer = applyTimerOp(started(), 'addPhoto', { id: photoId(1) }, T0 + 1000).timer;
  const result = applyTimerOp(timer, 'removePhoto', { id: photoId(1) }, T0 + 2000);
  assert.deepEqual(result.timer.photos, []);
  assert.deepEqual(result.removedPhotoIds, [photoId(1)]);
  assert.equal(applyTimerOp(timer, 'removePhoto', { id: photoId(2) }, T0 + 2000).timer, timer);
});

test('clear ends the timer and says which pictures go with it', () => {
  let timer = applyTimerOp(started(), 'addPhoto', { id: photoId(1) }, T0 + 1000).timer;
  timer = applyTimerOp(timer, 'addPhoto', { id: photoId(2) }, T0 + 2000).timer;
  assert.deepEqual(applyTimerOp(timer, 'clear', {}, T0 + 3000), { timer: null, removedPhotoIds: [photoId(1), photoId(2)] });
  assert.deepEqual(applyTimerOp(null, 'clear', {}, T0), { timer: null, removedPhotoIds: [] });
});

test('adopt takes over a timer a device already had, with its start, pauses and notes', () => {
  const { timer } = applyTimerOp(null, 'adopt', {
    project: PROJECT,
    startedAt: T0 - 600000,
    pausedMs: 120000,
    notes: [{ at: T0 - 300000, text: ' earlier note ' }, { at: 'x', text: 'no time' }, { at: T0 - 100000, text: '   ' }],
  }, T0);
  assert.equal(timer.startedAt, T0 - 600000);
  assert.equal(timer.pausedMs, 120000);
  assert.equal(timer.pausedAt, undefined);
  assert.deepEqual(timer.notes, [{ at: T0 - 300000, text: 'earlier note' }]);
});

test('adopt keeps a pause that is in progress, and turns down times that are not believable', () => {
  const paused = applyTimerOp(null, 'adopt', { project: PROJECT, startedAt: T0 - 600000, pausedAt: T0 - 60000 }, T0).timer;
  assert.equal(paused.pausedAt, T0 - 60000);
  const DAY = 24 * 60 * 60 * 1000;
  for (const startedAt of [T0 - 4 * DAY, T0 + 3600000, 'soon', undefined]) {
    assert.throws(() => applyTimerOp(null, 'adopt', { project: PROJECT, startedAt }, T0), TimerOpError, String(startedAt));
  }
  // a start a moment in the future (clock skew) is held to now
  assert.equal(applyTimerOp(null, 'adopt', { project: PROJECT, startedAt: T0 + 5000 }, T0).timer.startedAt, T0);
});

test('adopt while a timer is running leaves that one alone', () => {
  const running = started();
  assert.equal(applyTimerOp(running, 'adopt', { project: PROJECT, startedAt: T0 - 1000 }, T0).timer, running);
});

test('an unknown operation is refused', () => {
  assert.throws(() => applyTimerOp(started(), 'explode', {}, T0), /Unknown/);
});

test('photo ids and data URLs are checked', () => {
  assert.equal(validTimerPhotoId('1760000000000-abc123'), true);
  for (const bad of ['', 'short', 'UPPER-CASE-ID-HERE', 'a/b/c-d-e-f-g-h', 'x'.repeat(41), 7, null]) assert.equal(validTimerPhotoId(bad), false, String(bad));
  assert.equal(validTimerPhotoDataUrl('data:image/jpeg;base64,/9j/4AAQ'), true);
  assert.equal(validTimerPhotoDataUrl('data:image/png;base64,iVBORw0KGgo'), true);
  assert.equal(validTimerPhotoDataUrl('data:text/html;base64,PGh0bWw+'), false);
  assert.equal(validTimerPhotoDataUrl('/9j/4AAQ'), false);
  assert.equal(validTimerPhotoDataUrl(`data:image/jpeg;base64,${'A'.repeat(MAX_TIMER_PHOTO_DATA_URL_LENGTH)}`), false);
});
