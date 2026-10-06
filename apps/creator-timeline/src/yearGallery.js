// Pure helpers for the Year view's gallery tab (no React, no DOM), so they can
// be unit-tested with node:test.

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The Sunday that starts the calendar week the Year grid's week row
// (mIdx, weekIndex) belongs to. The grid draws a week that straddles two
// months as two rows (Mar 29-31 at the end of March, Apr 1-4 at the start of
// April), but it is ONE week: both rows give the same Sunday (Mar 29), so a
// highlight or a filter can treat them as one. weekIndex is the grid's own
// row number within the month: row 0 holds the month's first days up to its
// first Saturday, since the grid's columns start on Sunday.
export function weekStartFor(year, mIdx, weekIndex) {
  const daysInMonth = new Date(year, mIdx + 1, 0).getDate();
  const startOffset = new Date(year, mIdx, 1).getDay();
  const day = Math.min(daysInMonth, Math.max(1, weekIndex * 7 - startOffset + 1));
  return new Date(year, mIdx, day - new Date(year, mIdx, day).getDay());
}

// The Sunday that starts the week containing `dateObj`.
export const weekStartOf = (dateObj) => new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate() - dateObj.getDay());

// The date range the gallery shows for `filter`: null (the whole year), a
// month ({ kind: 'month', mIdx }) or a calendar week ({ kind: 'week',
// weekStart }, weekStart the Sunday's time -- see weekStartFor). A week is
// seven days even across a month boundary ("Mar 29–Apr 4"); only the year's
// own edges cut it short, since the grid shows one year at a time.
export function yearGalleryRange(year, filter) {
  if (!filter) {
    return { start: new Date(year, 0, 1), end: new Date(year, 11, 31), label: String(year) };
  }
  if (filter.kind === 'month') {
    const { mIdx } = filter;
    return { start: new Date(year, mIdx, 1), end: new Date(year, mIdx + 1, 0), label: `${MONTH_LONG[mIdx]} ${year}` };
  }
  const weekStart = new Date(filter.weekStart);
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const start = weekStart < yearStart ? yearStart : weekStart;
  const end = weekEnd > yearEnd ? yearEnd : weekEnd;
  let label;
  if (start.getMonth() !== end.getMonth()) {
    label = `${MONTH_SHORT[start.getMonth()]} ${start.getDate()}–${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
  } else {
    const days = start.getDate() === end.getDate() ? `${start.getDate()}` : `${start.getDate()}–${end.getDate()}`;
    label = `${MONTH_SHORT[start.getMonth()]} ${days}`;
  }
  return { start, end, label };
}

// Every entry with a photo between start and end (inclusive), as
// { log, dateObj }, oldest first or newest first. Entries on the same day
// keep the order getLogsForDate gave them in either direction, so a day's
// photos don't shuffle when the order is flipped.
export function collectYearPhotos(getLogsForDate, start, end, newestFirst) {
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateObj = new Date(d);
    const photos = getLogsForDate(dateObj).filter((log) => log.imageUrl).map((log) => ({ log, dateObj }));
    if (photos.length) days.push(photos);
  }
  if (newestFirst) days.reverse();
  return days.flat();
}
