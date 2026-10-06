import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearGalleryRange, collectYearPhotos, weekStartFor, weekStartOf } from '../../src/yearGallery.js';

const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const week = (y, m, d) => ({ kind: 'week', weekStart: new Date(y, m, d).getTime() });

test('no filter covers the whole year', () => {
  const { start, end, label } = yearGalleryRange(2026, null);
  assert.equal(ymd(start), '2026-1-1');
  assert.equal(ymd(end), '2026-12-31');
  assert.equal(label, '2026');
});

test('a month filter covers that month, leap years included', () => {
  const feb = yearGalleryRange(2026, { kind: 'month', mIdx: 1 });
  assert.equal(ymd(feb.start), '2026-2-1');
  assert.equal(ymd(feb.end), '2026-2-28');
  assert.equal(feb.label, 'February 2026');
  assert.equal(ymd(yearGalleryRange(2028, { kind: 'month', mIdx: 1 }).end), '2028-2-29');
});

test('a week is seven days, and crosses a month boundary as one week', () => {
  // Mar 29 2026 is a Sunday: Mar 29-31 and Apr 1-4 are ONE week.
  const crossing = yearGalleryRange(2026, week(2026, 2, 29));
  assert.deepEqual([ymd(crossing.start), ymd(crossing.end), crossing.label], ['2026-3-29', '2026-4-4', 'Mar 29–Apr 4']);
  // A week inside one month keeps the short label.
  const inside = yearGalleryRange(2026, week(2026, 2, 8));
  assert.deepEqual([ymd(inside.start), ymd(inside.end), inside.label], ['2026-3-8', '2026-3-14', 'Mar 8–14']);
});

test('only the year\'s own edges cut a week short', () => {
  // The week of Jan 1 2026 (a Thursday) starts Sunday Dec 28 2025.
  const first = yearGalleryRange(2026, week(2025, 11, 28));
  assert.deepEqual([ymd(first.start), ymd(first.end), first.label], ['2026-1-1', '2026-1-3', 'Jan 1–3']);
  // The week starting Sunday Dec 27 2026 runs into 2027.
  const last = yearGalleryRange(2026, week(2026, 11, 27));
  assert.deepEqual([ymd(last.start), ymd(last.end), last.label], ['2026-12-27', '2026-12-31', 'Dec 27–31']);
});

test('weekStartFor gives both rows of a straddling week the same Sunday', () => {
  // March 2026 starts on a Sunday, so its last row (index 4) is Mar 29-31.
  const marLastRow = weekStartFor(2026, 2, 4);
  // April 2026 starts on a Wednesday, so its first row (index 0) is Apr 1-4.
  const aprFirstRow = weekStartFor(2026, 3, 0);
  assert.equal(ymd(marLastRow), '2026-3-29');
  assert.equal(ymd(aprFirstRow), '2026-3-29');
  assert.equal(marLastRow.getTime(), aprFirstRow.getTime());
  // January 2026's first row (Thu 1st - Sat 3rd) belongs to the week of Dec 28 2025.
  assert.equal(ymd(weekStartFor(2026, 0, 0)), '2025-12-28');
  assert.equal(ymd(weekStartFor(2026, 0, 1)), '2026-1-4');
});

test('every day belongs to exactly one week start, shared across month rows', () => {
  for (const mIdx of [0, 1, 2, 3, 7, 9, 11]) {
    const daysInMonth = new Date(2026, mIdx + 1, 0).getDate();
    const startOffset = new Date(2026, mIdx, 1).getDay();
    for (let day = 1; day <= daysInMonth; day++) {
      const weekIndex = Math.floor((startOffset + day - 1) / 7); // the grid's own row for this day
      assert.equal(
        weekStartFor(2026, mIdx, weekIndex).getTime(),
        weekStartOf(new Date(2026, mIdx, day)).getTime(),
        `month ${mIdx + 1} day ${day}`
      );
    }
  }
});

test('collectYearPhotos keeps only entries with a photo, in either order', () => {
  const logsByDay = {
    '2026-3-2': [{ id: 'a', imageUrl: 'a.jpg' }, { id: 'a-text', imageUrl: null }],
    '2026-3-5': [{ id: 'b1', imageUrl: 'b1.jpg' }, { id: 'b2', imageUrl: 'b2.jpg' }],
    '2026-3-9': [{ id: 'c', imageUrl: 'c.jpg' }],
  };
  const getLogsForDate = (d) => logsByDay[ymd(d)] || [];
  const start = new Date(2026, 2, 1);
  const end = new Date(2026, 2, 31);
  const oldest = collectYearPhotos(getLogsForDate, start, end, false).map((p) => p.log.id);
  assert.deepEqual(oldest, ['a', 'b1', 'b2', 'c']);
  // Newest first reverses the days but not the order within a day.
  const newest = collectYearPhotos(getLogsForDate, start, end, true).map((p) => p.log.id);
  assert.deepEqual(newest, ['c', 'b1', 'b2', 'a']);
  // The range is inclusive at both ends.
  const edge = collectYearPhotos(getLogsForDate, new Date(2026, 2, 5), new Date(2026, 2, 9), false).map((p) => p.log.id);
  assert.deepEqual(edge, ['b1', 'b2', 'c']);
  assert.equal(collectYearPhotos(getLogsForDate, new Date(2026, 3, 1), new Date(2026, 3, 30), false).length, 0);
});

test('a crossing week gathers photos from both months', () => {
  const logsByDay = { '2026-3-30': [{ id: 'mar', imageUrl: 'm.jpg' }], '2026-4-2': [{ id: 'apr', imageUrl: 'a.jpg' }], '2026-4-5': [{ id: 'next', imageUrl: 'n.jpg' }] };
  const getLogsForDate = (d) => logsByDay[ymd(d)] || [];
  const { start, end } = yearGalleryRange(2026, week(2026, 2, 29));
  assert.deepEqual(collectYearPhotos(getLogsForDate, start, end, false).map((p) => p.log.id), ['mar', 'apr']);
});

test('collectYearPhotos hands back each photo with its own date', () => {
  const getLogsForDate = (d) => (ymd(d) === '2026-6-14' ? [{ id: 'x', imageUrl: 'x.jpg' }] : []);
  const [photo] = collectYearPhotos(getLogsForDate, new Date(2026, 0, 1), new Date(2026, 11, 31), false);
  assert.equal(ymd(photo.dateObj), '2026-6-14');
});
