import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedPhotoDate, sharedPhotoFromRecord, freshSharedRecords, SHARED_PREVIEW_PLACEHOLDER } from '../../src/sharedPhotos.js';

const NOW = new Date(2026, 9, 8, 15, 0, 0).getTime(); // Oct 8 2026, 15:00 local
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('a camera capture time, or the gallery one, is the photo date', () => {
  const taken = NOW - 3 * DAY;
  for (const dateSource of ['exif', 'mediastore']) {
    const { date, reliable } = sharedPhotoDate({ uri: 'content://x/1', dateTaken: taken, dateSource }, NOW);
    assert.equal(date.getTime(), taken, dateSource);
    assert.equal(reliable, true, dateSource);
  }
});

test('a file last-changed time counts only once it is old', () => {
  const old = sharedPhotoDate({ dateTaken: NOW - 2 * DAY, dateSource: 'modified' }, NOW);
  assert.equal(old.reliable, true);
  assert.equal(old.date.getTime(), NOW - 2 * DAY);
  // saved a moment ago: that says nothing about when the picture was taken
  const fresh = sharedPhotoDate({ dateTaken: NOW - 5 * 60 * 1000, dateSource: 'modified' }, NOW);
  assert.equal(fresh.reliable, false);
  assert.equal(fresh.date.getTime(), NOW);
});

test('with no date at all it is today, flagged as a guess', () => {
  for (const record of [{ dateSource: 'none' }, {}, null, { dateTaken: 'soon', dateSource: 'exif' }, { dateTaken: 0, dateSource: 'exif' }, { dateTaken: -5, dateSource: 'mediastore' }]) {
    const { date, reliable } = sharedPhotoDate(record, NOW);
    assert.equal(reliable, false, JSON.stringify(record));
    assert.equal(date.getTime(), NOW, JSON.stringify(record));
  }
});

test('an unknown date source is not trusted', () => {
  assert.equal(sharedPhotoDate({ dateTaken: NOW - DAY, dateSource: 'guess' }, NOW).reliable, false);
});

test('a shared photo becomes a review-list entry like a native-picked one', () => {
  const photo = sharedPhotoFromRecord(
    { uri: 'content://media/external/images/media/42', displayName: 'IMG_0042.jpg', dateTaken: NOW - 3 * DAY, dateSource: 'exif' },
    localDate,
    NOW,
  );
  assert.deepEqual(photo, {
    id: 'shared-content://media/external/images/media/42',
    file: null,
    nativeUri: 'content://media/external/images/media/42',
    displayName: 'IMG_0042.jpg',
    previewUrl: SHARED_PREVIEW_PLACEHOLDER,
    date: '2026-10-05',
    hasExif: true,
    projectKey: '',
  });
});

test('a photo with no name or date is still importable, dated today and flagged', () => {
  const photo = sharedPhotoFromRecord({ uri: 'content://x/9', dateSource: 'none' }, localDate, NOW);
  assert.equal(photo.displayName, 'photo');
  assert.equal(photo.date, '2026-10-08');
  assert.equal(photo.hasExif, false);
  assert.equal(photo.projectKey, '');
});

test('each shared photo is taken once, and ones already in the list are left out', () => {
  const records = [{ uri: 'a' }, { uri: 'b' }, { uri: 'a' }, { uri: '' }, { nope: true }, null, { uri: 'c' }];
  assert.deepEqual(freshSharedRecords(records).map((r) => r.uri), ['a', 'b', 'c']);
  assert.deepEqual(freshSharedRecords(records, ['b']).map((r) => r.uri), ['a', 'c']);
  assert.deepEqual(freshSharedRecords(undefined), []);
  assert.deepEqual(freshSharedRecords('nope'), []);
});
