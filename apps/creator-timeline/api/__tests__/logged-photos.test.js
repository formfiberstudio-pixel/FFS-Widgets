import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLoggedPhotos, saveLoggedPhotos, withLoggedPhoto, markSeen, loggedInfo, countLogged, MAX_KEPT, SYNC_GRACE_MS,
} from '../../src/loggedPhotos.js';

const URI = (n) => `content://media/external/images/media/${n}`;
const known = (ids, syncedAt = 0) => ({ ids: new Set(ids), syncedAt });

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, keys: () => [...map.keys()] };
}

test('a photo is marked once it has been logged, with where it went', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'page-1', title: 'Garden Notes', date: '2026-10-09' }, 1000);
  assert.deepEqual(map[URI(1)], { pageId: 'page-1', title: 'Garden Notes', date: '2026-10-09', at: 1000 });
  assert.equal(loggedInfo(map, URI(1), known(['page-1']), 2000).title, 'Garden Notes');
  assert.equal(loggedInfo(map, URI(2), known(['page-1']), 2000), null);
});

test('the record it is added to is left alone', () => {
  const before = withLoggedPhoto({}, URI(1), { pageId: 'a', title: 't', date: 'd' }, 1);
  const after = withLoggedPhoto(before, URI(2), { pageId: 'b', title: 't', date: 'd' }, 2);
  assert.deepEqual(Object.keys(before), [URI(1)]);
  assert.deepEqual(Object.keys(after).sort(), [URI(1), URI(2)].sort());
});

test('an entry the calendar has shown, then lost, un-marks its photo at once -- even a minute after logging it', () => {
  // logged at t=0; the next sync brought the entry into the calendar
  let map = withLoggedPhoto({}, URI(1), { pageId: 'page-1', title: 'T', date: 'D' }, 0);
  map = markSeen(map, new Set(['page-1']));
  assert.equal(map[URI(1)].seen, true);
  // deleted a minute later: the calendar no longer has it
  assert.equal(loggedInfo(map, URI(1), known([], 0), 60_000), null);
  // while it is there, it stays marked
  assert.ok(loggedInfo(map, URI(1), known(['page-1']), 60_000));
});

test('an upload the calendar has not caught up with yet stays marked', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'page-new', title: 'T', date: 'D' }, 10_000);
  // the last sync was before the upload
  assert.ok(loggedInfo(map, URI(1), known(['page-old'], 5_000), 10_000 + 60_000));
  // no sync yet at all
  assert.ok(loggedInfo(map, URI(1), known(['page-old'], 0), 10_000 + 60_000));
});

test('an upload that a sync since has not shown is not marked: it was deleted, or never made', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'page-gone', title: 'T', date: 'D' }, 10_000);
  assert.equal(loggedInfo(map, URI(1), known(['page-old'], 20_000), 30_000), null);
});

test('with no sync news, an upload is taken as logged for a while and not for ever', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'page-x', title: 'T', date: 'D' }, 0);
  assert.ok(loggedInfo(map, URI(1), known(['other'], 0), SYNC_GRACE_MS - 1000));
  assert.equal(loggedInfo(map, URI(1), known(['other'], 0), SYNC_GRACE_MS + 1000), null);
});

test('with no calendar to check against, the record is taken as it stands', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'gone', title: 'T', date: 'D' }, 0);
  assert.ok(loggedInfo(map, URI(1), null, SYNC_GRACE_MS * 10));
});

test('seeing entries notes only those that are there, and gives back the same record when nothing is new', () => {
  let map = withLoggedPhoto({}, URI(1), { pageId: 'a', title: 't', date: 'd' }, 0);
  map = withLoggedPhoto(map, URI(2), { pageId: 'b', title: 't', date: 'd' }, 0);
  const seen = markSeen(map, new Set(['a', 'zzz']));
  assert.equal(seen[URI(1)].seen, true);
  assert.equal(seen[URI(2)].seen, undefined);
  assert.equal(map[URI(1)].seen, undefined, 'the input is left alone');
  assert.equal(markSeen(seen, new Set(['a'])), seen, 'nothing newly seen: the same object');
  // a calendar that has not loaded (nothing in it) is no evidence either way
  assert.equal(markSeen(map, new Set()), map);
  assert.equal(markSeen(map, null), map);
});

test('the oldest are let go past the limit', () => {
  let map = {};
  for (let i = 0; i < MAX_KEPT + 3; i++) map = withLoggedPhoto(map, URI(i), { pageId: `p${i}`, title: 't', date: 'd' }, i);
  assert.equal(Object.keys(map).length, MAX_KEPT);
  assert.equal(map[URI(0)], undefined);
  assert.equal(map[URI(2)], undefined);
  assert.ok(map[URI(MAX_KEPT + 2)]);
});

test('it is kept per account and survives a reload, and bad storage reads as nothing', () => {
  const storage = makeStorage();
  const map = withLoggedPhoto({}, URI(1), { pageId: 'a', title: 't', date: 'd' }, 5);
  saveLoggedPhotos(storage, 'tenant-a', map);
  assert.deepEqual(loadLoggedPhotos(storage, 'tenant-a'), map);
  assert.deepEqual(loadLoggedPhotos(storage, 'tenant-b'), {});
  assert.deepEqual(loadLoggedPhotos(makeStorage({ 'notionWidgetLoggedPhotos:x': 'not json' }), 'x'), {});
  assert.deepEqual(loadLoggedPhotos(makeStorage({ 'notionWidgetLoggedPhotos:x': '[1,2]' }), 'x'), {});
  assert.deepEqual(loadLoggedPhotos(storage, ''), {});
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadLoggedPhotos(broken, 'x'), {});
  saveLoggedPhotos(broken, 'x', map); // no throw
});

test('the logged ones among a day\'s photos are counted', () => {
  let map = withLoggedPhoto(withLoggedPhoto({}, URI(1), { pageId: 'a', title: 't', date: 'd' }, 0), URI(3), { pageId: 'b', title: 't', date: 'd' }, 0);
  map = markSeen(map, new Set(['a', 'b']));
  const photos = [1, 2, 3, 4].map((n) => ({ uri: URI(n) }));
  assert.equal(countLogged(map, photos, known(['a', 'b']), 1), 2);
  assert.equal(countLogged(map, photos, known(['a']), 1), 1);
});
