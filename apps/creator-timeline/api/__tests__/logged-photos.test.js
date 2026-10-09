import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLoggedPhotos, saveLoggedPhotos, withLoggedPhoto, loggedInfo, countLogged, MAX_KEPT, SYNC_GRACE_MS,
} from '../../src/loggedPhotos.js';

const URI = (n) => `content://media/external/images/media/${n}`;

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, keys: () => [...map.keys()] };
}

test('a photo is marked once it has been logged, with where it went', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'page-1', title: 'Garden Notes', date: '2026-10-09' }, 1000);
  assert.deepEqual(map[URI(1)], { pageId: 'page-1', title: 'Garden Notes', date: '2026-10-09', at: 1000 });
  assert.equal(loggedInfo(map, URI(1), new Set(['page-1']), 2000).title, 'Garden Notes');
  assert.equal(loggedInfo(map, URI(2), new Set(['page-1']), 2000), null);
});

test('the record it is added to is left alone', () => {
  const before = withLoggedPhoto({}, URI(1), { pageId: 'a', title: 't', date: 'd' }, 1);
  const after = withLoggedPhoto(before, URI(2), { pageId: 'b', title: 't', date: 'd' }, 2);
  assert.deepEqual(Object.keys(before), [URI(1)]);
  assert.deepEqual(Object.keys(after).sort(), [URI(1), URI(2)].sort());
});

test('a photo whose entry has been deleted is no longer marked', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'page-1', title: 'T', date: 'D' }, 0);
  const later = SYNC_GRACE_MS + 1000;
  assert.equal(loggedInfo(map, URI(1), new Set(['page-2']), later), null);
  assert.ok(loggedInfo(map, URI(1), new Set(['page-1']), later));
});

test('a photo just logged is marked before the calendar has caught up with it', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'page-new', title: 'T', date: 'D' }, 10_000);
  assert.ok(loggedInfo(map, URI(1), new Set(['page-old']), 10_000 + 60_000));
});

test('with no calendar to check against, the record is taken as it stands', () => {
  const map = withLoggedPhoto({}, URI(1), { pageId: 'gone', title: 'T', date: 'D' }, 0);
  assert.ok(loggedInfo(map, URI(1), null, SYNC_GRACE_MS * 10));
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
  const map = withLoggedPhoto(withLoggedPhoto({}, URI(1), { pageId: 'a', title: 't', date: 'd' }, 0), URI(3), { pageId: 'b', title: 't', date: 'd' }, 0);
  const photos = [1, 2, 3, 4].map((n) => ({ uri: URI(n) }));
  assert.equal(countLogged(map, photos, new Set(['a', 'b']), 1), 2);
  assert.equal(countLogged(map, photos, new Set(['a']), SYNC_GRACE_MS + 10), 1);
});
